import fs from 'node:fs';
import path from 'node:path';
import { git, gitOk, cleanGitError } from './git.mjs';
import {
  AppError,
  assertRefLike,
  assertShaLike,
  badRequest,
  decodeText,
  EMPTY_TREE,
  isProbablyBinary,
  normalizeRepoPath,
  parseNumstat,
  safeRepoPath,
  shortHash,
} from './util.mjs';

const LOG_FORMAT = [
  '%H', '%P', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%s', '%b',
].join('%x00') + '%x1e';

const MAX_LOG_LIMIT = 5000;

export async function resolveRepo(dir) {
  const cwd = normalizeRepoPath(dir);
  if (!fs.existsSync(cwd)) throw badRequest(`目录不存在：${cwd}`);
  const top = await git(['rev-parse', '--show-toplevel'], { cwd, timeout: 20_000 });
  if (top.code === 0 && top.stdout.trim()) {
    const root = path.normalize(top.stdout.trim());
    return { path: root, name: path.basename(root), bare: false };
  }
  const bare = await git(['rev-parse', '--is-bare-repository'], { cwd, timeout: 20_000 });
  if (bare.code === 0 && bare.stdout.trim() === 'true') {
    return { path: cwd, name: path.basename(cwd), bare: true };
  }
  throw badRequest('这不是一个 Git 仓库（没有找到 .git 目录）');
}

function parseUpstreamTrack(track) {
  const res = { ahead: 0, behind: 0, gone: false };
  if (!track) return res;
  if (/\[gone\]/.test(track)) {
    res.gone = true;
    return res;
  }
  const ahead = track.match(/ahead (\d+)/);
  const behind = track.match(/behind (\d+)/);
  if (ahead) res.ahead = Number(ahead[1]);
  if (behind) res.behind = Number(behind[1]);
  return res;
}

export async function getRefs(cwd) {
  const res = await git([
    'for-each-ref',
    '--format=%(refname)%00%(objectname)%00%(*objectname)%00%(objecttype)%00%(HEAD)%00%(upstream:short)%00%(upstream:track)%00%(creatordate:unix)%00%(subject)',
    'refs/heads',
    'refs/remotes',
    'refs/tags',
  ], { cwd });
  const refs = [];
  for (const line of res.stdout.split('\n')) {
    if (!line.trim()) continue;
    const [fullName, objectName, peeled, objectType, headMark, upstream, track, date, ...subjectParts] =
      line.split('\0');
    if (!fullName) continue;
    const subject = subjectParts.join('\0');
    const trackInfo = parseUpstreamTrack(track);
    if (fullName.startsWith('refs/heads/')) {
      refs.push({
        type: 'branch',
        name: fullName.slice('refs/heads/'.length),
        fullName,
        sha: peeled || objectName,
        head: headMark.trim() === '*',
        upstream: upstream || null,
        ahead: trackInfo.ahead,
        behind: trackInfo.behind,
        gone: trackInfo.gone,
        date: Number(date) || 0,
        subject,
      });
    } else if (fullName.startsWith('refs/remotes/')) {
      const name = fullName.slice('refs/remotes/'.length);
      if (name.endsWith('/HEAD')) continue;
      refs.push({
        type: 'remote',
        name,
        fullName,
        sha: peeled || objectName,
        head: false,
        remote: name.split('/')[0],
        date: Number(date) || 0,
        subject,
      });
    } else if (fullName.startsWith('refs/tags/')) {
      refs.push({
        type: 'tag',
        name: fullName.slice('refs/tags/'.length),
        fullName,
        sha: peeled || objectName,
        annotated: objectType === 'tag',
        head: false,
        date: Number(date) || 0,
        subject,
      });
    }
  }
  return refs;
}

export async function getStashes(cwd) {
  const res = await git(['stash', 'list', '--format=%gd%x00%H%x00%ci%x00%s'], { cwd });
  if (res.code !== 0) return [];
  return res.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ref, sha, date, ...subject] = line.split('\0');
      return { ref, sha, date, subject: subject.join('\0') };
    });
}

export async function getRemotes(cwd) {
  const res = await git(['remote', '-v'], { cwd });
  if (res.code !== 0) return [];
  const map = new Map();
  for (const line of res.stdout.split('\n')) {
    const m = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (!m) continue;
    const entry = map.get(m[1]) || { name: m[1], fetchUrl: '', pushUrl: '' };
    if (m[3] === 'fetch') entry.fetchUrl = m[2];
    else entry.pushUrl = m[2];
    map.set(m[1], entry);
  }
  return [...map.values()];
}

async function gitPathExists(cwd, name) {
  const res = await git(['rev-parse', '--git-path', name], { cwd, timeout: 10_000 });
  if (res.code !== 0) return false;
  const p = path.resolve(cwd, res.stdout.trim());
  return fs.existsSync(p);
}

export async function getOperationState(cwd) {
  const [merge, cherryPick, revert, rebaseMerge, rebaseApply, bisect] = await Promise.all([
    gitPathExists(cwd, 'MERGE_HEAD'),
    gitPathExists(cwd, 'CHERRY_PICK_HEAD'),
    gitPathExists(cwd, 'REVERT_HEAD'),
    gitPathExists(cwd, 'rebase-merge'),
    gitPathExists(cwd, 'rebase-apply'),
    gitPathExists(cwd, 'BISECT_LOG'),
  ]);
  return {
    merge,
    cherryPick,
    revert,
    rebase: rebaseMerge || rebaseApply,
    rebaseKind: rebaseMerge ? 'interactive' : rebaseApply ? 'apply' : null,
    bisect,
  };
}

function parseStatusHeaders(stdout) {
  const head = { branch: null, sha: null, upstream: null, ahead: 0, behind: 0, detached: false, unborn: false };
  const headerLines = stdout
    .split('\0')
    .flatMap((token) => token.split('\n'))
    .filter((line) => line.startsWith('#'));
  for (const line of headerLines) {
    if (line.startsWith('# branch.oid ')) {
      const v = line.slice('# branch.oid '.length).trim();
      head.sha = v === '(initial)' ? null : v;
      head.unborn = v === '(initial)';
    } else if (line.startsWith('# branch.head ')) {
      const v = line.slice('# branch.head '.length).trim();
      if (v === '(detached)') head.detached = true;
      else head.branch = v;
    } else if (line.startsWith('# branch.upstream ')) {
      head.upstream = line.slice('# branch.upstream '.length).trim();
    } else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+)\s+-(\d+)/);
      if (m) {
        head.ahead = Number(m[1]);
        head.behind = Number(m[2]);
      }
    }
  }
  return head;
}

function splitStatusFields(record, count) {
  const parts = record.split(' ');
  return {
    fields: parts.slice(0, count),
    rest: parts.slice(count).join(' '),
  };
}

function makeStatusFile(entry) {
  const { x, y, path: p, origPath, group, unmerged } = entry;
  let code = group === 'untracked' ? '?' : unmerged ? 'U' : group === 'staged' ? x : y;
  if (!code || code === '.') code = 'M';
  return {
    path: p,
    origPath: origPath || null,
    x,
    y,
    code,
    group,
    unmerged: !!unmerged,
    staged: x !== '.' && x !== '?',
    unstaged: y !== '.' && y !== '?',
    untracked: x === '?',
  };
}

/** Parse `git status --porcelain=v2 --branch -z` output. */
export function parseStatus(stdout) {
  const files = [];
  const head = parseStatusHeaders(stdout);
  const tokens = stdout.split('\0');
  for (let i = 0; i < tokens.length; i++) {
    let rec = tokens[i];
    if (!rec) continue;
    if (rec.startsWith('#')) continue;
    if (rec[0] === '1') {
      const { fields, rest } = splitStatusFields(rec, 8);
      const [x, y] = [fields[1][0], fields[1][1]];
      const base = { x, y, path: rest };
      if (x === '.' && y === '.') continue;
      if (x !== '.' && x !== '?') files.push(makeStatusFile({ ...base, group: 'staged' }));
      if (y !== '.' && y !== '?') files.push(makeStatusFile({ ...base, group: 'unstaged' }));
    } else if (rec[0] === '2') {
      const { fields, rest } = splitStatusFields(rec, 9);
      const [x, y] = [fields[1][0], fields[1][1]];
      const origPath = tokens[i + 1] || null;
      i++;
      const base = { x, y, path: rest, origPath };
      if (x !== '.' && x !== '?') files.push(makeStatusFile({ ...base, group: 'staged' }));
      if (y !== '.' && y !== '?') files.push(makeStatusFile({ ...base, group: 'unstaged' }));
    } else if (rec[0] === 'u') {
      const { fields, rest } = splitStatusFields(rec, 10);
      const xy = fields[1] || 'UU';
      files.push(makeStatusFile({
        x: xy[0], y: xy[1], path: rest, group: 'conflicted', unmerged: true,
      }));
    } else if (rec[0] === '?') {
      files.push(makeStatusFile({ x: '?', y: '?', path: rec.slice(2), group: 'untracked' }));
    }
  }
  return { head, files };
}

export async function getStatus(cwd) {
  const [statusRes, unstagedNumstat, stagedNumstat] = await Promise.all([
    git(['--no-optional-locks', 'status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'], {
      cwd, timeout: 60_000,
    }),
    git(['diff', '--numstat', '--no-ext-diff'], { cwd }),
    git(['diff', '--cached', '--numstat', '--no-ext-diff'], { cwd }),
  ]);
  if (statusRes.code !== 0) {
    throw new AppError(cleanGitError(statusRes.stderr) || '无法读取工作区状态', { stderr: statusRes.stderr });
  }
  const parsed = parseStatus(statusRes.stdout);
  const unstagedStats = unstagedNumstat.code === 0 ? parseNumstat(unstagedNumstat.stdout) : new Map();
  const stagedStats = stagedNumstat.code === 0 ? parseNumstat(stagedNumstat.stdout) : new Map();
  for (const file of parsed.files) {
    const stats = file.group === 'staged'
      ? stagedStats.get(file.path)
      : file.group === 'unstaged' ? unstagedStats.get(file.path) : null;
    file.additions = stats && !stats.binary ? stats.additions : null;
    file.deletions = stats && !stats.binary ? stats.deletions : null;
    file.binary = !!(stats && stats.binary);
  }
  const counts = {
    staged: parsed.files.filter((f) => f.group === 'staged').length,
    unstaged: parsed.files.filter((f) => f.group === 'unstaged').length,
    untracked: parsed.files.filter((f) => f.group === 'untracked').length,
    conflicted: parsed.files.filter((f) => f.group === 'conflicted').length,
    total: parsed.files.length,
  };
  return {
    head: parsed.head,
    files: parsed.files,
    counts,
    stats: {
      staged: parsed.files.filter((f) => f.group === 'staged').reduce(
        (acc, f) => ({ additions: acc.additions + (f.additions || 0), deletions: acc.deletions + (f.deletions || 0) }),
        { additions: 0, deletions: 0 },
      ),
      unstaged: parsed.files.filter((f) => f.group === 'unstaged').reduce(
        (acc, f) => ({ additions: acc.additions + (f.additions || 0), deletions: acc.deletions + (f.deletions || 0) }),
        { additions: 0, deletions: 0 },
      ),
    },
  };
}

export async function getSnapshot(dir) {
  const repo = await resolveRepo(dir);
  const emptyStatus = {
    head: { branch: null, sha: null, upstream: null, ahead: 0, behind: 0, detached: false, unborn: false },
    files: [],
    counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0, total: 0 },
    stats: { staged: { additions: 0, deletions: 0 }, unstaged: { additions: 0, deletions: 0 } },
  };
  const [status, refs, stashes, remotes, operation, userRes, emailRes, versionRes] = await Promise.all([
    repo.bare ? Promise.resolve(emptyStatus) : getStatus(repo.path),
    getRefs(repo.path),
    getStashes(repo.path),
    getRemotes(repo.path),
    getOperationState(repo.path),
    git(['config', 'user.name'], { cwd: repo.path }),
    git(['config', 'user.email'], { cwd: repo.path }),
    git(['version'], { cwd: repo.path }),
  ]);
  const head = {
    ...status.head,
    target: status.head.branch
      ? `refs/heads/${status.head.branch}`
      : status.head.sha || null,
  };
  return {
    repo,
    head,
    status: {
      files: status.files,
      counts: status.counts,
      stats: status.stats,
    },
    refs,
    stashes,
    remotes,
    operation,
    user: {
      name: userRes.stdout.trim(),
      email: emailRes.stdout.trim(),
    },
    gitVersion: versionRes.stdout.trim(),
  };
}

export function refMap(refs) {
  const map = new Map();
  for (const ref of refs) {
    if (!ref.sha) continue;
    if (!map.has(ref.sha)) map.set(ref.sha, []);
    map.get(ref.sha).push({
      name: ref.name,
      type: ref.type,
      head: !!ref.head,
      remote: ref.remote || null,
      annotated: !!ref.annotated,
    });
  }
  for (const list of map.values()) {
    list.sort((a, b) => (b.head ? 1 : 0) - (a.head ? 1 : 0) || a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  }
  return map;
}

/**
 * Assign swim lanes to commits (newest first) so the UI can draw a branch graph.
 * Lanes keep stable indices; freed lanes are reused and recolored.
 */
export function computeGraph(commits) {
  const lanes = [];
  const laneColors = [];
  let colorSeq = 0;
  const nextColor = () => colorSeq++ % 12;

  for (const commit of commits) {
    let expected = [];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === commit.hash) expected.push(i);
    }
    let lane;
    if (expected.length > 0) {
      lane = expected[0];
    } else {
      lane = lanes.indexOf(null);
      if (lane === -1) lane = lanes.length;
      lanes[lane] = commit.hash;
      laneColors[lane] = nextColor();
      expected = [lane];
    }
    const before = lanes.slice();
    const beforeColors = laneColors.slice();

    for (const idx of expected) lanes[idx] = null;
    const mergeFrom = expected
      .filter((idx) => idx !== lane)
      .map((idx) => ({ lane: idx, color: beforeColors[idx] ?? 0 }));

    const parents = [];
    for (let pi = 0; pi < commit.parents.length; pi++) {
      const parent = commit.parents[pi];
      let target = lanes.indexOf(parent);
      if (target === -1) {
        if (pi === 0) {
          target = lane;
        } else {
          target = lanes.indexOf(null);
          if (target === -1) target = lanes.length;
          laneColors[target] = nextColor();
        }
        lanes[target] = parent;
      }
      if (pi === 0 || target !== lane) {
        parents.push({ lane: target, color: laneColors[target] ?? 0 });
      }
    }
    // Remove duplicate parent edges (octopus merges can repeat a parent).
    const seen = new Set();
    const uniqueParents = parents.filter((p) => {
      const key = p.lane;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const through = [];
    for (let i = 0; i < before.length; i++) {
      if (i === lane) continue;
      if (before[i] == null) continue;
      if (lanes[i] === before[i]) {
        through.push({ lane: i, color: laneColors[i] ?? 0 });
      }
    }

    commit.graph = {
      lane,
      color: laneColors[lane] ?? 0,
      through,
      mergeFrom,
      parents: uniqueParents,
      width: Math.max(
        lane + 1,
        ...before.map((_, i) => i + 1),
        ...lanes.map((_, i) => i + 1),
      ),
    };
  }
  return commits;
}

export async function queryLog(dir, opts = {}) {
  const repo = await resolveRepo(dir);
  const limit = Math.max(1, Math.min(Number(opts.limit) || 300, MAX_LOG_LIMIT));
  const rev = opts.rev || 'HEAD';
  const args = ['log', '--date-order', '--decorate=no', `--pretty=format:${LOG_FORMAT}`, '-n', String(limit)];

  if (opts.grep) {
    args.push('-i', '--fixed-strings', '--grep', String(opts.grep).slice(0, 200));
  }
  if (opts.author) {
    args.push('-i', '--author', String(opts.author).slice(0, 200));
  }
  if (opts.rev === 'ALL' || opts.rev === '--all') {
    args.push('--branches', '--tags', '--remotes', 'HEAD');
  } else {
    assertRefLike(rev, '版本范围');
    args.push(rev);
  }

  let pathFilter = null;
  if (opts.path) {
    pathFilter = safeRepoPath(opts.path);
    if (opts.rev !== 'ALL' && opts.rev !== '--all') args.push('--follow');
    args.push('--', pathFilter);
  }

  const res = await git(args, { cwd: repo.path, timeout: 120_000, maxStdout: 24 * 1024 * 1024 });
  if (res.code !== 0) {
    if (/does not have any commits yet|unknown revision|bad revision|ambiguous argument 'HEAD'/i.test(res.stderr)) {
      return { commits: [], repo, limit, rev, truncated: false };
    }
    throw new AppError(cleanGitError(res.stderr) || '无法读取提交历史', { stderr: res.stderr });
  }

  const refs = opts.refs || await getRefs(repo.path);
  const bySha = refMap(refs);
  const commits = [];
  for (const rawRecord of res.stdout.split('\x1e')) {
    const record = rawRecord.replace(/^[\r\n]+/, '');
    if (!record.trim()) continue;
    const fields = record.split('\0');
    if (fields.length < 10) continue;
    const [hash, parentStr, an, ae, at, cn, ce, ct, subject, ...bodyParts] = fields;
    const body = bodyParts.join('\0');
    commits.push({
      hash,
      short: shortHash(hash),
      parents: parentStr ? parentStr.split(' ') : [],
      author: { name: an, email: ae, time: Number(at) || 0 },
      committer: { name: cn, email: ce, time: Number(ct) || 0 },
      subject,
      body,
      refs: bySha.get(hash) || [],
      graph: null,
    });
  }
  computeGraph(commits);
  return {
    commits,
    repo,
    limit,
    rev,
    path: pathFilter,
    truncated: commits.length >= limit,
  };
}

export function parseNameStatus(output) {
  const files = [];
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const statusRaw = parts[0] || '';
    if (parts.length < 2) continue;
    const letter = statusRaw[0];
    if ((letter === 'R' || letter === 'C') && parts.length >= 3) {
      files.push({
        path: parts[2],
        origPath: parts[1],
        code: letter,
        score: Number(statusRaw.slice(1)) || null,
      });
    } else {
      files.push({ path: parts[1], origPath: null, code: letter, score: null });
    }
  }
  return files;
}

export async function getCommit(dir, shaRaw) {
  const repo = await resolveRepo(dir);
  const sha = assertShaLike(shaRaw);
  const resolved = await gitOk(['rev-parse', '--verify', `${sha}^{commit}`], { cwd: repo.path });
  const fullSha = resolved.stdout.trim();
  const raw = await gitOk([
    'show', '-s',
    '--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%s%x00%b',
    fullSha,
  ], { cwd: repo.path });
  const [hash, parentStr, an, ae, at, cn, ce, ct, subject, ...bodyParts] = raw.stdout.split('\0');
  const parents = parentStr ? parentStr.split(' ') : [];
  const base = parents[0] || EMPTY_TREE;

  const [namesRes, numstatRes, refs] = await Promise.all([
    git(['diff', '--name-status', '-M', '--no-ext-diff', base, fullSha], { cwd: repo.path }),
    git(['diff', '--numstat', '-M', '--no-ext-diff', base, fullSha], { cwd: repo.path }),
    getRefs(repo.path),
  ]);
  if (namesRes.code !== 0) {
    throw new AppError(cleanGitError(namesRes.stderr) || '无法读取提交内容', { stderr: namesRes.stderr });
  }
  const numstat = parseNumstat(numstatRes.stdout);
  const files = parseNameStatus(namesRes.stdout).map((file) => {
    const ns = numstat.get(file.path) || numstat.get(file.origPath) || null;
    return {
      ...file,
      additions: ns && !ns.binary ? ns.additions : null,
      deletions: ns && !ns.binary ? ns.deletions : null,
      binary: !!(ns && ns.binary),
    };
  });
  files.sort((a, b) => a.path.localeCompare(b.path));
  const stats = files.reduce(
    (acc, f) => ({
      files: acc.files + 1,
      additions: acc.additions + (f.additions || 0),
      deletions: acc.deletions + (f.deletions || 0),
    }),
    { files: 0, additions: 0, deletions: 0 },
  );
  return {
    repo,
    hash,
    short: shortHash(hash),
    parents,
    author: { name: an, email: ae, time: Number(at) || 0 },
    committer: { name: cn, email: ce, time: Number(ct) || 0 },
    subject,
    body: bodyParts.join('\0').replace(/\s+$/, ''),
    files,
    stats,
    refs: refMap(refs).get(hash) || [],
  };
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

export function parseDiff(text) {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n');
  const result = {
    hunks: [],
    binary: false,
    oldPath: null,
    newPath: null,
    isNew: false,
    isDeleted: false,
    isRename: false,
    adds: 0,
    dels: 0,
    text: text || '',
  };
  let hunk = null;
  let oldNo = 0;
  let newNo = 0;
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      hunk = null;
      const m = line.match(/^diff --git a\/(.*) b\/(.*)$/);
      if (m) {
        result.oldPath = m[1];
        result.newPath = m[2];
      }
      continue;
    }
    if (line.startsWith('new file mode ')) { result.isNew = true; continue; }
    if (line.startsWith('deleted file mode ')) { result.isDeleted = true; continue; }
    if (line.startsWith('rename from ')) { result.isRename = true; result.oldPath = line.slice(12); continue; }
    if (line.startsWith('rename to ')) { result.isRename = true; result.newPath = line.slice(10); continue; }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      result.binary = true;
      continue;
    }
    if (line.startsWith('@@ ')) {
      const m = line.match(HUNK_RE);
      if (!m) continue;
      oldNo = Number(m[1]);
      newNo = Number(m[3]);
      hunk = {
        header: line,
        oldStart: Number(m[1]),
        oldCount: m[2] == null ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newCount: m[4] == null ? 1 : Number(m[4]),
        section: (m[5] || '').trim(),
        lines: [],
      };
      result.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith('\\')) {
      const prev = hunk.lines[hunk.lines.length - 1];
      if (prev) prev.noNewline = true;
      continue;
    }
    const marker = line[0];
    let type = 'ctx';
    let content = line;
    if (marker === '+') {
      type = 'add'; content = line.slice(1); result.adds++;
    } else if (marker === '-') {
      type = 'del'; content = line.slice(1); result.dels++;
    } else if (marker === ' ') {
      type = 'ctx'; content = line.slice(1);
    } else if (line === '') {
      // Trailing newline of the diff, not a content line.
      continue;
    } else {
      // Unexpected metadata inside a hunk: keep it as context text.
      type = 'ctx';
      content = line;
    }
    const entry = {
      type,
      text: content,
      oldNo: type === 'add' ? null : oldNo,
      newNo: type === 'del' ? null : newNo,
    };
    hunk.lines.push(entry);
    if (type !== 'add') oldNo++;
    if (type !== 'del') newNo++;
  }
  return result;
}

export async function getDiff(dir, opts) {
  const repo = await resolveRepo(dir);
  const pathArg = opts.path ? safeRepoPath(opts.path) : null;
  const kind = opts.kind || 'working';
  let res;
  if (kind === 'working') {
    res = await git(['diff', '--no-color', '--no-ext-diff', '-U3', '--', pathArg], {
      cwd: repo.path, maxStdout: 16 * 1024 * 1024,
    });
    if (res.code === 0 && !res.stdout.trim() && opts.untracked) {
      res = await git(['diff', '--no-index', '--no-color', '-U3', '--', '/dev/null', pathArg], {
        cwd: repo.path, maxStdout: 16 * 1024 * 1024,
      });
    }
  } else if (kind === 'staged') {
    res = await git(['diff', '--cached', '--no-color', '--no-ext-diff', '-U3', '--', pathArg], {
      cwd: repo.path, maxStdout: 16 * 1024 * 1024,
    });
  } else if (kind === 'commit') {
    const sha = assertShaLike(opts.sha, '提交');
    const resolved = await gitOk(['rev-parse', '--verify', `${sha}^{commit}`], { cwd: repo.path });
    const fullSha = resolved.stdout.trim();
    const parents = await gitOk(['show', '-s', '--format=%P', fullSha], { cwd: repo.path });
    const base = parents.stdout.trim().split(' ')[0] || EMPTY_TREE;
    const diffArgs = ['diff', '--no-color', '--no-ext-diff', '-U3', base, fullSha];
    if (pathArg) diffArgs.push('--', pathArg);
    res = await git(diffArgs, { cwd: repo.path, maxStdout: 16 * 1024 * 1024 });
  } else if (kind === 'stash') {
    const stashRef = assertRefLike(opts.sha || 'stash@{0}', '贮藏');
    if (!/^stash@\{\d+\}$/.test(stashRef)) throw badRequest('无效的贮藏引用');
    const diffArgs = ['stash', 'show', '-p', '--no-color', stashRef];
    if (pathArg) diffArgs.push('--', pathArg);
    res = await git(diffArgs, { cwd: repo.path, maxStdout: 16 * 1024 * 1024 });
  } else {
    throw badRequest('未知的差异类型');
  }
  if (res.code !== 0 && res.code !== 1) {
    throw new AppError(cleanGitError(res.stderr) || '无法读取差异', { stderr: res.stderr });
  }
  return parseDiff(res.stdout);
}

export async function getFileContent(dir, opts) {
  const repo = await resolveRepo(dir);
  const p = safeRepoPath(opts.path);
  let buf;
  if (opts.working) {
    const full = path.join(repo.path, ...p.split('/'));
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      throw new AppError('文件不存在');
    }
    if (stat.size > 20 * 1024 * 1024) throw badRequest('文件过大，无法显示');
    buf = fs.readFileSync(full);
  } else {
    const rev = assertRefLike(opts.rev || 'HEAD', '版本');
    const res = await git(['show', `${rev}:${p}`], {
      cwd: repo.path,
      maxStdout: 20 * 1024 * 1024,
    });
    if (res.code !== 0) {
      throw new AppError(cleanGitError(res.stderr) || '无法读取文件内容', { stderr: res.stderr });
    }
    buf = res.stdoutBuffer;
  }
  if (isProbablyBinary(buf)) {
    return { binary: true, size: buf.length, content: '', path: p };
  }
  const maxChars = 1_500_000;
  let content = decodeText(buf);
  const truncated = content.length > maxChars;
  if (truncated) content = content.slice(0, maxChars);
  return {
    binary: false,
    size: buf.length,
    content,
    truncated,
    path: p,
    lines: content.split('\n').length,
  };
}

export async function getBlame(dir, opts) {
  const repo = await resolveRepo(dir);
  const p = safeRepoPath(opts.path);
  const rev = opts.rev ? assertRefLike(opts.rev, '版本') : null;
  const args = ['blame', '--line-porcelain', '--date=unix'];
  if (rev) args.push(rev);
  args.push('--', p);
  const res = await git(args, { cwd: repo.path, maxStdout: 32 * 1024 * 1024, timeout: 120_000 });
  if (res.code !== 0) {
    throw new AppError(cleanGitError(res.stderr) || '无法生成 Blame 信息', { stderr: res.stderr });
  }
  const lines = [];
  let current = null;
  for (const line of res.stdout.split('\n')) {
    const m = line.match(/^([0-9a-f]{40,64}) \d+ (\d+)(?: \d+)?$/);
    if (m) {
      current = { sha: m[1], line: Number(m[2]), author: '', time: 0, summary: '', text: '' };
      lines.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('\t')) {
      current.text = line.slice(1);
      continue;
    }
    if (line.startsWith('author ')) current.author = line.slice(7);
    else if (line.startsWith('author-time ')) current.time = Number(line.slice(12)) || 0;
    else if (line.startsWith('summary ')) current.summary = line.slice(8);
  }
  const maxLines = 8000;
  const truncated = lines.length > maxLines;
  return {
    path: p,
    rev: rev || 'HEAD',
    lines: truncated ? lines.slice(0, maxLines) : lines,
    truncated,
  };
}

export async function getFileHistory(dir, opts) {
  const result = await queryLog(dir, {
    limit: opts.limit || 200,
    rev: opts.rev || 'HEAD',
    path: opts.path,
  });
  return result;
}

function decodeBlobResult(res) {
  if (res.code !== 0) return null;
  const buf = res.stdoutBuffer;
  if (isProbablyBinary(buf)) {
    return { binary: true, content: '', size: buf.length };
  }
  let content = decodeText(buf);
  const truncated = content.length > 1_500_000;
  if (truncated) content = content.slice(0, 1_500_000);
  return { binary: false, content, size: buf.length, truncated };
}

export async function getConflict(dir, opts) {
  const repo = await resolveRepo(dir);
  const p = safeRepoPath(opts.path);
  const readStage = async (stage) => {
    const res = await git(['show', `:${stage}:${p}`], {
      cwd: repo.path,
      maxStdout: 8 * 1024 * 1024,
    });
    return decodeBlobResult(res);
  };
  const [base, ours, theirs] = await Promise.all([readStage(1), readStage(2), readStage(3)]);
  let working = null;
  try {
    const full = path.join(repo.path, ...p.split('/'));
    const stat = fs.statSync(full);
    if (stat.size <= 8 * 1024 * 1024) {
      const buf = fs.readFileSync(full);
      working = isProbablyBinary(buf)
        ? { binary: true, content: '', size: buf.length }
        : { binary: false, content: decodeText(buf), size: buf.length };
    }
  } catch {
    working = null;
  }
  return { path: p, base, ours, theirs, working };
}
