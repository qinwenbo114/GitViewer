import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diffLines,
  computeChunks3Way,
  createMergeSession,
  applyChunkAction,
  applyAllUnresolved,
  syncSessionWithText,
  undoSession,
  redoSession,
  serializeSession,
  getConflictStats,
} from '../public/js/components/merge3.js';

test('diffLines finds minimal edit hunks across insertions, deletions, and replacements', () => {
  const a = ['a', 'b', 'c', 'd', 'e'];
  const b = ['a', 'x', 'y', 'c', 'e', 'f'];
  const edits = diffLines(a, b);
  assert.deepEqual(edits, [
    { aStart: 1, aEnd: 2, bStart: 1, bEnd: 3 },
    { aStart: 3, aEnd: 4, bStart: 4, bEnd: 4 },
    { aStart: 5, aEnd: 5, bStart: 5, bEnd: 6 },
  ]);
});

test('computeChunks3Way auto-merges non-conflicting changes and isolates conflicts', () => {
  const base = ['line 1', 'line 2', 'line 3', 'line 4', 'line 5'];
  const ours = ['line 1 ours', 'line 2', 'line 3 ours', 'line 4', 'line 5'];
  const theirs = ['line 1', 'line 2', 'line 3 theirs', 'line 4', 'line 5 theirs'];

  const chunks = computeChunks3Way(base, ours, theirs);
  const kinds = chunks.map((c) => c.kind);
  assert.deepEqual(kinds, ['ours', 'equal', 'conflict', 'equal', 'theirs']);

  const session = createMergeSession({
    path: 'demo.txt',
    baseContent: base.join('\n') + '\n',
    oursContent: ours.join('\n') + '\n',
    theirsContent: theirs.join('\n') + '\n',
    workingContent: [
      'line 1 ours',
      'line 2',
      '<<<<<<< HEAD',
      'line 3 ours',
      '=======',
      'line 3 theirs',
      '>>>>>>> feature/x',
      'line 4',
      'line 5 theirs',
      '',
    ].join('\n'),
  });

  assert.equal(session.oursLabel, 'HEAD');
  assert.equal(session.theirsLabel, 'feature/x');
  assert.equal(getConflictStats(session).unresolvedCount, 1);

  const conflictChunk = session.chunks.find((c) => c.kind === 'conflict');
  applyChunkAction(session, conflictChunk.id, 'both');
  assert.equal(getConflictStats(session).unresolvedCount, 0);
  assert.equal(
    serializeSession(session),
    'line 1 ours\nline 2\nline 3 ours\nline 3 theirs\nline 4\nline 5 theirs\n',
  );

  assert.equal(undoSession(session), true);
  assert.equal(getConflictStats(session).unresolvedCount, 1);
  assert.equal(redoSession(session), true);
  assert.equal(getConflictStats(session).unresolvedCount, 0);
});

test('handles add/add conflicts without common base and partial working progress', () => {
  const session = createMergeSession({
    path: 'new.txt',
    baseContent: null,
    oursContent: 'header\nours A\nfooter\nours B\n',
    theirsContent: 'header\ntheirs A\nfooter\ntheirs B\n',
    workingContent: 'header\nours A\nfooter\n<<<<<<< HEAD\nours B\n=======\ntheirs B\n>>>>>>> topic\n',
  });

  const stats = getConflictStats(session);
  assert.equal(stats.totalConflicts, 2);
  assert.equal(stats.unresolvedCount, 1);
  assert.equal(stats.resolvedCount, 1);

  const partial = serializeSession(session, { includeMarkersForUnresolved: true });
  assert.match(partial, /<<<<<<< HEAD/);
  assert.match(partial, /ours A/);

  applyAllUnresolved(session, 'theirs');
  assert.equal(getConflictStats(session).unresolvedCount, 0);
  assert.equal(serializeSession(session), 'header\nours A\nfooter\ntheirs B\n');
});

test('syncSessionWithText tracks manual edits and preserves contiguous chunk ranges', () => {
  const session = createMergeSession({
    path: 'app.js',
    baseContent: 'const a = 1;\nconst b = 2;\nconst c = 3;\n',
    oursContent: 'const a = 1;\nconst b = 20;\nconst c = 3;\n',
    theirsContent: 'const a = 1;\nconst b = 30;\nconst c = 3;\n',
  });

  syncSessionWithText(session, 'const a = 1;\nconst b = 20 + 30;\n// note\nconst c = 3;', { recordUndo: true });
  const conflict = session.chunks.find((c) => c.kind === 'conflict');
  assert.equal(conflict.manualEdited, true);
  assert.deepEqual(conflict.resultLines, ['const b = 20 + 30;', '// note']);

  let cursor = 0;
  for (const c of session.chunks) {
    assert.equal(c.resultStart, cursor);
    assert.equal(c.resultEnd, cursor + c.resultLines.length);
    cursor = c.resultEnd;
  }

  applyChunkAction(session, conflict.id, 'mark-resolved');
  assert.equal(getConflictStats(session).unresolvedCount, 0);
  assert.equal(serializeSession(session), 'const a = 1;\nconst b = 20 + 30;\n// note\nconst c = 3;\n');
});

test('keeps Git-coalesced conflict spans unresolved with clean base lines in center', () => {
  const base = [
    "import { a } from './a';",
    '',
    'const cfg = {',
    '  port: 3000,',
    '};',
    '',
    'function run() {',
    '  return start(cfg);',
    '}',
  ].join('\n') + '\n';
  const ours = [
    "import { a } from './a';",
    "import { log } from './log';",
    '',
    'const cfg = {',
    '  port: 4000,',
    '};',
    '',
    'function run() {',
    '  log();',
    '  return start(cfg);',
    '}',
  ].join('\n') + '\n';
  const theirs = [
    "import { a } from './a';",
    "import { auth } from './auth';",
    '',
    'const cfg = {',
    '  port: 5000,',
    '};',
    '',
    'function run() {',
    '  return start(cfg, auth);',
    '}',
  ].join('\n') + '\n';
  // Git coalesces nearby conflicts across short unchanged lines into a single marker block.
  const working = [
    "import { a } from './a';",
    '<<<<<<< HEAD',
    "import { log } from './log';",
    '',
    'const cfg = {',
    '  port: 4000,',
    '};',
    '',
    'function run() {',
    '  log();',
    '  return start(cfg);',
    '=======',
    "import { auth } from './auth';",
    '',
    'const cfg = {',
    '  port: 5000,',
    '};',
    '',
    'function run() {',
    '  return start(cfg, auth);',
    '>>>>>>> feature/auth',
    '}',
  ].join('\n') + '\n';

  const session = createMergeSession({
    path: 'app.js',
    baseContent: base,
    oursContent: ours,
    theirsContent: theirs,
    workingContent: working,
  });

  const stats = getConflictStats(session);
  assert.equal(stats.totalConflicts, 3);
  assert.equal(stats.unresolvedCount, 3);
  const center = serializeSession(session);
  assert.equal(center.includes('<<<<<<<'), false);
  assert.equal(center.includes('>>>>>>>'), false);
});
