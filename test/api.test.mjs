import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.GIT_AUTHOR_NAME = process.env.GIT_AUTHOR_NAME || 'GitViewer Test';
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_AUTHOR_EMAIL || 'test@example.com';
process.env.GIT_COMMITTER_NAME = process.env.GIT_COMMITTER_NAME || 'GitViewer Test';
process.env.GIT_COMMITTER_EMAIL = process.env.GIT_COMMITTER_EMAIL || 'test@example.com';

const ROOT = path.resolve(import.meta.dirname, '..');
const WORK = path.join(ROOT, 'tmp', `api-test-${process.pid}`);
let server;
let rpcUrl;

async function rpc(method, params = {}) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, params }),
  });
  const json = await res.json();
  if (!json.ok) {
    const err = new Error(`${method}: ${json.error?.message}`);
    err.detail = json.error;
    throw err;
  }
  return json.data;
}

function write(repo, name, content) {
  const full = path.join(repo, ...name.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

before(async () => {
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });
  // Isolate settings / recent repositories from the user's real data directory.
  process.env.GITVIEWER_DATA = path.join(WORK, 'data');
  const { startServer } = await import('../server/index.mjs');
  server = await startServer({ port: 0, host: '127.0.0.1', keepAlive: true });
  rpcUrl = `${server.url}api/rpc`;
});

after(async () => {
  await server?.close();
  fs.rmSync(WORK, { recursive: true, force: true });
});

test('initializes a repository and commits files', async () => {
  const repo = path.join(WORK, 'basic');
  fs.mkdirSync(repo, { recursive: true });
  const snap = (await rpc('repo.init', { dir: repo })).snapshot;
  assert.equal(snap.head.branch, 'main');
  assert.equal(snap.head.unborn, true);
  assert.equal(snap.status.counts.total, 0);

  write(repo, 'hello world.txt', 'hello\n');
  write(repo, 'src/app.js', 'export const answer = 42;\n');
  let current = await rpc('repo.snapshot', { repo });
  assert.equal(current.status.counts.untracked, 2);

  await rpc('wc.stage', { repo, paths: ['hello world.txt', 'src/app.js'] });
  current = await rpc('repo.snapshot', { repo });
  assert.equal(current.status.counts.staged, 2);

  const commit = await rpc('commit.create', { repo, message: 'initial commit' });
  assert.match(commit.sha, /^[0-9a-f]{40}$/);
  current = await rpc('repo.snapshot', { repo });
  assert.equal(current.status.counts.total, 0);
  assert.equal(current.head.branch, 'main');

  const log = await rpc('repo.log', { repo, limit: 20, rev: 'ALL' });
  assert.equal(log.commits.length, 1);
  assert.equal(log.commits[0].subject, 'initial commit');
  assert.equal(log.commits[0].graph.lane, 0);

  const details = await rpc('repo.commit', { repo, sha: commit.sha });
  assert.equal(details.parents.length, 0);
  assert.equal(details.files.length, 2);
});

test('shows working, staged and commit diffs', async () => {
  const repo = path.join(WORK, 'basic');
  write(repo, 'src/app.js', 'export const answer = 43;\nexport const name = "demo";\n');
  const working = await rpc('repo.diff', { repo, kind: 'working', path: 'src/app.js' });
  assert.ok(working.hunks.length >= 1);
  assert.equal(working.adds, 2);
  assert.equal(working.dels, 1);

  write(repo, 'new-file.txt', 'brand new\n');
  const untracked = await rpc('repo.diff', {
    repo, kind: 'working', path: 'new-file.txt', untracked: true,
  });
  assert.ok(untracked.hunks.length >= 1);

  await rpc('wc.stage', { repo, paths: ['src/app.js', 'new-file.txt'] });
  const staged = await rpc('repo.diff', { repo, kind: 'staged', path: 'src/app.js' });
  assert.ok(staged.hunks.length >= 1);

  await rpc('commit.create', { repo, message: 'update app', paths: ['src/app.js', 'new-file.txt'] });
  const log = await rpc('repo.log', { repo, limit: 10, rev: 'HEAD' });
  const diff = await rpc('repo.diff', {
    repo, kind: 'commit', sha: log.commits[0].hash, path: 'src/app.js',
  });
  assert.ok(diff.hunks.length >= 1);
  assert.ok(diff.adds >= 1);
});

test('creates branches, merges and reports conflicts', async () => {
  const repo = path.join(WORK, 'merge');
  fs.mkdirSync(repo, { recursive: true });
  await rpc('repo.init', { dir: repo });
  write(repo, 'value.txt', 'base\n');
  await rpc('commit.create', { repo, message: 'base', paths: ['value.txt'] });

  await rpc('branch.create', { repo, name: 'feature/demo', checkout: true });
  write(repo, 'value.txt', 'feature\n');
  await rpc('commit.create', { repo, message: 'feature change', paths: ['value.txt'] });
  await rpc('branch.checkout', { repo, name: 'main' });
  write(repo, 'value.txt', 'main\n');
  await rpc('commit.create', { repo, message: 'main change', paths: ['value.txt'] });

  const merge = await rpc('branch.merge', { repo, name: 'feature/demo' });
  assert.equal(merge.conflicted, true);

  let snap = await rpc('repo.snapshot', { repo });
  assert.equal(snap.status.counts.conflicted, 1);
  assert.equal(snap.operation.merge, true);

  const conflict = await rpc('repo.conflict', { repo, path: 'value.txt' });
  assert.match(conflict.working.content, /<<<<<<<|=======/);
  assert.match(conflict.ours.content, /main/);
  assert.match(conflict.theirs.content, /feature/);

  await rpc('op.accept', { repo, path: 'value.txt', side: 'ours' });
  snap = await rpc('repo.snapshot', { repo });
  assert.equal(snap.status.counts.conflicted, 0);
  await rpc('commit.create', { repo, message: 'merge feature/demo' });
  snap = await rpc('repo.snapshot', { repo });
  assert.equal(snap.operation.merge, false);

  const log = await rpc('repo.log', { repo, limit: 30, rev: 'ALL' });
  const mergeCommit = log.commits.find((c) => c.parents.length === 2);
  assert.ok(mergeCommit, 'merge commit present');
  assert.ok(log.commits.every((c) => c.graph && c.graph.lane >= 0));
});

test('stages renames and deletions safely', async () => {
  const repo = path.join(WORK, 'rename');
  fs.mkdirSync(repo, { recursive: true });
  await rpc('repo.init', { dir: repo });
  write(repo, 'old name.txt', 'one\ntwo\n');
  await rpc('commit.create', { repo, message: 'add', paths: ['old name.txt'] });
  fs.renameSync(path.join(repo, 'old name.txt'), path.join(repo, 'new name.txt'));

  await rpc('wc.stage', { repo, paths: ['old name.txt', 'new name.txt'] });
  let snap = await rpc('repo.snapshot', { repo });
  const staged = snap.status.files.find((f) => f.group === 'staged');
  assert.equal(staged.code, 'R');
  assert.equal(staged.origPath, 'old name.txt');
  assert.equal(staged.path, 'new name.txt');

  const commit = await rpc('commit.create', {
    repo, message: 'rename file', paths: ['old name.txt', 'new name.txt'],
  });
  const details = await rpc('repo.commit', { repo, sha: commit.sha });
  assert.equal(details.files[0].code, 'R');
  assert.equal(details.files[0].origPath, 'old name.txt');
  assert.equal(details.files[0].path, 'new name.txt');
});

test('stores, applies and drops stashes', async () => {
  const repo = path.join(WORK, 'stash');
  fs.mkdirSync(repo, { recursive: true });
  await rpc('repo.init', { dir: repo });
  write(repo, 'file.txt', 'committed\n');
  await rpc('commit.create', { repo, message: 'base', paths: ['file.txt'] });

  write(repo, 'file.txt', 'stashed change\n');
  const saved = await rpc('stash.save', { repo, message: 'work in progress', includeUntracked: true });
  assert.equal(saved.empty, false);

  let snap = await rpc('repo.snapshot', { repo });
  assert.equal(snap.status.counts.total, 0);
  assert.equal(snap.stashes.length, 1);

  const diff = await rpc('repo.diff', { repo, kind: 'stash', sha: 'stash@{0}' });
  assert.ok(diff.hunks.length >= 1);
  assert.ok(diff.adds >= 1);

  await rpc('stash.apply', { repo, ref: 'stash@{0}', pop: false });
  snap = await rpc('repo.snapshot', { repo });
  assert.ok(snap.status.counts.total >= 1);
  await rpc('wc.discard', { repo, paths: ['file.txt'], untracked: [], removeUntracked: true });
  await rpc('stash.drop', { repo, ref: 'stash@{0}' });
  snap = await rpc('repo.snapshot', { repo });
  assert.equal(snap.stashes.length, 0);
});

test('creates and deletes tags', async () => {
  const repo = path.join(WORK, 'basic');
  await rpc('tag.create', { repo, name: 'v1.0.0', annotated: true, message: 'release 1.0' });
  let snap = await rpc('repo.snapshot', { repo });
  const tag = snap.refs.find((r) => r.type === 'tag' && r.name === 'v1.0.0');
  assert.ok(tag);
  assert.equal(tag.annotated, true);
  assert.ok(tag.date > 0);
  await rpc('tag.delete', { repo, name: 'v1.0.0' });
  snap = await rpc('repo.snapshot', { repo });
  assert.equal(snap.refs.some((r) => r.type === 'tag' && r.name === 'v1.0.0'), false);
});

test('handles unicode paths and content', async () => {
  const repo = path.join(WORK, 'unicode');
  fs.mkdirSync(repo, { recursive: true });
  await rpc('repo.init', { dir: repo });
  const name = '中文 文件.txt';
  write(repo, name, '第一行\n第二行\n');
  await rpc('commit.create', { repo, message: '添加中文文件', paths: [name] });
  write(repo, name, '第一行\n第二行修改\n第三行\n');

  const diff = await rpc('repo.diff', { repo, kind: 'working', path: name });
  assert.ok(diff.hunks.length >= 1);
  assert.equal(diff.adds, 2);
  const blame = await rpc('repo.blame', { repo, path: name });
  assert.equal(blame.lines.length, 3);
  assert.equal(blame.lines[0].text, '第一行');
});

test('initializes an existing non-empty project with a starter .gitignore', async () => {
  const repo = path.join(WORK, 'existing-project');
  fs.mkdirSync(repo, { recursive: true });
  write(repo, 'package.json', '{"name":"existing"}\n');
  write(repo, 'src/index.js', 'console.log("hello");\n');
  write(repo, 'node_modules/some-package/index.js', 'module.exports = 1;\n');

  const data = await rpc('repo.init', { dir: repo, createGitignore: true });
  assert.equal(data.initialized, true);
  assert.equal(data.snapshot.head.branch, 'main');
  assert.equal(fs.existsSync(path.join(repo, '.gitignore')), true);

  const paths = data.snapshot.status.files.map((f) => f.path);
  assert.ok(paths.includes('package.json'));
  assert.ok(paths.includes('src/index.js'));
  assert.ok(paths.includes('.gitignore'));
  assert.equal(paths.some((p) => p.startsWith('node_modules/')), false);

  await assert.rejects(
    () => rpc('repo.init', { dir: repo }),
    /已经是 Git 仓库/,
  );

  await rpc('wc.stage', { repo });
  const commit = await rpc('commit.create', { repo, message: 'initial import' });
  const details = await rpc('repo.commit', { repo, sha: commit.sha });
  const files = details.files.map((f) => f.path);
  assert.ok(files.includes('package.json'));
  assert.ok(files.includes('src/index.js'));
  assert.ok(files.includes('.gitignore'));
  assert.equal(files.some((p) => p.startsWith('node_modules/')), false);
});

