import { h, toast, confirmDialog } from '../dom.js';
import { icon } from '../icons.js';
import { showOverlay } from './overlays.js';

const LINE_HEIGHT = 20;
const PADDING_TOP = 6;
const MAX_MYERS_D = 2000;

const MARKER_OURS = /^<{7}(?:\s+(.*))?$/;
const MARKER_BASE = /^\|{7}(?:\s+(.*))?$/;
const MARKER_SEP = /^={7}\s*$/;
const MARKER_END = /^>{7}(?:\s+(.*))?$/;

/* ------------------------------------------------------------------ text utils */

function normalizeEol(text) {
  return String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function splitPreservingEol(text) {
  const norm = normalizeEol(text);
  const trailingNewline = norm.endsWith('\n');
  const body = trailingNewline ? norm.slice(0, -1) : norm;
  const lines = body === '' ? [] : body.split('\n');
  return { lines, trailingNewline };
}

function linesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function parseWorkingConflicts(text) {
  const { lines, trailingNewline } = splitPreservingEol(text);
  const blocks = [];
  const cleanSegments = [];
  let cur = null;
  let normalStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const mOurs = line.match(MARKER_OURS);
    if (mOurs && !cur) {
      cleanSegments.push(lines.slice(normalStart, i));
      cur = {
        oursLabel: (mOurs[1] || '').trim(),
        theirsLabel: '',
        ours: [],
        base: [],
        theirs: [],
        hasBase: false,
        phase: 'ours',
      };
      continue;
    }
    if (!cur) continue;
    if (MARKER_BASE.test(line) && cur.phase === 'ours') {
      cur.hasBase = true;
      cur.phase = 'base';
      continue;
    }
    if (MARKER_SEP.test(line) && cur.phase !== 'theirs') {
      cur.phase = 'theirs';
      continue;
    }
    const mEnd = line.match(MARKER_END);
    if (mEnd) {
      cur.theirsLabel = (mEnd[1] || '').trim();
      blocks.push(cur);
      cur = null;
      normalStart = i + 1;
      continue;
    }
    if (cur.phase === 'ours') cur.ours.push(line);
    else if (cur.phase === 'base') cur.base.push(line);
    else cur.theirs.push(line);
  }
  // Unclosed marker block is treated as plain lines.
  if (cur) {
    // Rewind to before the unclosed marker.
    const rawStart = lines.length - cur.ours.length - cur.base.length - cur.theirs.length - 1;
    cleanSegments.push(lines.slice(normalStart, Math.max(normalStart, rawStart)));
    cleanSegments[cleanSegments.length - 1].push(...lines.slice(Math.max(normalStart, rawStart)));
  } else {
    cleanSegments.push(lines.slice(normalStart));
  }

  return { lines, trailingNewline, blocks, cleanSegments };
}

/* ------------------------------------------------------------------ Myers diff */

/**
 * Compute minimal edit hunks transforming `aLines` into `bLines` using Myers O(ND).
 * Returns [{ aStart, aEnd, bStart, bEnd }] where `aLines[aStart..aEnd)` becomes `bLines[bStart..bEnd)`.
 */
export function diffLines(aLines, bLines) {
  let prefix = 0;
  while (prefix < aLines.length && prefix < bLines.length && aLines[prefix] === bLines[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < aLines.length - prefix
    && suffix < bLines.length - prefix
    && aLines[aLines.length - 1 - suffix] === bLines[bLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const N = aLines.length - prefix - suffix;
  const M = bLines.length - prefix - suffix;
  if (N === 0 && M === 0) return [];
  if (N === 0 || M === 0) {
    return [{ aStart: prefix, aEnd: prefix + N, bStart: prefix, bEnd: prefix + M }];
  }

  // Intern strings to integer IDs so inner loop compares integers only.
  const pool = new Map();
  let nextId = 1;
  const intern = (s) => {
    let id = pool.get(s);
    if (id === undefined) {
      id = nextId++;
      pool.set(s, id);
    }
    return id;
  };
  const A = new Int32Array(N);
  const B = new Int32Array(M);
  for (let i = 0; i < N; i++) A[i] = intern(aLines[prefix + i]);
  for (let j = 0; j < M; j++) B[j] = intern(bLines[prefix + j]);

  const maxD = Math.min(N + M, MAX_MYERS_D);
  const offset = maxD;
  const v = new Int32Array(2 * maxD + 1);
  v.fill(-1);
  v[offset + 1] = 0;
  const trace = [];
  let foundD = -1;

  outer:
  for (let d = 0; d <= maxD; d++) {
    // Save only the active [-d..d] slice of v before step d mutates it.
    const snap = new Int32Array(2 * d + 1);
    for (let i = 0; i <= 2 * d; i++) {
      snap[i] = v[offset - d + i];
    }
    trace.push(snap);

    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;
      while (x < N && y < M && A[x] === B[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= N && y >= M) {
        foundD = d;
        break outer;
      }
    }
  }

  if (foundD === -1) {
    return [{ aStart: prefix, aEnd: prefix + N, bStart: prefix, bEnd: prefix + M }];
  }

  // Backtrack from (N, M) to (0, 0) collecting raw operations: 'eq', 'del', 'ins'.
  const ops = [];
  let x = N;
  let y = M;
  for (let d = foundD; d > 0; d--) {
    const snap = trace[d];
    const getPrev = (k) => {
      const idx = k + d;
      return idx >= 0 && idx < snap.length ? snap[idx] : -1;
    };
    const k = x - y;
    const prevK = (k === -d || (k !== d && getPrev(k - 1) < getPrev(k + 1))) ? k + 1 : k - 1;
    const prevX = getPrev(prevK);
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      x--;
      y--;
      ops.push({ type: 'eq', x, y });
    }
    if (prevX === x) {
      y--;
      ops.push({ type: 'ins', x, y });
    } else {
      x--;
      ops.push({ type: 'del', x, y });
    }
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    ops.push({ type: 'eq', x, y });
  }
  ops.reverse();

  const edits = [];
  let cur = null;
  for (const op of ops) {
    if (op.type === 'eq') {
      if (cur) {
        edits.push(cur);
        cur = null;
      }
      continue;
    }
    if (!cur) {
      cur = {
        aStart: prefix + op.x,
        aEnd: prefix + op.x,
        bStart: prefix + op.y,
        bEnd: prefix + op.y,
      };
    }
    if (op.type === 'del') {
      cur.aEnd = prefix + op.x + 1;
    } else {
      cur.bEnd = prefix + op.y + 1;
    }
  }
  if (cur) edits.push(cur);
  return edits;
}

/* ------------------------------------------------------------------ 3-way diff */

function makeChunk({
  id,
  kind,
  status,
  baseLines = [],
  oursStart,
  oursEnd,
  oursLines,
  theirsStart,
  theirsEnd,
  theirsLines,
  resultStart,
  resultLines,
}) {
  return {
    id,
    kind, // 'equal' | 'ours' | 'theirs' | 'same' | 'conflict'
    status, // 'equal' | 'auto-ours' | 'auto-theirs' | 'auto-same' | 'unresolved' | 'resolved-ours' | 'resolved-theirs' | 'resolved-both' | 'resolved-none' | 'resolved-manual' | 'reverted'
    baseLines,
    oursStart,
    oursEnd,
    oursLines,
    theirsStart,
    theirsEnd,
    theirsLines,
    resultStart,
    resultEnd: resultStart + resultLines.length,
    resultLines: [...resultLines],
    leftIgnored: false,
    rightIgnored: false,
    manualEdited: false,
  };
}

function recomputeResultRanges(chunks) {
  let rPos = 0;
  for (const c of chunks) {
    c.resultStart = rPos;
    c.resultEnd = rPos + c.resultLines.length;
    rPos = c.resultEnd;
  }
}

/**
 * Build 3-way chunks from base (nullable for add/add), ours, and theirs line arrays.
 */
export function computeChunks3Way(baseLines, oursLines, theirsLines) {
  const chunks = [];
  let seq = 1;

  if (baseLines === null) {
    // Both sides added independently (no common ancestor): align ours vs theirs directly.
    const edits = diffLines(oursLines, theirsLines);
    let oPos = 0;
    let tPos = 0;
    for (const e of edits) {
      if (e.aStart > oPos) {
        const eqLen = e.aStart - oPos;
        const slice = oursLines.slice(oPos, e.aStart);
        chunks.push(makeChunk({
          id: seq++,
          kind: 'equal',
          status: 'equal',
          baseLines: slice,
          oursStart: oPos,
          oursEnd: e.aStart,
          oursLines: slice,
          theirsStart: tPos,
          theirsEnd: tPos + eqLen,
          theirsLines: slice,
          resultStart: 0,
          resultLines: slice,
        }));
      }
      const oSlice = oursLines.slice(e.aStart, e.aEnd);
      const tSlice = theirsLines.slice(e.bStart, e.bEnd);
      chunks.push(makeChunk({
        id: seq++,
        kind: 'conflict',
        status: 'unresolved',
        baseLines: [],
        oursStart: e.aStart,
        oursEnd: e.aEnd,
        oursLines: oSlice,
        theirsStart: e.bStart,
        theirsEnd: e.bEnd,
        theirsLines: tSlice,
        resultStart: 0,
        resultLines: [],
      }));
      oPos = e.aEnd;
      tPos = e.bEnd;
    }
    if (oPos < oursLines.length) {
      const slice = oursLines.slice(oPos);
      chunks.push(makeChunk({
        id: seq++,
        kind: 'equal',
        status: 'equal',
        baseLines: slice,
        oursStart: oPos,
        oursEnd: oursLines.length,
        oursLines: slice,
        theirsStart: tPos,
        theirsEnd: theirsLines.length,
        theirsLines: slice,
        resultStart: 0,
        resultLines: slice,
      }));
    }
    recomputeResultRanges(chunks);
    return chunks;
  }

  const oursEdits = diffLines(baseLines, oursLines);
  const theirsEdits = diffLines(baseLines, theirsLines);

  let oi = 0;
  let ti = 0;
  let bPos = 0;
  let oPos = 0;
  let tPos = 0;

  const pushEqual = (bEnd) => {
    if (bEnd <= bPos) return;
    const len = bEnd - bPos;
    const slice = baseLines.slice(bPos, bEnd);
    chunks.push(makeChunk({
      id: seq++,
      kind: 'equal',
      status: 'equal',
      baseLines: slice,
      oursStart: oPos,
      oursEnd: oPos + len,
      oursLines: oursLines.slice(oPos, oPos + len),
      theirsStart: tPos,
      theirsEnd: tPos + len,
      theirsLines: theirsLines.slice(tPos, tPos + len),
      resultStart: 0,
      resultLines: slice,
    }));
    bPos = bEnd;
    oPos += len;
    tPos += len;
  };

  while (oi < oursEdits.length || ti < theirsEdits.length) {
    const oe = oursEdits[oi];
    const te = theirsEdits[ti];
    const nextB = Math.min(oe ? oe.aStart : Infinity, te ? te.aStart : Infinity);
    pushEqual(nextB);

    let regionEnd = nextB;
    let hasOurs = false;
    let hasTheirs = false;

    if (oe && oe.aStart <= regionEnd) {
      hasOurs = true;
      regionEnd = Math.max(regionEnd, oe.aEnd);
      oi++;
    }
    if (te && te.aStart <= regionEnd) {
      hasTheirs = true;
      regionEnd = Math.max(regionEnd, te.aEnd);
      ti++;
    }

    // Expand cluster while edits overlap or touch at boundary (matches Git xdiff conflict clustering).
    let expanded = true;
    while (expanded) {
      expanded = false;
      while (oi < oursEdits.length && oursEdits[oi].aStart <= regionEnd) {
        hasOurs = true;
        regionEnd = Math.max(regionEnd, oursEdits[oi].aEnd);
        oi++;
        expanded = true;
      }
      while (ti < theirsEdits.length && theirsEdits[ti].aStart <= regionEnd) {
        hasTheirs = true;
        regionEnd = Math.max(regionEnd, theirsEdits[ti].aEnd);
        ti++;
        expanded = true;
      }
    }

    // Advance ours/theirs end offsets up to regionEnd.
    const bSlice = baseLines.slice(bPos, regionEnd);
    let oEnd = oPos + (regionEnd - bPos);
    if (hasOurs) {
      const lastO = oursEdits[oi - 1];
      oEnd = lastO.bEnd + (regionEnd - lastO.aEnd);
    }
    let tEnd = tPos + (regionEnd - bPos);
    if (hasTheirs) {
      const lastT = theirsEdits[ti - 1];
      tEnd = lastT.bEnd + (regionEnd - lastT.aEnd);
    }

    const oSlice = oursLines.slice(oPos, oEnd);
    const tSlice = theirsLines.slice(tPos, tEnd);

    let kind;
    let status;
    let initialResult;
    if (hasOurs && !hasTheirs) {
      kind = 'ours';
      status = 'auto-ours';
      initialResult = oSlice;
    } else if (!hasOurs && hasTheirs) {
      kind = 'theirs';
      status = 'auto-theirs';
      initialResult = tSlice;
    } else if (linesEqual(oSlice, tSlice)) {
      kind = 'same';
      status = 'auto-same';
      initialResult = oSlice;
    } else {
      kind = 'conflict';
      status = 'unresolved';
      // IDEA style: center starts with common ancestor (or empty slot) rather than raw markers.
      initialResult = bSlice;
    }

    chunks.push(makeChunk({
      id: seq++,
      kind,
      status,
      baseLines: bSlice,
      oursStart: oPos,
      oursEnd: oEnd,
      oursLines: oSlice,
      theirsStart: tPos,
      theirsEnd: tEnd,
      theirsLines: tSlice,
      resultStart: 0,
      resultLines: initialResult,
    }));

    bPos = regionEnd;
    oPos = oEnd;
    tPos = tEnd;
  }

  pushEqual(baseLines.length);
  recomputeResultRanges(chunks);
  return chunks;
}

/**
 * Reconcile initial 3-way chunks with what is currently on disk in `working`.
 * Handles both 1-to-1 conflict blocks and Git-coalesced blocks spanning multiple nearby conflict chunks.
 * If the user previously resolved some conflicts and saved partial progress, keep those resolutions.
 */
function findSubarray(haystack, needle, from = 0) {
  if (needle.length === 0) return from;
  outer:
  for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function matchBlockSpan(chunks, startChunkIdx, blk, oursLines, theirsLines) {
  const conflictIndices = [];
  for (let i = startChunkIdx; i < chunks.length; i++) {
    if (chunks[i].kind === 'conflict') conflictIndices.push(i);
  }
  // Pass 1: exact contiguous chunk range [i..j] whose ours/theirs slices equal blk.ours/blk.theirs.
  for (let a = 0; a < conflictIndices.length; a++) {
    const i = conflictIndices[a];
    for (let b = a; b < conflictIndices.length; b++) {
      const j = conflictIndices[b];
      const oSlice = oursLines.slice(chunks[i].oursStart, chunks[j].oursEnd);
      const tSlice = theirsLines.slice(chunks[i].theirsStart, chunks[j].theirsEnd);
      if (linesEqual(oSlice, blk.ours) && linesEqual(tSlice, blk.theirs)) {
        return { firstIdx: i, lastIdx: j, nextChunkIdx: j + 1 };
      }
      if (oSlice.length > blk.ours.length && tSlice.length > blk.theirs.length) break;
    }
  }
  // Pass 2: fallback ordered subsequence containment (handles Git context trimming inside coalesced blocks).
  let firstIdx = -1;
  let lastIdx = -1;
  let oCursor = 0;
  let tCursor = 0;
  for (let a = 0; a < conflictIndices.length; a++) {
    const i = conflictIndices[a];
    const c = chunks[i];
    const oAt = findSubarray(blk.ours, c.oursLines, oCursor);
    const tAt = findSubarray(blk.theirs, c.theirsLines, tCursor);
    if (oAt !== -1 && tAt !== -1) {
      if (firstIdx === -1) firstIdx = i;
      lastIdx = i;
      oCursor = oAt + c.oursLines.length;
      tCursor = tAt + c.theirsLines.length;
    } else if (firstIdx !== -1) {
      break;
    }
  }
  if (firstIdx !== -1) {
    return { firstIdx, lastIdx, nextChunkIdx: lastIdx + 1 };
  }
  return null;
}

function reconcileWorking(chunks, workingText, oursLines, theirsLines) {
  if (!workingText) return { oursLabel: '', theirsLabel: '' };
  const parsed = parseWorkingConflicts(workingText);
  const firstBlock = parsed.blocks[0];
  const oursLabel = firstBlock?.oursLabel || '';
  const theirsLabel = firstBlock?.theirsLabel || '';

  const conflictChunks = chunks.filter((c) => c.kind === 'conflict');
  if (!conflictChunks.length) return { oursLabel, theirsLabel };

  let chunkCursor = 0;
  const unresolvedIds = new Set();
  const matchedBlocks = new Map(); // blockIndex -> { firstIdx, lastIdx }
  for (let b = 0; b < parsed.blocks.length; b++) {
    const match = matchBlockSpan(chunks, chunkCursor, parsed.blocks[b], oursLines, theirsLines);
    if (match) {
      matchedBlocks.set(b, match);
      for (let k = match.firstIdx; k <= match.lastIdx; k++) {
        if (chunks[k].kind === 'conflict') unresolvedIds.add(chunks[k].id);
      }
      chunkCursor = match.nextChunkIdx;
    }
  }

  if (unresolvedIds.size === conflictChunks.length) {
    // Untouched conflict file (even if Git coalesced multiple chunks into one marker block).
    return { oursLabel, theirsLabel };
  }

  if (parsed.blocks.length === 0) {
    // No conflict markers at all on disk: map working lines onto resolved chunks.
    mapWorkingIntoResolvedChunks(chunks, parsed.lines, unresolvedIds);
    return { oursLabel, theirsLabel };
  }

  // Partial progress on disk: keep remaining matched conflict spans unresolved and restore resolved ones.
  const workingWithSentinels = [];
  const sentinelBySpanStart = new Map();
  const skipChunkIds = new Set();
  for (let i = 0; i < parsed.cleanSegments.length; i++) {
    workingWithSentinels.push(...parsed.cleanSegments[i]);
    if (i < parsed.blocks.length) {
      const match = matchedBlocks.get(i);
      if (match) {
        const token = `\u0000__CONFLICT_SPAN_${match.firstIdx}_${match.lastIdx}__\u0000`;
        sentinelBySpanStart.set(chunks[match.firstIdx].id, { token, firstIdx: match.firstIdx, lastIdx: match.lastIdx });
        for (let k = match.firstIdx + 1; k <= match.lastIdx; k++) skipChunkIds.add(chunks[k].id);
        workingWithSentinels.push(token);
      } else {
        const blk = parsed.blocks[i];
        workingWithSentinels.push(`<<<<<<< ${blk.oursLabel || 'HEAD'}`.trimEnd());
        workingWithSentinels.push(...blk.ours);
        workingWithSentinels.push('=======');
        workingWithSentinels.push(...blk.theirs);
        workingWithSentinels.push(`>>>>>>> ${blk.theirsLabel || 'incoming'}`.trimEnd());
      }
    }
  }

  mapWorkingIntoResolvedChunks(chunks, workingWithSentinels, unresolvedIds, sentinelBySpanStart, skipChunkIds);
  return { oursLabel, theirsLabel };
}

function mapWorkingIntoResolvedChunks(chunks, workingLines, unresolvedIds, sentinelBySpanStart = new Map(), skipChunkIds = new Set()) {
  const templateLines = [];
  const tokenToChunk = new Map();
  for (const c of chunks) {
    if (skipChunkIds.has(c.id)) continue;
    const span = sentinelBySpanStart.get(c.id);
    if (span) {
      tokenToChunk.set(span.token, c);
      templateLines.push(span.token);
    } else if (c.kind === 'equal') {
      templateLines.push(...c.resultLines);
    } else {
      const token = `\u0000__CHUNK_SLOT_${c.id}__\u0000`;
      tokenToChunk.set(token, c);
      templateLines.push(token);
    }
  }

  const edits = diffLines(templateLines, workingLines);
  for (const e of edits) {
    const tSlice = templateLines.slice(e.aStart, e.aEnd);
    const wSlice = workingLines.slice(e.bStart, e.bEnd);
    const slotTokens = tSlice.filter((l) => tokenToChunk.has(l));
    if (slotTokens.length === 1 && tSlice.length === 1) {
      const c = tokenToChunk.get(slotTokens[0]);
      if (!unresolvedIds.has(c.id)) {
        c.resultLines = wSlice;
        if (c.kind === 'conflict') {
          if (linesEqual(wSlice, c.oursLines)) c.status = 'resolved-ours';
          else if (linesEqual(wSlice, c.theirsLines)) c.status = 'resolved-theirs';
          else if (linesEqual(wSlice, [...c.oursLines, ...c.theirsLines])) c.status = 'resolved-both';
          else c.status = 'resolved-manual';
        }
      }
    }
  }
  recomputeResultRanges(chunks);
}

/* ------------------------------------------------------------------ session */

export function createMergeSession({
  path,
  baseContent,
  oursContent,
  theirsContent,
  workingContent,
  hash = null,
  oursBranch = '',
}) {
  const baseSplit = baseContent == null ? null : splitPreservingEol(baseContent);
  const oursSplit = oursContent == null ? { lines: [], trailingNewline: false } : splitPreservingEol(oursContent);
  const theirsSplit = theirsContent == null ? { lines: [], trailingNewline: false } : splitPreservingEol(theirsContent);
  const workingSplit = workingContent == null ? null : splitPreservingEol(workingContent);

  const trailingNewline = Boolean(
    workingSplit?.trailingNewline ?? oursSplit.trailingNewline ?? theirsSplit.trailingNewline ?? baseSplit?.trailingNewline,
  );

  const chunks = computeChunks3Way(
    baseSplit ? baseSplit.lines : null,
    oursSplit.lines,
    theirsSplit.lines,
  );
  const labels = workingContent != null
    ? reconcileWorking(chunks, workingContent, oursSplit.lines, theirsSplit.lines)
    : { oursLabel: '', theirsLabel: '' };

  const session = {
    path,
    hash,
    trailingNewline,
    oursDeleted: oursContent == null,
    theirsDeleted: theirsContent == null,
    baseMissing: baseContent == null,
    oursLabel: oursBranch || labels.oursLabel || 'HEAD',
    theirsLabel: labels.theirsLabel || '传入版本',
    oursLines: oursSplit.lines,
    theirsLines: theirsSplit.lines,
    chunks,
    activeChunkId: chunks.find((c) => c.status === 'unresolved')?.id || chunks.find((c) => c.kind !== 'equal')?.id || null,
    undoStack: [],
    redoStack: [],
    dirty: false,
  };
  return session;
}

function cloneChunks(chunks) {
  return chunks.map((c) => ({
    ...c,
    baseLines: [...c.baseLines],
    oursLines: [...c.oursLines],
    theirsLines: [...c.theirsLines],
    resultLines: [...c.resultLines],
  }));
}

function pushUndo(session) {
  session.undoStack.push({
    chunks: cloneChunks(session.chunks),
    activeChunkId: session.activeChunkId,
  });
  if (session.undoStack.length > 100) session.undoStack.shift();
  session.redoStack.length = 0;
}

export function getSessionText(session) {
  const lines = [];
  for (const c of session.chunks) {
    lines.push(...c.resultLines);
  }
  return lines.join('\n');
}

export function getSessionLines(session) {
  const lines = [];
  for (const c of session.chunks) {
    lines.push(...c.resultLines);
  }
  return lines;
}

export function getConflictStats(session) {
  const conflicts = session.chunks.filter((c) => c.kind === 'conflict');
  const unresolved = conflicts.filter((c) => c.status === 'unresolved');
  const changes = session.chunks.filter((c) => c.kind !== 'equal');
  return {
    totalConflicts: conflicts.length,
    unresolvedCount: unresolved.length,
    resolvedCount: conflicts.length - unresolved.length,
    totalChanges: changes.length,
    unresolvedList: unresolved,
    allChanges: changes,
  };
}

/**
 * Apply an action to a single chunk (`ours`, `theirs`, `both`, `both-reverse`,
 * `append-ours`, `append-theirs`, `ignore-ours`, `ignore-theirs`, `ignore-both`,
 * `revert`, `mark-resolved`).
 */
export function applyChunkAction(session, chunkId, action) {
  const chunk = session.chunks.find((c) => c.id === chunkId);
  if (!chunk || chunk.kind === 'equal') return false;

  pushUndo(session);

  switch (action) {
    case 'ours':
      chunk.resultLines = [...chunk.oursLines];
      chunk.status = chunk.kind === 'conflict' ? 'resolved-ours' : 'auto-ours';
      chunk.leftIgnored = false;
      chunk.manualEdited = false;
      break;
    case 'theirs':
      chunk.resultLines = [...chunk.theirsLines];
      chunk.status = chunk.kind === 'conflict' ? 'resolved-theirs' : 'auto-theirs';
      chunk.rightIgnored = false;
      chunk.manualEdited = false;
      break;
    case 'both':
      chunk.resultLines = [...chunk.oursLines, ...chunk.theirsLines];
      chunk.status = 'resolved-both';
      chunk.leftIgnored = false;
      chunk.rightIgnored = false;
      chunk.manualEdited = false;
      break;
    case 'both-reverse':
      chunk.resultLines = [...chunk.theirsLines, ...chunk.oursLines];
      chunk.status = 'resolved-both';
      chunk.leftIgnored = false;
      chunk.rightIgnored = false;
      chunk.manualEdited = false;
      break;
    case 'append-theirs':
      chunk.resultLines = [...chunk.resultLines, ...chunk.theirsLines];
      chunk.status = 'resolved-both';
      chunk.rightIgnored = false;
      break;
    case 'append-ours':
      chunk.resultLines = [...chunk.resultLines, ...chunk.oursLines];
      chunk.status = 'resolved-both';
      chunk.leftIgnored = false;
      break;
    case 'ignore-ours':
      if (chunk.kind === 'conflict') {
        chunk.leftIgnored = true;
        if (chunk.rightIgnored) {
          chunk.resultLines = [...chunk.baseLines];
          chunk.status = 'resolved-none';
        }
      } else {
        chunk.resultLines = [...chunk.baseLines];
        chunk.status = 'reverted';
      }
      break;
    case 'ignore-theirs':
      if (chunk.kind === 'conflict') {
        chunk.rightIgnored = true;
        if (chunk.leftIgnored) {
          chunk.resultLines = [...chunk.baseLines];
          chunk.status = 'resolved-none';
        }
      } else {
        chunk.resultLines = [...chunk.baseLines];
        chunk.status = 'reverted';
      }
      break;
    case 'ignore-both':
      chunk.resultLines = [...chunk.baseLines];
      chunk.status = chunk.kind === 'conflict' ? 'resolved-none' : 'reverted';
      chunk.leftIgnored = true;
      chunk.rightIgnored = true;
      chunk.manualEdited = false;
      break;
    case 'revert':
      chunk.resultLines = [...chunk.baseLines];
      chunk.status = chunk.kind === 'conflict' ? 'unresolved' : 'reverted';
      chunk.leftIgnored = false;
      chunk.rightIgnored = false;
      chunk.manualEdited = false;
      break;
    case 'mark-resolved':
      if (chunk.kind === 'conflict') {
        chunk.status = 'resolved-manual';
      }
      break;
    default:
      session.undoStack.pop();
      return false;
  }

  recomputeResultRanges(session.chunks);
  session.dirty = true;
  if (chunk.status !== 'unresolved') {
    const nextUnresolved = session.chunks.find((c) => c.status === 'unresolved');
    if (nextUnresolved) session.activeChunkId = nextUnresolved.id;
  }
  return true;
}

export function applyAllUnresolved(session, side) {
  const targets = session.chunks.filter((c) => c.status === 'unresolved');
  if (!targets.length) return false;
  pushUndo(session);
  for (const chunk of targets) {
    if (side === 'ours') {
      chunk.resultLines = [...chunk.oursLines];
      chunk.status = 'resolved-ours';
    } else if (side === 'theirs') {
      chunk.resultLines = [...chunk.theirsLines];
      chunk.status = 'resolved-theirs';
    } else if (side === 'both') {
      chunk.resultLines = [...chunk.oursLines, ...chunk.theirsLines];
      chunk.status = 'resolved-both';
    }
    chunk.leftIgnored = false;
    chunk.rightIgnored = false;
    chunk.manualEdited = false;
  }
  recomputeResultRanges(session.chunks);
  session.dirty = true;
  return true;
}

/**
 * Update chunk resultLines and boundaries when the user manually edits the Center textarea.
 */
export function syncSessionWithText(session, nextText, { recordUndo = false } = {}) {
  const prevLines = getSessionLines(session);
  const norm = normalizeEol(nextText);
  const nextLines = norm === '' ? [] : norm.split('\n');
  if (linesEqual(prevLines, nextLines)) return false;

  if (recordUndo) pushUndo(session);

  let prefix = 0;
  while (prefix < prevLines.length && prefix < nextLines.length && prevLines[prefix] === nextLines[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < prevLines.length - prefix
    && suffix < nextLines.length - prefix
    && prevLines[prevLines.length - 1 - suffix] === nextLines[nextLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const oldStart = prefix;
  const oldEnd = prevLines.length - suffix;
  const newEnd = nextLines.length - suffix;
  const delta = newEnd - oldEnd;
  const chunks = session.chunks;

  // Locate affected chunk range [firstIdx..lastIdx].
  let firstIdx = -1;
  let lastIdx = -1;
  if (oldStart === oldEnd) {
    // Pure insertion at line boundary `oldStart`: prefer an unresolved/non-equal chunk at boundary.
    const candidates = [];
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      if (oldStart >= c.resultStart && oldStart <= c.resultEnd) {
        candidates.push(i);
      }
    }
    if (candidates.length) {
      const preferred = candidates.find((i) => chunks[i].status === 'unresolved')
        ?? candidates.find((i) => chunks[i].kind !== 'equal')
        ?? candidates[0];
      firstIdx = preferred;
      lastIdx = preferred;
    }
  } else {
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const overlaps = c.resultStart === c.resultEnd
        ? (c.resultStart >= oldStart && c.resultStart <= oldEnd)
        : (c.resultEnd > oldStart && c.resultStart < oldEnd);
      if (overlaps) {
        if (firstIdx === -1) firstIdx = i;
        lastIdx = i;
      }
    }
  }

  if (firstIdx === -1) {
    firstIdx = Math.max(0, chunks.length - 1);
    lastIdx = firstIdx;
  }

  if (!chunks.length) {
    chunks.push(makeChunk({
      id: 1,
      kind: 'equal',
      status: 'resolved-manual',
      baseLines: [],
      oursStart: 0,
      oursEnd: 0,
      oursLines: [],
      theirsStart: 0,
      theirsEnd: 0,
      theirsLines: [],
      resultStart: 0,
      resultLines: nextLines,
    }));
    session.dirty = true;
    return true;
  }

  if (firstIdx === lastIdx) {
    const c = chunks[firstIdx];
    const newLen = Math.max(0, (c.resultEnd - c.resultStart) + delta);
    c.resultLines = nextLines.slice(c.resultStart, c.resultStart + newLen);
    if (c.kind === 'conflict') {
      c.manualEdited = true;
    } else if (c.kind === 'equal') {
      c.status = 'resolved-manual';
    }
  } else {
    // Multi-chunk edit: collapse affected span into the first chunk so ranges stay strictly contiguous.
    const spanned = chunks.slice(firstIdx, lastIdx + 1);
    const mergedStart = spanned[0].resultStart;
    const mergedOldEnd = spanned[spanned.length - 1].resultEnd;
    const mergedNewEnd = Math.max(mergedStart, mergedOldEnd + delta);
    const hasConflict = spanned.some((c) => c.kind === 'conflict');
    const stillUnresolved = spanned.some((c) => c.status === 'unresolved');
    const merged = makeChunk({
      id: spanned[0].id,
      kind: hasConflict ? 'conflict' : spanned[0].kind,
      status: stillUnresolved ? 'unresolved' : 'resolved-manual',
      baseLines: spanned.flatMap((c) => c.baseLines),
      oursStart: spanned[0].oursStart,
      oursEnd: spanned[spanned.length - 1].oursEnd,
      oursLines: spanned.flatMap((c) => c.oursLines),
      theirsStart: spanned[0].theirsStart,
      theirsEnd: spanned[spanned.length - 1].theirsEnd,
      theirsLines: spanned.flatMap((c) => c.theirsLines),
      resultStart: mergedStart,
      resultLines: nextLines.slice(mergedStart, mergedNewEnd),
    });
    merged.manualEdited = true;
    chunks.splice(firstIdx, lastIdx - firstIdx + 1, merged);
  }

  recomputeResultRanges(chunks);
  session.dirty = true;
  return true;
}

export function undoSession(session) {
  if (!session.undoStack.length) return false;
  session.redoStack.push({
    chunks: cloneChunks(session.chunks),
    activeChunkId: session.activeChunkId,
  });
  const snap = session.undoStack.pop();
  session.chunks = snap.chunks;
  session.activeChunkId = snap.activeChunkId;
  session.dirty = true;
  return true;
}

export function redoSession(session) {
  if (!session.redoStack.length) return false;
  session.undoStack.push({
    chunks: cloneChunks(session.chunks),
    activeChunkId: session.activeChunkId,
  });
  const snap = session.redoStack.pop();
  session.chunks = snap.chunks;
  session.activeChunkId = snap.activeChunkId;
  session.dirty = true;
  return true;
}

/**
 * Serialize session back to file content.
 * If `includeMarkersForUnresolved` is true, unresolved chunks (that weren't manually resolved)
 * are emitted with standard `<<<<<<< / ======= / >>>>>>>` conflict markers so progress can be saved safely.
 */
export function serializeSession(session, { includeMarkersForUnresolved = false } = {}) {
  const lines = [];
  for (const c of session.chunks) {
    if (c.status === 'unresolved' && includeMarkersForUnresolved && !c.manualEdited) {
      lines.push(`<<<<<<< ${session.oursLabel || 'HEAD'}`);
      lines.push(...c.oursLines);
      lines.push('=======');
      lines.push(...c.theirsLines);
      lines.push(`>>>>>>> ${session.theirsLabel || 'incoming'}`);
    } else {
      lines.push(...c.resultLines);
    }
  }
  const body = lines.join('\n');
  return body + (session.trailingNewline ? '\n' : '');
}

/* ------------------------------------------------------------------ word diff */

function tokenize(text) {
  return text.match(/\s+|[A-Za-z0-9_$]+|[^\sA-Za-z0-9_$]/g) || [];
}

function buildPairedWordDiff(baseLines, sideLines) {
  const map = new Map();
  const count = Math.min(baseLines.length, sideLines.length);
  for (let k = 0; k < count; k++) {
    const oldText = baseLines[k];
    const newText = sideLines[k];
    if (oldText === newText) continue;
    const a = tokenize(oldText);
    const b = tokenize(newText);
    let prefix = 0;
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
    let suffix = 0;
    while (
      suffix < a.length - prefix
      && suffix < b.length - prefix
      && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
    ) suffix++;
    const mid = b.slice(prefix, b.length - suffix).join('');
    if (!mid) continue;
    const before = b.slice(0, prefix).join('');
    const after = b.slice(b.length - suffix).join('');
    map.set(k, { before, mid, after });
  }
  return map;
}

/* ------------------------------------------------------------------ UI */

function statusTone(chunk, side) {
  if (chunk.kind === 'equal') return 'equal';
  if (chunk.status === 'unresolved') {
    if (side === 'ours' && chunk.leftIgnored) return 'ignored';
    if (side === 'theirs' && chunk.rightIgnored) return 'ignored';
    return 'conflict';
  }
  if (chunk.status === 'auto-ours' || chunk.status === 'resolved-ours') {
    return side === 'theirs' ? 'muted' : 'ours';
  }
  if (chunk.status === 'auto-theirs' || chunk.status === 'resolved-theirs') {
    return side === 'ours' ? 'muted' : 'theirs';
  }
  if (chunk.status === 'auto-same' || chunk.status === 'resolved-both') {
    return 'both';
  }
  if (chunk.status === 'resolved-manual') {
    return side === 'center' ? 'both' : 'muted';
  }
  return 'muted';
}

function renderSidePaneContent(session, side, activeChunkId, onChunkSelect) {
  const scroll = h('div', { class: 'merge-side-scroll' });
  const totalLines = side === 'ours' ? session.oursLines.length : session.theirsLines.length;
  const lineToChunk = new Array(totalLines);
  const zeroMarkers = new Map(); // lineIdx -> chunk

  for (const c of session.chunks) {
    const start = side === 'ours' ? c.oursStart : c.theirsStart;
    const end = side === 'ours' ? c.oursEnd : c.theirsEnd;
    if (start === end) {
      if (c.kind !== 'equal') zeroMarkers.set(start, c);
    } else {
      for (let i = start; i < end; i++) lineToChunk[i] = c;
    }
  }

  // Precompute word-level diffs against baseLines (or opposite side if base is null) for changed chunks.
  const wordDiffByLine = new Map();
  for (const c of session.chunks) {
    if (c.kind === 'equal') continue;
    const start = side === 'ours' ? c.oursStart : c.theirsStart;
    const sideLines = side === 'ours' ? c.oursLines : c.theirsLines;
    const refLines = session.baseMissing
      ? (side === 'ours' ? c.theirsLines : c.oursLines)
      : c.baseLines;
    const paired = buildPairedWordDiff(refLines, sideLines);
    for (const [k, parts] of paired.entries()) {
      wordDiffByLine.set(start + k, parts);
    }
  }

  const lines = side === 'ours' ? session.oursLines : session.theirsLines;
  const frag = document.createDocumentFragment();
  for (let i = 0; i <= lines.length; i++) {
    const zeroChunk = zeroMarkers.get(i);
    if (zeroChunk) {
      const tone = statusTone(zeroChunk, side);
      const isActive = zeroChunk.id === activeChunkId;
      frag.append(h('div', {
        class: `merge-zero-line tone-${tone} ${isActive ? 'active' : ''}`,
        onclick: () => onChunkSelect?.(zeroChunk.id),
      }));
    }
    if (i === lines.length) break;

    const c = lineToChunk[i];
    const tone = c ? statusTone(c, side) : 'equal';
    const isActive = c && c.id === activeChunkId;
    const isChunkStart = c && c.kind !== 'equal' && (side === 'ours' ? c.oursStart === i : c.theirsStart === i);
    const isChunkEnd = c && c.kind !== 'equal' && (side === 'ours' ? c.oursEnd - 1 === i : c.theirsEnd - 1 === i);
    const cls = [
      'merge-line',
      `tone-${tone}`,
      isActive ? 'active' : '',
      isChunkStart ? 'chunk-start' : '',
      isChunkEnd ? 'chunk-end' : '',
    ].filter(Boolean).join(' ');

    const codeEl = h('span', { class: 'merge-code' });
    const wd = wordDiffByLine.get(i);
    if (wd) {
      if (wd.before) codeEl.append(document.createTextNode(wd.before));
      codeEl.append(h('span', { class: 'merge-word-hl' }, wd.mid));
      if (wd.after) codeEl.append(document.createTextNode(wd.after));
    } else {
      codeEl.textContent = lines[i];
    }

    const row = h('div', {
      class: cls,
      onclick: c && c.kind !== 'equal' ? () => onChunkSelect?.(c.id) : null,
    },
    h('span', { class: 'merge-ln' }, String(i + 1)),
    codeEl);
    frag.append(row);
  }

  if (!lines.length && !zeroMarkers.size) {
    frag.append(h('div', { class: 'merge-empty-file' }, '（空文件）'));
  }

  scroll.append(frag);
  return scroll;
}

export function openMergeOverlay(ctx, file, initialConflict) {
  const branch = ctx.state.snapshot?.head?.branch || '';
  const conflict = initialConflict;
  if (!conflict) return;

  if (conflict.working?.binary || conflict.ours?.binary || conflict.theirs?.binary || conflict.base?.binary) {
    toast('二进制文件不支持三栏文本合并，请直接选择「我的版本」或「对方版本」', 'warn');
    return;
  }
  if (conflict.working?.truncated || conflict.ours?.truncated || conflict.theirs?.truncated || conflict.base?.truncated) {
    toast('文件过大（超过 1.5MB）已被截断，无法在应用内安全合并，请使用外部工具处理', 'warn', { duration: 6000 });
    return;
  }

  const session = createMergeSession({
    path: file.path,
    baseContent: conflict.base ? conflict.base.content : null,
    oursContent: conflict.ours ? conflict.ours.content : null,
    theirsContent: conflict.theirs ? conflict.theirs.content : null,
    workingContent: conflict.working ? conflict.working.content : null,
    hash: conflict.working?.hash || null,
    oursBranch: branch,
  });

  let saving = false;
  let syncLock = false;
  let typingUndoTimer = null;
  let pendingTypingSnapshot = null;

  /* ---- DOM skeleton ---- */
  const subtitleEl = h('span', { class: 'merge-subtitle-badge' });
  const navCountEl = h('span', { class: 'merge-nav-count' });
  const prevBtn = h('button', {
    class: 'btn small',
    title: '上一处冲突 (Alt+↑)',
    html: `${icon('arrowUp', 13)}<span>上一处</span>`,
    onclick: () => stepConflict(-1),
  });
  const nextBtn = h('button', {
    class: 'btn small',
    title: '下一处冲突 (Alt+↓)',
    html: `${icon('arrowDown', 13)}<span>下一处</span>`,
    onclick: () => stepConflict(1),
  });
  const undoBtn = h('button', {
    class: 'btn small',
    title: '撤销 (Ctrl+Z)',
    html: `${icon('undo', 13)}<span>撤销</span>`,
    onclick: () => doUndo(),
  });
  const redoBtn = h('button', {
    class: 'btn small',
    title: '重做 (Ctrl+Y)',
    html: `${icon('redo', 13)}<span>重做</span>`,
    onclick: () => doRedo(),
  });
  const allOursBtn = h('button', {
    class: 'btn small',
    title: '所有未解决冲突全部采用本地版本',
    onclick: () => runAction(() => applyAllUnresolved(session, 'ours')),
  }, '全部用本地');
  const allTheirsBtn = h('button', {
    class: 'btn small',
    title: '所有未解决冲突全部采用对方版本',
    onclick: () => runAction(() => applyAllUnresolved(session, 'theirs')),
  }, '全部用对方');
  const saveDraftBtn = h('button', {
    class: 'btn small',
    title: '将当前已解决的部分写回工作区（未解决块保留冲突标记）',
    onclick: () => handleSave({ allowMarkers: true }),
  }, '保存进度');
  const applyBtn = h('button', {
    class: 'btn small primary',
    title: '保存合并结果并 git add 标记为已解决 (Ctrl+S)',
    html: `${icon('check', 13)}<span>应用合并并解决</span>`,
    onclick: () => handleSave({ allowMarkers: false }),
  });

  const overlay = showOverlay({
    title: `合并冲突：${file.path}`,
    subtitle: '三栏合并编辑器（左侧：本地 · 中间：合并结果 · 右侧：传入）',
    iconName: 'merge',
    closeOnEsc: false,
    actions: [
      prevBtn,
      navCountEl,
      nextBtn,
      h('span', { class: 'merge-toolbar-sep' }),
      undoBtn,
      redoBtn,
      h('span', { class: 'merge-toolbar-sep' }),
      allOursBtn,
      allTheirsBtn,
      h('span', { class: 'merge-toolbar-sep' }),
      saveDraftBtn,
      applyBtn,
    ],
    onClose: () => {
      document.removeEventListener('keydown', onMergeKey, true);
      window.removeEventListener('resize', scheduleConnectorRedraw);
      clearTimeout(typingUndoTimer);
    },
  });

  // Override overlay close button to prompt if dirty.
  const closeBtn = overlay.el.querySelector('.overlay-close');
  if (closeBtn) {
    closeBtn.onclick = (ev) => {
      ev.stopPropagation();
      requestClose();
    };
  }

  /* ---- Active conflict contextual bar ---- */
  const contextBar = h('div', { class: 'merge-context-bar' });

  /* ---- Three-pane grid ---- */
  const leftHead = h('div', { class: 'merge-pane-head ours' },
    h('span', { class: 'merge-pane-dot' }),
    h('span', { class: 'merge-pane-title' }, '本地版本 (Yours)'),
    h('span', { class: 'merge-branch-pill' }, session.oursLabel),
    session.oursDeleted ? h('span', { class: 'merge-del-pill' }, '已删除') : null,
    h('span', { class: 'spacer' }),
    h('span', { class: 'merge-pane-meta' }, `${session.oursLines.length} 行`),
  );
  const leftBody = h('div', { class: 'merge-pane-body' });
  const leftPane = h('div', { class: 'merge-pane left' }, leftHead, leftBody);

  const centerStatusEl = h('span', { class: 'merge-center-status' });
  const centerCursorEl = h('span', { class: 'merge-pane-meta' });
  const centerHead = h('div', { class: 'merge-pane-head center' },
    h('span', { class: 'merge-pane-dot' }),
    h('span', { class: 'merge-pane-title' }, '合并结果 (Result)'),
    centerStatusEl,
    h('span', { class: 'spacer' }),
    centerCursorEl,
  );
  const centerLns = h('div', { class: 'merge-center-lns' });
  const centerBackdrop = h('div', { class: 'merge-backdrop' });
  const centerTextarea = h('textarea', {
    class: 'merge-textarea',
    spellcheck: 'false',
    autocomplete: 'off',
    autocapitalize: 'off',
    wrap: 'off',
    value: getSessionText(session),
  });
  const centerEditorWrap = h('div', { class: 'merge-center-editor' }, centerBackdrop, centerTextarea);
  const centerBody = h('div', { class: 'merge-center-body' }, centerLns, centerEditorWrap);
  const centerPane = h('div', { class: 'merge-pane center' }, centerHead, centerBody);

  const rightHead = h('div', { class: 'merge-pane-head theirs' },
    h('span', { class: 'merge-pane-dot' }),
    h('span', { class: 'merge-pane-title' }, '传入版本 (Theirs)'),
    h('span', { class: 'merge-branch-pill' }, session.theirsLabel),
    session.theirsDeleted ? h('span', { class: 'merge-del-pill' }, '已删除') : null,
    h('span', { class: 'spacer' }),
    h('span', { class: 'merge-pane-meta' }, `${session.theirsLines.length} 行`),
  );
  const rightBody = h('div', { class: 'merge-pane-body' });
  const rightPane = h('div', { class: 'merge-pane right' }, rightHead, rightBody);

  const leftGutterSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  leftGutterSvg.setAttribute('class', 'merge-gutter-svg');
  const leftGutterBtns = h('div', { class: 'merge-gutter-btns' });
  const leftGutter = h('div', { class: 'merge-gutter' },
    h('div', { class: 'merge-gutter-head' }),
    h('div', { class: 'merge-gutter-track' }, leftGutterSvg, leftGutterBtns),
  );

  const rightGutterSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  rightGutterSvg.setAttribute('class', 'merge-gutter-svg');
  const rightGutterBtns = h('div', { class: 'merge-gutter-btns' });
  const rightGutter = h('div', { class: 'merge-gutter' },
    h('div', { class: 'merge-gutter-head' }),
    h('div', { class: 'merge-gutter-track' }, rightGutterSvg, rightGutterBtns),
  );

  const minimap = h('div', { class: 'merge-minimap', title: '点击跳转冲突 / 变更位置' });
  const grid = h('div', { class: 'merge-grid' },
    leftPane,
    leftGutter,
    centerPane,
    rightGutter,
    rightPane,
    minimap,
  );

  const root = h('div', { class: 'merge-workspace' });
  if (session.oursDeleted || session.theirsDeleted) {
    root.append(h('div', { class: 'conflict-note' },
      h('span', { html: icon('alert', 13) }),
      h('span', {}, session.oursDeleted
        ? '本地分支删除了此文件，而传入分支修改了此文件。可直接选择保留传入内容或清空。'
        : '传入分支删除了此文件，而本地分支修改了此文件。可直接选择保留本地内容或清空。')));
  }
  root.append(contextBar, grid);
  overlay.setBody(root);

  let leftScrollEl = null;
  let rightScrollEl = null;
  let connectorRaf = 0;

  /* ---- Rendering helpers ---- */

  function renderSidePanes() {
    const prevLeftTop = leftScrollEl?.scrollTop ?? 0;
    const prevLeftLeft = leftScrollEl?.scrollLeft ?? 0;
    const prevRightTop = rightScrollEl?.scrollTop ?? 0;
    const prevRightLeft = rightScrollEl?.scrollLeft ?? 0;

    leftScrollEl = renderSidePaneContent(session, 'ours', session.activeChunkId, (id) => {
      session.activeChunkId = id;
      refreshAllUi({ syncText: false });
      scrollToChunk(id);
    });
    rightScrollEl = renderSidePaneContent(session, 'theirs', session.activeChunkId, (id) => {
      session.activeChunkId = id;
      refreshAllUi({ syncText: false });
      scrollToChunk(id);
    });

    leftBody.replaceChildren(leftScrollEl);
    rightBody.replaceChildren(rightScrollEl);
    leftScrollEl.scrollTop = prevLeftTop;
    leftScrollEl.scrollLeft = prevLeftLeft;
    rightScrollEl.scrollTop = prevRightTop;
    rightScrollEl.scrollLeft = prevRightLeft;

    leftScrollEl.addEventListener('scroll', () => {
      if (!syncLock) syncFromPane('ours');
      scheduleConnectorRedraw();
    });
    rightScrollEl.addEventListener('scroll', () => {
      if (!syncLock) syncFromPane('theirs');
      scheduleConnectorRedraw();
    });
  }

  function renderCenterBackdropAndLines() {
    const lines = getSessionLines(session);
    const total = Math.max(1, lines.length);

    const lnFrag = document.createDocumentFragment();
    for (let i = 1; i <= total; i++) {
      lnFrag.append(h('div', { class: 'merge-center-ln' }, String(i)));
    }
    centerLns.replaceChildren(lnFrag);

    const lineChunk = new Array(lines.length);
    const zeroMarkers = new Map();
    for (const c of session.chunks) {
      if (c.resultStart === c.resultEnd) {
        if (c.kind !== 'equal') zeroMarkers.set(c.resultStart, c);
      } else {
        for (let i = c.resultStart; i < c.resultEnd; i++) lineChunk[i] = c;
      }
    }

    const bgFrag = document.createDocumentFragment();
    const displayCount = Math.max(1, lines.length);
    for (let i = 0; i <= lines.length; i++) {
      const zc = zeroMarkers.get(i);
      if (zc) {
        const tone = statusTone(zc, 'center');
        const active = zc.id === session.activeChunkId ? 'active' : '';
        bgFrag.append(h('div', { class: `merge-zero-line center tone-${tone} ${active}` }));
      }
      if (i >= displayCount) break;
      const c = lineChunk[i];
      const tone = c ? statusTone(c, 'center') : 'equal';
      const active = c && c.id === session.activeChunkId ? 'active' : '';
      const isStart = c && c.kind !== 'equal' && c.resultStart === i;
      const isEnd = c && c.kind !== 'equal' && c.resultEnd - 1 === i;
      bgFrag.append(h('div', {
        class: [
          'merge-bg-line',
          `tone-${tone}`,
          active,
          isStart ? 'chunk-start' : '',
          isEnd ? 'chunk-end' : '',
        ].filter(Boolean).join(' '),
      }));
    }
    centerBackdrop.replaceChildren(bgFrag);
    // Keep backdrop scrollable width wide enough for horizontal scroll highlight.
    const maxLen = lines.reduce((m, l) => Math.max(m, l.length), 0);
    centerBackdrop.style.minWidth = `${Math.max(400, maxLen * 8 + 40)}px`;
    syncCenterScroll();
  }

  function renderHeaderAndContext() {
    const stats = getConflictStats(session);
    const active = session.chunks.find((c) => c.id === session.activeChunkId) || null;
    const conflictIdx = active && active.kind === 'conflict'
      ? stats.allChanges.filter((c) => c.kind === 'conflict').findIndex((c) => c.id === active.id)
      : -1;

    if (stats.unresolvedCount > 0) {
      subtitleEl.className = 'merge-subtitle-badge warn';
      subtitleEl.textContent = `剩余 ${stats.unresolvedCount} / ${stats.totalConflicts} 处冲突未解决`;
      centerStatusEl.className = 'merge-center-status warn';
      centerStatusEl.textContent = `${stats.unresolvedCount} 处待解决 · 可直接编辑`;
    } else if (stats.totalConflicts > 0) {
      subtitleEl.className = 'merge-subtitle-badge ok';
      subtitleEl.textContent = `全部 ${stats.totalConflicts} 处冲突已解决`;
      centerStatusEl.className = 'merge-center-status ok';
      centerStatusEl.textContent = '已全部解决 · 可继续微调';
    } else {
      subtitleEl.className = 'merge-subtitle-badge ok';
      subtitleEl.textContent = '无冲突';
      centerStatusEl.className = 'merge-center-status ok';
      centerStatusEl.textContent = '无冲突';
    }

    const navLabel = conflictIdx >= 0
      ? `${conflictIdx + 1} / ${stats.totalConflicts}`
      : `${stats.unresolvedCount} 未解决 / 共 ${stats.totalConflicts}`;
    navCountEl.textContent = navLabel;
    prevBtn.disabled = stats.totalConflicts === 0;
    nextBtn.disabled = stats.totalConflicts === 0;
    undoBtn.disabled = session.undoStack.length === 0;
    redoBtn.disabled = session.redoStack.length === 0;
    allOursBtn.disabled = stats.unresolvedCount === 0 || saving;
    allTheirsBtn.disabled = stats.unresolvedCount === 0 || saving;
    saveDraftBtn.style.display = stats.unresolvedCount > 0 ? '' : 'none';
    saveDraftBtn.disabled = saving;
    applyBtn.disabled = saving;

    const subtitleWrap = overlay.el.querySelector('.overlay-subtitle');
    if (subtitleWrap && !subtitleWrap.contains(subtitleEl)) {
      subtitleWrap.replaceChildren(
        h('span', {}, '三栏合并（左：本地 · 中：结果 · 右：传入）'),
        subtitleEl,
      );
    }

    // Active chunk contextual bar.
    contextBar.replaceChildren();
    if (!active || active.kind === 'equal') {
      contextBar.append(h('span', { class: 'muted' }, '点击左侧 »、右侧 « 或直接在中间编辑合并结果；Alt+↑ / Alt+↓ 切换冲突'));
      return;
    }

    const statusText = active.status === 'unresolved'
      ? (active.manualEdited ? '已手工修改（未确认）' : '未解决冲突')
      : active.status === 'resolved-ours' ? '已采用本地'
      : active.status === 'resolved-theirs' ? '已采用对方'
      : active.status === 'resolved-both' ? '已合并双方'
      : active.status === 'resolved-none' ? '已保留共同祖先'
      : active.status === 'resolved-manual' ? '已手工解决'
      : active.status === 'auto-ours' ? '仅本地修改（已自动合并）'
      : active.status === 'auto-theirs' ? '仅对方修改（已自动合并）'
      : active.status === 'reverted' ? '已撤销回共同祖先'
      : '双方相同修改';

    const label = active.kind === 'conflict'
      ? `冲突 ${conflictIdx + 1}/${stats.totalConflicts}`
      : '非冲突变更';

    contextBar.append(...[
      h('span', { class: `merge-ctx-badge ${active.status === 'unresolved' ? 'danger' : 'ok'}` }, label),
      h('span', { class: 'merge-ctx-info' },
        `本地 L${active.oursStart + 1}–${Math.max(active.oursStart + 1, active.oursEnd)} · 对方 L${active.theirsStart + 1}–${Math.max(active.theirsStart + 1, active.theirsEnd)} · ${statusText}`),
      h('div', { class: 'spacer' }),
      h('button', {
        class: 'btn tiny',
        html: `${icon('chevronsRight', 12)}<span>采用本地</span>`,
        onclick: () => runAction(() => applyChunkAction(session, active.id, 'ours')),
      }),
      h('button', {
        class: 'btn tiny',
        html: `${icon('chevronsLeft', 12)}<span>采用对方</span>`,
        onclick: () => runAction(() => applyChunkAction(session, active.id, 'theirs')),
      }),
      h('button', {
        class: 'btn tiny',
        onclick: () => runAction(() => applyChunkAction(session, active.id, 'both')),
      }, '两边都要 (左+右)'),
      h('button', {
        class: 'btn tiny',
        onclick: () => runAction(() => applyChunkAction(session, active.id, 'both-reverse')),
      }, '两边都要 (右+左)'),
      active.kind === 'conflict' && active.status === 'unresolved' && active.manualEdited
        ? h('button', {
          class: 'btn tiny primary',
          html: `${icon('check', 12)}<span>确认此冲突已解决</span>`,
          onclick: () => runAction(() => applyChunkAction(session, active.id, 'mark-resolved')),
        })
        : null,
      active.status !== 'unresolved'
        ? h('button', {
          class: 'btn tiny',
          title: '恢复此块为初始/共同祖先状态',
          onclick: () => runAction(() => applyChunkAction(session, active.id, 'revert')),
        }, '恢复默认')
        : h('button', {
          class: 'btn tiny',
          title: '忽略双方更改，保留共同祖先',
          onclick: () => runAction(() => applyChunkAction(session, active.id, 'ignore-both')),
        }, '保留共同祖先'),
    ].filter(Boolean));
  }

  function renderMinimap() {
    const total = Math.max(1, getSessionLines(session).length);
    const frag = document.createDocumentFragment();
    for (const c of session.chunks) {
      if (c.kind === 'equal') continue;
      const topPct = (c.resultStart / total) * 100;
      const heightPct = Math.max(0.8, ((Math.max(1, c.resultEnd - c.resultStart)) / total) * 100);
      const tone = statusTone(c, 'center');
      const marker = h('button', {
        class: `merge-minimap-mark tone-${tone} ${c.id === session.activeChunkId ? 'active' : ''}`,
        style: { top: `${topPct}%`, height: `${heightPct}%` },
        title: c.kind === 'conflict' ? `跳转到冲突 (第 ${c.resultStart + 1} 行)` : `跳转到变更 (第 ${c.resultStart + 1} 行)`,
        onclick: () => {
          session.activeChunkId = c.id;
          refreshAllUi({ syncText: false });
          scrollToChunk(c.id);
        },
      });
      frag.append(marker);
    }
    minimap.replaceChildren(frag);
  }

  /* ---- SVG connector & gutter action buttons ---- */

  function scheduleConnectorRedraw() {
    if (connectorRaf) return;
    connectorRaf = requestAnimationFrame(() => {
      connectorRaf = 0;
      drawGutters();
    });
  }

  function drawSingleGutter(svgEl, btnsEl, side) {
    const scrollEl = side === 'ours' ? leftScrollEl : rightScrollEl;
    if (!scrollEl) return;
    const w = svgEl.clientWidth || 52;
    const hPx = svgEl.clientHeight || 400;
    const sideTop = scrollEl.scrollTop;
    const centerTop = centerTextarea.scrollTop;

    const paths = [];
    const btns = [];
    let lastBtnBottom = -Infinity;

    for (const c of session.chunks) {
      if (c.kind === 'equal') continue;

      const sStart = side === 'ours' ? c.oursStart : c.theirsStart;
      const sEnd = side === 'ours' ? c.oursEnd : c.theirsEnd;
      const sy1 = PADDING_TOP + sStart * LINE_HEIGHT - sideTop;
      const sy2 = Math.max(sy1 + 2, PADDING_TOP + sEnd * LINE_HEIGHT - sideTop);
      const cy1 = PADDING_TOP + c.resultStart * LINE_HEIGHT - centerTop;
      const cy2 = Math.max(cy1 + 2, PADDING_TOP + c.resultEnd * LINE_HEIGHT - centerTop);

      // Cull completely off-screen connectors.
      if ((sy2 < -40 && cy2 < -40) || (sy1 > hPx + 40 && cy1 > hPx + 40)) continue;

      const leftIsSide = side === 'ours';
      const x0 = 0;
      const x1 = w;
      const yL1 = leftIsSide ? sy1 : cy1;
      const yL2 = leftIsSide ? sy2 : cy2;
      const yR1 = leftIsSide ? cy1 : sy1;
      const yR2 = leftIsSide ? cy2 : sy2;
      const cx = w * 0.5;
      const d = [
        `M ${x0} ${yL1}`,
        `C ${cx} ${yL1}, ${cx} ${yR1}, ${x1} ${yR1}`,
        `L ${x1} ${yR2}`,
        `C ${cx} ${yR2}, ${cx} ${yL2}, ${x0} ${yL2}`,
        'Z',
      ].join(' ');

      const tone = statusTone(c, side);
      const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathEl.setAttribute('d', d);
      pathEl.setAttribute('class', `merge-conn tone-${tone} ${c.id === session.activeChunkId ? 'active' : ''}`);
      paths.push(pathEl);

      // Position gutter action buttons along the side edge if visible, avoiding vertical overlaps.
      if (sy2 >= 0 && sy1 <= hPx - 14) {
        const btnTop = Math.max(2, lastBtnBottom + 3, Math.min(hPx - 22, sy1 + 1));
        const btnWrap = h('div', {
          class: `merge-gbtn-group ${side}`,
          style: { top: `${btnTop}px` },
        });

        if (c.kind === 'conflict') {
          if (c.status === 'unresolved') {
            const ignoredThisSide = side === 'ours' ? c.leftIgnored : c.rightIgnored;
            if (ignoredThisSide) {
              btnWrap.append(h('button', {
                class: 'merge-gbtn revert',
                title: '恢复此侧更改',
                html: icon('undo', 11),
                onclick: () => runAction(() => applyChunkAction(session, c.id, 'revert')),
              }));
            } else {
              btnWrap.append(
                h('button', {
                  class: 'merge-gbtn accept',
                  title: side === 'ours' ? '采用本地版本 (»)' : '采用对方版本 («)',
                  html: icon(side === 'ours' ? 'chevronsRight' : 'chevronsLeft', 12),
                  onclick: () => runAction(() => applyChunkAction(session, c.id, side)),
                }),
                h('button', {
                  class: 'merge-gbtn dismiss',
                  title: side === 'ours' ? '忽略本地更改 (×)' : '忽略对方更改 (×)',
                  html: icon('x', 11),
                  onclick: () => runAction(() => applyChunkAction(session, c.id, side === 'ours' ? 'ignore-ours' : 'ignore-theirs')),
                }),
              );
            }
          } else if (c.status === 'resolved-ours' && side === 'theirs') {
            btnWrap.append(h('button', {
              class: 'merge-gbtn append',
              title: '追加对方版本到合并结果 (+«)',
              html: icon('plus', 11),
              onclick: () => runAction(() => applyChunkAction(session, c.id, 'append-theirs')),
            }));
          } else if (c.status === 'resolved-theirs' && side === 'ours') {
            btnWrap.append(h('button', {
              class: 'merge-gbtn append',
              title: '追加本地版本到合并结果 (+»)',
              html: icon('plus', 11),
              onclick: () => runAction(() => applyChunkAction(session, c.id, 'append-ours')),
            }));
          } else if (
            (c.status === 'resolved-ours' && side === 'ours')
            || (c.status === 'resolved-theirs' && side === 'theirs')
          ) {
            btnWrap.append(h('button', {
              class: 'merge-gbtn revert',
              title: '撤销此选择',
              html: icon('undo', 11),
              onclick: () => runAction(() => applyChunkAction(session, c.id, 'revert')),
            }));
          }
        } else {
          // Non-conflicting change chunk (`ours`, `theirs`, `same`).
          const appliesThisSide = (c.kind === 'ours' && side === 'ours')
            || (c.kind === 'theirs' && side === 'theirs')
            || (c.kind === 'same' && side === 'ours');
          if (appliesThisSide) {
            if (c.status === 'reverted') {
              btnWrap.append(h('button', {
                class: 'merge-gbtn accept',
                title: side === 'ours' ? '应用本地变更' : '应用对方变更',
                html: icon(side === 'ours' ? 'chevronsRight' : 'chevronsLeft', 12),
                onclick: () => runAction(() => applyChunkAction(session, c.id, side)),
              }));
            } else {
              btnWrap.append(h('button', {
                class: 'merge-gbtn revert',
                title: '撤销此自动合并（恢复共同祖先）',
                html: icon('undo', 11),
                onclick: () => runAction(() => applyChunkAction(session, c.id, 'revert')),
              }));
            }
          }
        }
        if (btnWrap.children.length) {
          btns.push(btnWrap);
          lastBtnBottom = btnTop + 18;
        }
      }
    }

    svgEl.replaceChildren(...paths);
    btnsEl.replaceChildren(...btns);
  }

  function drawGutters() {
    drawSingleGutter(leftGutterSvg, leftGutterBtns, 'ours');
    drawSingleGutter(rightGutterSvg, rightGutterBtns, 'theirs');
  }

  /* ---- Synchronized piecewise-linear scroll ---- */

  function mapLineBetween(chunks, fromSide, toSide, linePos) {
    const startKey = fromSide === 'ours' ? 'oursStart' : fromSide === 'theirs' ? 'theirsStart' : 'resultStart';
    const endKey = fromSide === 'ours' ? 'oursEnd' : fromSide === 'theirs' ? 'theirsEnd' : 'resultEnd';
    const outStartKey = toSide === 'ours' ? 'oursStart' : toSide === 'theirs' ? 'theirsStart' : 'resultStart';
    const outEndKey = toSide === 'ours' ? 'oursEnd' : toSide === 'theirs' ? 'theirsEnd' : 'resultEnd';

    for (const c of chunks) {
      const a0 = c[startKey];
      const a1 = c[endKey];
      if (linePos >= a0 && linePos <= a1) {
        const b0 = c[outStartKey];
        const b1 = c[outEndKey];
        const span = a1 - a0;
        const ratio = span > 0 ? (linePos - a0) / span : 0;
        return b0 + ratio * (b1 - b0);
      }
    }
    const last = chunks[chunks.length - 1];
    return last ? last[outEndKey] : 0;
  }

  function syncCenterScroll() {
    centerBackdrop.scrollTop = centerTextarea.scrollTop;
    centerBackdrop.scrollLeft = centerTextarea.scrollLeft;
    centerLns.scrollTop = centerTextarea.scrollTop;
  }

  function syncFromPane(sourceSide) {
    const srcEl = sourceSide === 'ours' ? leftScrollEl : sourceSide === 'theirs' ? rightScrollEl : centerTextarea;
    if (!srcEl) return;
    syncLock = true;
    const anchorOffset = Math.min(120, srcEl.clientHeight * 0.28);
    const srcLine = Math.max(0, (srcEl.scrollTop - PADDING_TOP + anchorOffset) / LINE_HEIGHT);

    if (sourceSide !== 'center') {
      const targetLine = mapLineBetween(session.chunks, sourceSide, 'center', srcLine);
      centerTextarea.scrollTop = Math.max(0, PADDING_TOP + targetLine * LINE_HEIGHT - anchorOffset);
      syncCenterScroll();
    }
    if (sourceSide !== 'ours' && leftScrollEl) {
      const targetLine = mapLineBetween(session.chunks, sourceSide, 'ours', srcLine);
      leftScrollEl.scrollTop = Math.max(0, PADDING_TOP + targetLine * LINE_HEIGHT - anchorOffset);
    }
    if (sourceSide !== 'theirs' && rightScrollEl) {
      const targetLine = mapLineBetween(session.chunks, sourceSide, 'theirs', srcLine);
      rightScrollEl.scrollTop = Math.max(0, PADDING_TOP + targetLine * LINE_HEIGHT - anchorOffset);
    }

    requestAnimationFrame(() => {
      syncLock = false;
    });
  }

  function scrollToChunk(chunkId) {
    const c = session.chunks.find((item) => item.id === chunkId);
    if (!c) return;
    const anchor = Math.min(120, centerTextarea.clientHeight * 0.25);
    centerTextarea.scrollTop = Math.max(0, PADDING_TOP + c.resultStart * LINE_HEIGHT - anchor);
    syncCenterScroll();
    syncFromPane('center');
    scheduleConnectorRedraw();
  }

  function stepConflict(dir) {
    const conflicts = session.chunks.filter((c) => c.kind === 'conflict');
    if (!conflicts.length) return;
    let idx = conflicts.findIndex((c) => c.id === session.activeChunkId);
    if (idx === -1) idx = dir > 0 ? 0 : conflicts.length - 1;
    else idx = (idx + dir + conflicts.length) % conflicts.length;
    session.activeChunkId = conflicts[idx].id;
    refreshAllUi({ syncText: false });
    scrollToChunk(session.activeChunkId);
  }

  function updateCursorInfo() {
    const pos = centerTextarea.selectionStart || 0;
    const before = centerTextarea.value.slice(0, pos);
    const parts = before.split('\n');
    const line = parts.length;
    const col = parts[parts.length - 1].length + 1;
    centerCursorEl.textContent = `第 ${line} 行, 第 ${col} 列`;

    // Focus chunk under caret if caret is inside a non-equal chunk.
    const lineIdx = line - 1;
    const under = session.chunks.find((c) => c.kind !== 'equal' && lineIdx >= c.resultStart && lineIdx < Math.max(c.resultStart + 1, c.resultEnd));
    if (under && under.id !== session.activeChunkId) {
      session.activeChunkId = under.id;
      refreshAllUi({ syncText: false });
    }
  }

  function flushPendingTypingUndo() {
    if (typingUndoTimer) {
      clearTimeout(typingUndoTimer);
      typingUndoTimer = null;
    }
    if (pendingTypingSnapshot) {
      session.undoStack.push(pendingTypingSnapshot);
      if (session.undoStack.length > 100) session.undoStack.shift();
      session.redoStack.length = 0;
      pendingTypingSnapshot = null;
    }
  }

  function runAction(fn) {
    flushPendingTypingUndo();
    if (!fn()) return;
    refreshAllUi({ syncText: true });
  }

  function doUndo() {
    flushPendingTypingUndo();
    if (undoSession(session)) {
      refreshAllUi({ syncText: true });
    }
  }

  function doRedo() {
    flushPendingTypingUndo();
    if (redoSession(session)) {
      refreshAllUi({ syncText: true });
    }
  }

  function refreshAllUi({ syncText = true } = {}) {
    if (syncText) {
      const selStart = centerTextarea.selectionStart;
      const selEnd = centerTextarea.selectionEnd;
      const nextVal = getSessionText(session);
      if (centerTextarea.value !== nextVal) {
        centerTextarea.value = nextVal;
        centerTextarea.setSelectionRange(
          Math.min(selStart, nextVal.length),
          Math.min(selEnd, nextVal.length),
        );
      }
    }
    renderSidePanes();
    renderCenterBackdropAndLines();
    renderHeaderAndContext();
    renderMinimap();
    scheduleConnectorRedraw();
  }

  /* ---- Events ---- */

  centerTextarea.addEventListener('scroll', () => {
    syncCenterScroll();
    if (!syncLock) syncFromPane('center');
    scheduleConnectorRedraw();
  });

  centerTextarea.addEventListener('input', () => {
    if (!pendingTypingSnapshot) {
      pendingTypingSnapshot = {
        chunks: cloneChunks(session.chunks),
        activeChunkId: session.activeChunkId,
      };
    }
    clearTimeout(typingUndoTimer);
    typingUndoTimer = setTimeout(() => {
      flushPendingTypingUndo();
      renderHeaderAndContext();
    }, 450);

    syncSessionWithText(session, centerTextarea.value);
    renderSidePanes();
    renderCenterBackdropAndLines();
    renderHeaderAndContext();
    renderMinimap();
    scheduleConnectorRedraw();
  });

  centerTextarea.addEventListener('click', updateCursorInfo);
  centerTextarea.addEventListener('keyup', updateCursorInfo);

  async function handleSave({ allowMarkers }) {
    if (saving) return;
    flushPendingTypingUndo();
    const stats = getConflictStats(session);

    if (!allowMarkers && stats.unresolvedCount > 0) {
      const allManual = stats.unresolvedList.every((c) => c.manualEdited);
      if (allManual) {
        const ok = await confirmDialog({
          title: '确认完成合并',
          message: `有 ${stats.unresolvedCount} 处冲突已被手工修改但尚未点击「确认已解决」。是否直接保存当前结果并标记文件为已解决？`,
          confirmText: '保存并标记已解决',
        });
        if (!ok) return;
        for (const c of stats.unresolvedList) c.status = 'resolved-manual';
      } else {
        const firstUnresolved = stats.unresolvedList[0];
        if (firstUnresolved) {
          session.activeChunkId = firstUnresolved.id;
          refreshAllUi({ syncText: false });
          scrollToChunk(firstUnresolved.id);
        }
        toast(`还有 ${stats.unresolvedCount} 处冲突未解决，请点击左侧 » / 右侧 « 或先处理完所有冲突`, 'warn', { duration: 4500 });
        return;
      }
    }

    const content = serializeSession(session, { includeMarkersForUnresolved: allowMarkers });
    saving = true;
    renderHeaderAndContext();
    try {
      const data = await ctx.saveConflictContent(session.path, content, session.hash);
      if (!data) {
        saving = false;
        renderHeaderAndContext();
        return;
      }
      session.hash = data.hash;
      session.dirty = false;
      if (data.resolved) {
        overlay.close();
      } else {
        saving = false;
        refreshAllUi({ syncText: false });
      }
    } catch {
      saving = false;
      renderHeaderAndContext();
    }
  }

  async function requestClose() {
    if (session.dirty) {
      const ok = await confirmDialog({
        title: '放弃未保存的合并更改？',
        message: '你在三栏合并编辑器中所做的修改尚未保存，确定要关闭吗？',
        confirmText: '放弃并关闭',
        danger: true,
      });
      if (!ok) return;
    }
    overlay.close();
  }

  function onMergeKey(event) {
    if (event.key === 'Escape') {
      // If a modal confirm dialog is open on top, let modal handle Escape.
      if (document.querySelector('#modal-root .modal-backdrop')) return;
      event.preventDefault();
      event.stopPropagation();
      requestClose();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      event.stopPropagation();
      handleSave({ allowMarkers: false });
      return;
    }
    if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault();
      stepConflict(1);
      return;
    }
    if (event.altKey && event.key === 'ArrowUp') {
      event.preventDefault();
      stepConflict(-1);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      // Use session undo when focus is outside textarea (so textarea keeps native caret undo while typing,
      // or when textarea undo stack isn't active after button clicks).
      if (document.activeElement !== centerTextarea) {
        event.preventDefault();
        doUndo();
      }
    } else if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) {
      if (document.activeElement !== centerTextarea) {
        event.preventDefault();
        doRedo();
      }
    }
  }

  document.addEventListener('keydown', onMergeKey, true);
  window.addEventListener('resize', scheduleConnectorRedraw);

  // Initial render & scroll to first conflict.
  refreshAllUi({ syncText: true });
  updateCursorInfo();
  if (session.activeChunkId) {
    requestAnimationFrame(() => scrollToChunk(session.activeChunkId));
  }
}
