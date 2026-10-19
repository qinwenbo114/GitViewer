import { rpc, shutdownApp, sendBye } from './api.js';
import { state, resetLog, resetRepoState } from './state.js';
import {
  h, toast, errorDialog, confirmDialog, promptDialog, busy, copyText, contextMenu,
} from './dom.js';
import { icon } from './icons.js';
import { applyTheme, renderTopbar, renderRail, renderStatusbar, openSettings } from './shell.js';
import { renderHomeView } from './views/home.js';
import { renderLogView } from './views/log.js';
import { renderChangesView, fileKey } from './views/changes.js';
import { renderBranchesView } from './views/branches.js';
import { renderStashesView } from './views/stashes.js';
import { renderTagsView } from './views/tags.js';
import { renderConsoleView } from './views/console.js';
import { openDiff, showBlameOverlay, showOutputDialog } from './components/overlays.js';
import {
  openRepoDialog,
  cloneDialog,
  initDialog,
  addRemoteDialog,
  createBranchDialog,
  mergeRefPicker,
} from './components/dialogs.js';

let renderToken = 0;
let netBusy = false;
let detailsToken = 0;
let changeDiffToken = 0;
let stashDiffToken = 0;

const ctx = {
  state,
  render: () => render(),
  setView: (view) => setView(view),
  refreshAll: (opts) => refreshAll(opts),
  loadLog: () => loadLog(),
  selectCommit: (sha) => selectCommit(sha),
  filterByRef: (ref) => filterByRef(ref),
  showFileHistory: (path) => showFileHistory(path),
  showBlame: (spec) => showBlameOverlay(ctx, spec),
  openDiff: (spec) => openDiff(ctx, spec),
  openFile: (path) => openFile(path),
  revealPath: (path) => revealPath(path),
  revealRepo: () => revealRepo(),
  openRepoPath: (path) => openRepoPath(path),
  openRepoDialog: () => openRepoDialog(ctx),
  cloneDialog: () => cloneDialog(ctx),
  initDialog: () => initDialog(ctx),
  createBranchDialog: (start) => createBranchDialog(ctx, start),
  mergeRefPicker: () => mergeRefPicker(ctx),
  addRemoteDialog: () => addRemoteDialog(ctx),
  openSettings: () => openSettings(ctx),
  commitMenu: (sha, event) => commitMenu(sha, event),
  onRefClick: (ref) => filterByRef(ref),
  stageFiles: (paths) => stageFiles(paths),
  unstageFiles: (paths) => unstageFiles(paths),
  stageAll: () => stageAll(),
  unstageAll: () => unstageAll(),
  discardFiles: (files) => discardFiles(files),
  ignorePath: (path) => ignorePath(path),
  selectChangeFile: (file) => selectChangeFile(file),
  loadChangeDiff: () => loadChangeDiff(),
  updateCommitBar: () => updateCommitBar(),
  commitChanges: (push) => commitChanges(push),
  prefillAmendMessage: () => prefillAmendMessage(),
  acceptConflict: (file, side) => acceptConflict(file, side),
  markResolved: (paths) => markResolved(paths),
  abortOperation: () => abortOperation(),
  continueOperation: () => continueOperation(),
  checkoutBranch: (ref) => checkoutBranch(ref),
  mergeBranch: (ref) => mergeBranch(ref),
  rebaseBranch: (ref) => rebaseBranch(ref),
  createBranch: (name, start, checkout) => createBranch(name, start, checkout),
  deleteBranch: (ref) => deleteBranch(ref),
  renameBranch: (ref) => renameBranch(ref),
  pushBranchRef: (ref) => pushBranchRef(ref),
  checkoutTag: (tag) => checkoutTag(tag),
  createTag: (name, target, annotated, message) => createTag(name, target, annotated, message),
  deleteTag: (tag) => deleteTag(tag),
  pushTag: (tag) => pushTag(tag),
  saveStash: (message, includeUntracked) => saveStash(message, includeUntracked),
  applyStash: (ref, pop) => applyStash(ref, pop),
  dropStash: (ref) => dropStash(ref),
  selectStash: (ref) => selectStash(ref),
  netAction: (kind, opts) => netAction(kind, opts),
  cloneRepo: (url, dir) => cloneRepo(url, dir),
  initRepo: (dir, createGitignore) => initRepo(dir, createGitignore),
  addRemote: (name, url) => addRemote(name, url),
  removeRemote: (name) => removeRemote(name),
  fetchRemote: (name) => netAction('fetch', { remote: name }),
  removeRecent: (repo) => removeRecent(repo),
  recentMenu: (repo, event) => recentMenu(repo, event),
  saveSettings: (patch) => saveSettings(patch),
  isBusy: () => busy.count > 0,
  notify: (message, type) => toast(message, type),
  openCommitFromBlame: (sha) => {
    setView('log');
    selectCommit(sha);
  },
  revealDataDir: () => revealDataDir(),
  quit: () => quit(),
};

/* ------------------------------------------------------------------ helpers */

function applyThemeNow() {
  applyTheme(state.settings);
}

async function refreshRecent() {
  try {
    state.recent = await rpc('recent.list');
  } catch {
    /* ignore */
  }
}

function currentChangeFiles() {
  return state.snapshot?.status?.files || [];
}

function selectedChangeFile() {
  const files = currentChangeFiles();
  return files.find((f) => fileKey(f) === state.changes.selectedKey) || null;
}

function preferredFile(files) {
  for (const group of ['unstaged', 'untracked', 'staged', 'conflicted']) {
    const found = files.find((f) => f.group === group);
    if (found) return found;
  }
  return files[0] || null;
}

function syncChanges() {
  const files = currentChangeFiles();
  const keys = new Set(files.map(fileKey));
  for (const key of [...state.changes.checked]) {
    if (!keys.has(key)) state.changes.checked.delete(key);
  }
  const known = state.changes.known instanceof Set ? state.changes.known : new Set();
  for (const file of files) {
    const key = fileKey(file);
    if (!known.has(key) && file.group !== 'conflicted') state.changes.checked.add(key);
  }
  state.changes.known = keys;
  if (!state.changes.selectedKey || !keys.has(state.changes.selectedKey)) {
    const preferred = preferredFile(files);
    state.changes.selectedKey = preferred ? fileKey(preferred) : null;
    state.changes.diff = null;
    state.changes.diffError = null;
    state.changes.diffLoading = false;
    state.changes.conflict = null;
  }
}

function selectedStash() {
  return (state.snapshot?.stashes || []).find((s) => s.ref === state.stashes.selectedRef) || null;
}

function ensureStashSelection() {
  const stashes = state.snapshot?.stashes || [];
  if (!stashes.length) {
    state.stashes.selectedRef = null;
    state.stashes.diff = null;
    return;
  }
  if (!stashes.some((s) => s.ref === state.stashes.selectedRef)) {
    state.stashes.selectedRef = stashes[0].ref;
    state.stashes.diff = null;
  }
}

function showError(err) {
  errorDialog(err);
}

function confirmEnabled() {
  return state.settings.confirmDestructive !== false;
}

async function confirmDanger(opts) {
  if (!confirmEnabled()) return true;
  return confirmDialog(opts);
}

function commitMessageFor(details) {
  if (!details) return '';
  return details.body ? `${details.subject}\n\n${details.body}` : details.subject;
}

/* --------------------------------------------------------------- data loads */

async function fetchLog({ selectFirst = false } = {}) {
  if (!state.repo) return;
  const data = await rpc('repo.log', {
    repo: state.repo.path,
    limit: state.log.limit,
    rev: state.log.rev,
    grep: state.log.grep || null,
    path: state.log.path || null,
  });
  state.log.commits = data.commits;
  state.log.truncated = data.truncated;
  state.log.error = null;
  state.logStale = false;
  if (state.log.selectedSha && !data.commits.some((c) => c.hash === state.log.selectedSha)) {
    state.log.selectedSha = null;
    state.details = null;
  }
  if (!state.log.selectedSha && data.commits[0]) {
    state.log.selectedSha = data.commits[0].hash;
  }
  if (state.log.selectedSha) {
    await fetchDetails(state.log.selectedSha, { quiet: true });
  } else {
    state.details = null;
  }
}

async function fetchDetails(sha, { quiet = false } = {}) {
  const token = ++detailsToken;
  if (!quiet) {
    state.detailsLoading = true;
  }
  try {
    const details = await rpc('repo.commit', { repo: state.repo.path, sha });
    if (token !== detailsToken || state.log.selectedSha !== sha) return;
    state.details = details;
    state.detailsLoading = false;
  } catch (err) {
    if (token !== detailsToken) return;
    state.details = { error: err.message, hash: sha, short: sha.slice(0, 8) };
    state.detailsLoading = false;
    if (!quiet) showError(err);
  }
}

async function loadLog() {
  if (!state.repo) return;
  state.log.loading = true;
  render();
  try {
    await fetchLog({ selectFirst: true });
  } catch (err) {
    state.log.error = err.message;
    showError(err);
  } finally {
    state.log.loading = false;
    render();
  }
}

async function selectCommit(sha) {
  if (!sha) return;
  if (sha === state.log.selectedSha && state.details && !state.details.error) return;
  state.log.selectedSha = sha;
  state.details = null;
  state.detailsLoading = true;
  render();
  await fetchDetails(sha);
  render();
}

async function loadChangeDiff({ force = false } = {}) {
  const file = selectedChangeFile();
  if (!file) {
    state.changes.diff = null;
    state.changes.diffLoading = false;
    return;
  }
  if (!force && state.changes.diff) return;
  const token = ++changeDiffToken;
  state.changes.diffLoading = true;
  state.changes.diffError = null;
  if (file.group !== 'conflicted') state.changes.conflict = null;
  try {
    if (file.group === 'conflicted') {
      const conflict = await rpc('repo.conflict', {
        repo: state.repo.path,
        path: file.path,
      });
      const current = selectedChangeFile();
      if (token !== changeDiffToken || !current || fileKey(current) !== fileKey(file)) return;
      state.changes.conflict = conflict;
      state.changes.diff = null;
      state.changes.diffLoading = false;
      return;
    }
    const diff = await rpc('repo.diff', {
      repo: state.repo.path,
      kind: file.group === 'staged' ? 'staged' : 'working',
      path: file.path,
      untracked: file.group === 'untracked',
    });
    const current = selectedChangeFile();
    if (token !== changeDiffToken || !current || fileKey(current) !== fileKey(file)) return;
    state.changes.diff = diff;
    state.changes.conflict = null;
    state.changes.diffLoading = false;
  } catch (err) {
    if (token !== changeDiffToken) return;
    state.changes.diffError = err.message;
    state.changes.diffLoading = false;
  }
}

async function selectChangeFile(file) {
  const key = fileKey(file);
  if (key === state.changes.selectedKey && state.changes.diff) {
    render();
    return;
  }
  state.changes.selectedKey = key;
  state.changes.diff = null;
  state.changes.diffError = null;
  state.changes.conflict = null;
  state.changes.diffLoading = true;
  render();
  await loadChangeDiff({ force: true });
  render();
}

async function loadStashDiff({ force = false } = {}) {
  const stash = selectedStash();
  if (!stash) {
    state.stashes.diff = null;
    state.stashes.loading = false;
    return;
  }
  if (!force && state.stashes.diff) return;
  const token = ++stashDiffToken;
  state.stashes.loading = true;
  state.stashes.diffError = null;
  try {
    const diff = await rpc('repo.diff', {
      repo: state.repo.path,
      kind: 'stash',
      sha: stash.ref,
    });
    if (token !== stashDiffToken || state.stashes.selectedRef !== stash.ref) return;
    state.stashes.diff = diff;
    state.stashes.loading = false;
  } catch (err) {
    if (token !== stashDiffToken) return;
    state.stashes.diffError = err.message;
    state.stashes.loading = false;
  }
}

async function selectStash(ref) {
  if (ref === state.stashes.selectedRef && state.stashes.diff) return;
  state.stashes.selectedRef = ref;
  state.stashes.diff = null;
  state.stashes.diffError = null;
  state.stashes.loading = true;
  render();
  await loadStashDiff({ force: true });
  render();
}

async function refreshAll({ log = false } = {}) {
  if (!state.repo) {
    render();
    return;
  }
  try {
    state.snapshot = await rpc('repo.snapshot', { repo: state.repo.path });
    syncChanges();
    if (log || state.view === 'log') {
      await fetchLog({ selectFirst: !state.log.selectedSha });
    }
    if (state.view === 'changes' && selectedChangeFile()) {
      await loadChangeDiff({ force: true });
    }
    if (state.view === 'stashes') {
      ensureStashSelection();
      if (selectedStash()) await loadStashDiff({ force: true });
    }
  } catch (err) {
    showError(err);
  }
  render();
}

/* ------------------------------------------------------------- action plumbing */

async function perform(label, fn, { refresh = true, log = true, success = null, quiet = false } = {}) {
  if (busy.count > 0) {
    toast('已有操作正在进行，请稍候', 'warn');
    return null;
  }
  busy.begin(label);
  try {
    const data = await fn();
    if (refresh) await refreshAll({ log });
    if (success) toast(success, 'success');
    return data;
  } catch (err) {
    if (!quiet) showError(err);
    return null;
  } finally {
    busy.end();
  }
}

async function stageFiles(paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  await perform('正在暂存文件…', () => rpc('wc.stage', { repo: state.repo.path, paths: list }), {
    success: `已暂存 ${list.length} 个文件`,
  });
}

async function unstageFiles(paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  await perform('正在取消暂存…', () => rpc('wc.unstage', { repo: state.repo.path, paths: list }), {
    success: `已取消暂存 ${list.length} 个文件`,
  });
}

async function stageAll() {
  const files = currentChangeFiles().filter((f) => f.group === 'unstaged' || f.group === 'untracked');
  if (!files.length) return;
  await stageFiles([...new Set(files.map((f) => f.path))]);
}

async function unstageAll() {
  const files = currentChangeFiles().filter((f) => f.group === 'staged');
  if (!files.length) return;
  await unstageFiles([...new Set(files.map((f) => f.path))]);
}

async function discardFiles(files) {
  const list = files.filter(Boolean);
  if (!list.length) return;
  const paths = [...new Set(list.map((f) => f.path))];
  const untracked = [...new Set(list.filter((f) => f.group === 'untracked').map((f) => f.path))];
  const ok = await confirmDanger({
    title: '回滚更改',
    message: `确定要丢弃 ${paths.length} 个文件的本地更改吗？`,
    detail: untracked.length
      ? `其中 ${untracked.length} 个未跟踪文件会被永久删除。此操作无法撤销。`
      : '已暂存和未暂存的修改都会被丢弃，此操作无法撤销。',
    confirmText: '回滚更改',
    danger: true,
  });
  if (!ok) return;
  await perform('正在回滚更改…', () => rpc('wc.discard', {
    repo: state.repo.path,
    paths,
    untracked,
    removeUntracked: true,
  }), { success: '已回滚所选更改' });
}

async function ignorePath(path) {
  try {
    const data = await rpc('wc.ignore', { repo: state.repo.path, path });
    toast(data.added ? `已添加到 .gitignore：${data.pattern}` : '该路径已在 .gitignore 中', data.added ? 'success' : 'info');
    await refreshAll({ log: false });
  } catch (err) {
    showError(err);
  }
}

function updateCommitBar() {
  const box = document.getElementById('commit-box');
  box?.__update?.();
}

async function commitChanges(push = false) {
  if (!state.repo) return;
  const amend = state.changes.amend;
  const message = state.changes.message;
  if (!message.trim() && !amend) {
    toast('请先填写提交信息', 'warn');
    document.getElementById('commit-message')?.focus();
    return;
  }
  const checked = currentChangeFiles().filter((f) => state.changes.checked.has(fileKey(f)));
  const stagedCount = currentChangeFiles().filter((f) => f.group === 'staged').length;
  const merging = !!state.snapshot.operation?.merge;
  if (!checked.length && !stagedCount && !amend && !merging) {
    toast('没有可提交的更改', 'warn');
    return;
  }
  const paths = [...new Set(checked.map((f) => f.path))];
  const data = await perform('正在创建提交…', () => rpc('commit.create', {
    repo: state.repo.path,
    message,
    amend,
    paths,
    signoff: state.settings.commitSignoff,
  }), { refresh: false });
  if (!data) return;
  state.changes.message = '';
  state.changes.amend = false;
  state.changes.checked = new Set();
  state.changes.known = new Set();
  state.changes.selectedKey = null;
  state.changes.diff = null;
  state.log.selectedSha = null;
  state.details = null;
  state.logStale = true;
  await refreshAll({ log: true });
  toast(`提交成功 ${data.sha.slice(0, 8)}`, 'success');
  if (push) await netAction('push');
}

async function prefillAmendMessage() {
  try {
    const headSha = state.snapshot?.head?.sha;
    if (!headSha) return;
    let details = state.details;
    if (!details || details.hash !== headSha) {
      details = await rpc('repo.commit', { repo: state.repo.path, sha: headSha });
    }
    state.changes.amend = true;
    state.changes.message = commitMessageFor(details);
    render();
    document.getElementById('commit-message')?.focus();
  } catch (err) {
    showError(err);
  }
}

/* ------------------------------------------------------------------- network */

async function netAction(kind, opts = {}) {
  if (!state.repo) return;
  if (netBusy) {
    toast('已有网络操作正在进行，请稍候', 'warn');
    return;
  }
  const remotes = state.snapshot?.remotes || [];
  if (!remotes.length) {
    toast('仓库没有配置远程，请先在「分支」中配置远程', 'warn');
    return;
  }
  const labels = {
    fetch: '正在获取远程更新…',
    pull: '正在拉取远程更新…',
    push: '正在推送到远程…',
  };
  const methods = { fetch: 'net.fetch', pull: 'net.pull', push: 'net.push' };
  netBusy = true;
  busy.begin(labels[kind] || '正在同步…');
  try {
    const data = await rpc(methods[kind], {
      repo: state.repo.path,
      ...(kind === 'pull' ? { mode: opts.mode || state.settings.pullMode } : {}),
      ...(kind === 'push' ? { force: !!opts.force } : {}),
      ...(kind === 'fetch' && opts.remote ? { remote: opts.remote } : {}),
    });
    await refreshAll({ log: true });
    if (data?.conflicted) {
      toast(`${kind === 'pull' ? '拉取' : '同步'}产生了冲突，请在「本地变更」中解决`, 'warn', { duration: 7000 });
      setView('changes');
    } else {
      const label = kind === 'fetch' ? '获取完成' : kind === 'pull' ? '拉取完成' : '推送完成';
      toast(label, 'success', {
        action: data?.output
          ? { label: '查看输出', onClick: () => showOutputDialog(label, data.output) }
          : null,
      });
    }
  } catch (err) {
    showError(err);
  } finally {
    netBusy = false;
    busy.end();
  }
}

/* ----------------------------------------------------------------- branches */

async function checkoutBranch(ref) {
  const name = ref.name;
  const data = await perform(`正在检出 ${name}…`, () => rpc('branch.checkout', {
    repo: state.repo.path,
    name,
    remote: ref.type === 'remote',
  }), { success: `已切换到 ${ref.type === 'remote' ? name.split('/').slice(1).join('/') : name}` });
  if (data) state.logStale = true;
}

async function mergeBranch(ref) {
  const current = state.snapshot?.head?.branch || 'HEAD';
  const ok = await confirmDanger({
    title: '合并分支',
    message: `将 ${ref.name} 合并到 ${current}？`,
    detail: '如果存在冲突，GitViewer 会切换到「本地变更」并标记冲突文件。',
    confirmText: '合并',
  });
  if (!ok) return;
  const data = await perform(`正在合并 ${ref.name}…`, () => rpc('branch.merge', {
    repo: state.repo.path,
    name: ref.name,
  }), { refresh: false });
  if (!data) return;
  state.logStale = true;
  await refreshAll({ log: true });
  if (data.conflicted) {
    toast('合并产生冲突，请解决后提交', 'warn', { duration: 7000 });
    setView('changes');
  } else {
    toast(`已合并 ${ref.name}`, 'success');
  }
}

async function rebaseBranch(ref) {
  const current = state.snapshot?.head?.branch || 'HEAD';
  const ok = await confirmDanger({
    title: '变基当前分支',
    message: `将 ${current} 变基到 ${ref.name}？`,
    detail: '变基会重写当前分支的提交历史。如果该分支已经推送到远程，请谨慎使用。',
    confirmText: '开始变基',
    danger: true,
  });
  if (!ok) return;
  const data = await perform(`正在变基到 ${ref.name}…`, () => rpc('branch.rebase', {
    repo: state.repo.path,
    name: ref.name,
  }), { refresh: false });
  if (!data) return;
  state.logStale = true;
  await refreshAll({ log: true });
  if (data.conflicted) {
    toast('变基产生冲突，请解决冲突后继续', 'warn', { duration: 7000 });
    setView('changes');
  } else {
    toast(`已将 ${current} 变基到 ${ref.name}`, 'success');
  }
}

async function createBranch(name, start, checkout = true) {
  await perform('正在创建分支…', () => rpc('branch.create', {
    repo: state.repo.path,
    name,
    start: start === 'HEAD' ? null : start,
    checkout,
  }), { success: `已创建分支 ${name}` });
  state.logStale = true;
}

async function deleteBranch(ref) {
  if (busy.count > 0) {
    toast('已有操作正在进行，请稍候', 'warn');
    return;
  }
  const ok = await confirmDanger({
    title: '删除分支',
    message: `确定要删除分支 ${ref.name} 吗？`,
    detail: '如果分支包含尚未合并的提交，删除可能会失败，之后可以选择强制删除。',
    confirmText: '删除',
    danger: true,
  });
  if (!ok) return;
  busy.begin('正在删除分支…');
  try {
    await rpc('branch.delete', { repo: state.repo.path, name: ref.name });
    await refreshAll({ log: true });
    toast(`已删除分支 ${ref.name}`, 'success');
  } catch (err) {
    const canForce = /not fully merged|未合并/i.test(err.message || '');
    if (canForce) {
      const force = await confirmDanger({
        title: '分支尚未合并',
        message: `分支 ${ref.name} 包含未合并到当前分支的提交。仍要强制删除吗？`,
        detail: '强制删除会丢失该分支上未合并的提交。',
        confirmText: '强制删除',
        danger: true,
      });
      if (force) {
        try {
          await rpc('branch.delete', { repo: state.repo.path, name: ref.name, force: true });
          await refreshAll({ log: true });
          toast(`已强制删除分支 ${ref.name}`, 'success');
        } catch (forceErr) {
          showError(forceErr);
        }
      }
    } else {
      showError(err);
    }
  } finally {
    busy.end();
  }
}

async function renameBranch(ref) {
  const name = await promptDialog({
    title: '重命名分支',
    label: '新的分支名称',
    value: ref.name,
    confirmText: '重命名',
  });
  if (!name || name === ref.name) return;
  await perform('正在重命名分支…', () => rpc('branch.rename', {
    repo: state.repo.path,
    name: ref.name,
    newName: name,
  }), { success: `分支已重命名为 ${name}` });
  state.logStale = true;
}

async function pushBranchRef(ref) {
  const current = state.snapshot?.head?.branch;
  if (ref.name === current) {
    await netAction('push');
    return;
  }
  await perform(`正在推送 ${ref.name}…`, () => rpc('net.push', {
    repo: state.repo.path,
    branch: ref.name,
  }), { success: `已推送分支 ${ref.name}` });
}

async function checkoutTag(tag) {
  const ok = await confirmDanger({
    title: '检出标签',
    message: `检出标签 ${tag.name}？`,
    detail: '标签对应的提交不是分支，检出后会进入分离 HEAD 状态。',
    confirmText: '检出',
  });
  if (!ok) return;
  await perform('正在检出标签…', () => rpc('branch.checkout', {
    repo: state.repo.path,
    name: tag.name,
  }), { success: `已检出标签 ${tag.name}` });
  state.logStale = true;
}

async function createTag(name, target, annotated, message) {
  const refs = state.snapshot?.refs || [];
  const targetRef = refs.find((r) => r.fullName === target);
  const sha = targetRef ? targetRef.sha : null;
  await perform('正在创建标签…', () => rpc('tag.create', {
    repo: state.repo.path,
    name,
    sha,
    annotated,
    message,
  }), { success: `已创建标签 ${name}` });
}

async function deleteTag(tag) {
  const ok = await confirmDanger({
    title: '删除标签',
    message: `确定要删除标签 ${tag.name} 吗？`,
    detail: '这只会删除本地标签，不会删除远程标签。',
    confirmText: '删除',
    danger: true,
  });
  if (!ok) return;
  await perform('正在删除标签…', () => rpc('tag.delete', {
    repo: state.repo.path,
    name: tag.name,
  }), { success: `已删除标签 ${tag.name}` });
}

async function pushTag(tag) {
  await perform(`正在推送标签 ${tag.name}…`, () => rpc('tag.push', {
    repo: state.repo.path,
    name: tag.name,
  }), { success: `已推送标签 ${tag.name}` });
}

/* -------------------------------------------------------------------- stash */

async function saveStash(message, includeUntracked) {
  const data = await perform('正在贮藏更改…', () => rpc('stash.save', {
    repo: state.repo.path,
    message,
    includeUntracked,
  }), { refresh: false });
  if (!data) return;
  await refreshAll({ log: false });
  toast(data.empty ? '没有可贮藏的更改' : '已创建贮藏', data.empty ? 'info' : 'success');
}

async function applyStash(ref, pop) {
  const data = await perform(pop ? '正在弹出贮藏…' : '正在应用贮藏…', () => rpc('stash.apply', {
    repo: state.repo.path,
    ref,
    pop,
  }), { refresh: false });
  if (!data) return;
  await refreshAll({ log: false });
  if (data.conflicted) {
    toast('应用贮藏时产生冲突，请在「本地变更」中解决', 'warn', { duration: 7000 });
    setView('changes');
  } else {
    toast(pop ? '已弹出贮藏' : '已应用贮藏', 'success');
  }
}

async function dropStash(ref) {
  const ok = await confirmDanger({
    title: '删除贮藏',
    message: `确定要删除 ${ref} 吗？`,
    detail: '删除后无法恢复。',
    confirmText: '删除',
    danger: true,
  });
  if (!ok) return;
  await perform('正在删除贮藏…', () => rpc('stash.drop', {
    repo: state.repo.path,
    ref,
  }), { success: '已删除贮藏' });
}

/* --------------------------------------------------------------- conflicts */

async function acceptConflict(file, side) {
  await perform('正在解决冲突…', () => rpc('op.accept', {
    repo: state.repo.path,
    path: file.path,
    side,
  }), { success: `已使用${side === 'ours' ? '我的' : '对方'}版本：${file.path}` });
}

async function markResolved(paths) {
  await perform('正在标记冲突…', () => rpc('op.resolve', {
    repo: state.repo.path,
    paths,
  }), { success: '已标记为已解决' });
}

async function abortOperation() {
  const ok = await confirmDanger({
    title: '中止当前操作',
    message: '确定要中止当前进行中的 Git 操作吗？',
    detail: '已经解决的冲突和未提交的更改可能会保留在工作区。',
    confirmText: '中止',
    danger: true,
  });
  if (!ok) return;
  await perform('正在中止操作…', () => rpc('op.abort', { repo: state.repo.path }), {
    success: '已中止操作',
  });
  state.logStale = true;
}

async function continueOperation() {
  const data = await perform('正在继续操作…', () => rpc('op.continue', { repo: state.repo.path }), {
    refresh: false,
  });
  if (!data) return;
  await refreshAll({ log: true });
  if (data.conflicted) {
    toast('仍有冲突未解决', 'warn');
    setView('changes');
  } else {
    toast('操作已完成', 'success');
  }
}

/* ---------------------------------------------------------------- commit menu */

async function resetToCommit(sha, mode) {
  const labels = { soft: 'Soft（保留更改与暂存）', mixed: 'Mixed（保留工作区更改）', hard: 'Hard（丢弃所有更改）' };
  const ok = await confirmDanger({
    title: '重置当前分支',
    message: `将当前分支重置到 ${sha.slice(0, 8)}？`,
    detail: `模式：${labels[mode]}${mode === 'hard' ? '。这会永久丢弃未提交的更改。' : ''}`,
    confirmText: '重置',
    danger: mode === 'hard',
  });
  if (!ok) return;
  await perform('正在重置分支…', () => rpc('commit.reset', {
    repo: state.repo.path,
    sha,
    mode,
  }), { success: '已重置当前分支' });
  state.logStale = true;
}

function commitMenu(sha, event) {
  const commit = state.log.commits.find((c) => c.hash === sha);
  const headSha = state.snapshot?.head?.sha;
  const items = [
    { label: '查看提交详情', icon: 'eye', onClick: () => selectCommit(sha) },
    {
      label: '复制提交哈希',
      icon: 'copy',
      onClick: async () => { await copyText(sha); toast('已复制提交哈希', 'success'); },
    },
    {
      label: '复制提交信息',
      icon: 'copy',
      disabled: !commit,
      onClick: async () => { await copyText(commit?.subject || ''); toast('已复制提交信息', 'success'); },
    },
    { separator: true },
    {
      label: '检出此提交（分离 HEAD）',
      icon: 'check',
      onClick: async () => {
        const ok = await confirmDanger({
          title: '检出提交',
          message: `检出 ${sha.slice(0, 8)}？`,
          detail: '这会进入分离 HEAD 状态，不会修改任何分支。',
          confirmText: '检出',
        });
        if (!ok) return;
        await perform('正在检出提交…', () => rpc('branch.checkout', { repo: state.repo.path, name: sha }), {
          success: `已检出 ${sha.slice(0, 8)}`,
        });
        state.logStale = true;
      },
    },
    {
      label: '在此提交新建分支…',
      icon: 'branch',
      onClick: () => createBranchDialog(ctx, sha),
    },
    {
      label: '在此提交新建标签…',
      icon: 'tag',
      onClick: async () => {
        const name = await promptDialog({ title: '新建标签', label: '标签名称', placeholder: '例如 v1.1.0', confirmText: '创建' });
        if (!name) return;
        await perform('正在创建标签…', () => rpc('tag.create', {
          repo: state.repo.path, name, sha, annotated: false,
        }), { success: `已创建标签 ${name}` });
      },
    },
    { separator: true },
    {
      label: '拣选到当前分支（Cherry-pick）',
      icon: 'git',
      onClick: async () => {
        const ok = await confirmDanger({
          title: '拣选提交',
          message: `将 ${sha.slice(0, 8)} 拣选到当前分支？`,
          confirmText: '拣选',
        });
        if (!ok) return;
        const data = await perform('正在拣选提交…', () => rpc('commit.cherryPick', {
          repo: state.repo.path, sha,
        }), { refresh: false });
        if (!data) return;
        await refreshAll({ log: true });
        if (data.conflicted) {
          toast('拣选产生冲突，请解决冲突', 'warn');
          setView('changes');
        } else {
          toast('拣选完成', 'success');
        }
      },
    },
    {
      label: '还原此提交（Revert）',
      icon: 'undo',
      onClick: async () => {
        const ok = await confirmDanger({
          title: '还原提交',
          message: `创建一个还原 ${sha.slice(0, 8)} 的新提交？`,
          confirmText: '还原',
          danger: true,
        });
        if (!ok) return;
        const data = await perform('正在还原提交…', () => rpc('commit.revert', {
          repo: state.repo.path, sha,
        }), { refresh: false });
        if (!data) return;
        await refreshAll({ log: true });
        if (data.conflicted) {
          toast('还原产生冲突，请解决冲突', 'warn');
          setView('changes');
        } else {
          toast('还原完成', 'success');
        }
      },
    },
    { separator: true },
    {
      label: '将当前分支重置到此提交（Soft）',
      icon: 'history',
      onClick: () => resetToCommit(sha, 'soft'),
    },
    {
      label: '将当前分支重置到此提交（Mixed）',
      icon: 'history',
      onClick: () => resetToCommit(sha, 'mixed'),
    },
    {
      label: '将当前分支重置到此提交（Hard）',
      icon: 'warning',
      danger: true,
      onClick: () => resetToCommit(sha, 'hard'),
    },
  ];
  if (sha === headSha) {
    items.unshift({
      label: '修正此提交…',
      icon: 'edit',
      onClick: async () => {
        await setView('changes');
        state.changes.amend = true;
        state.changes.message = commitMessageFor(commit);
        render();
        document.getElementById('commit-message')?.focus();
      },
    });
  }
  contextMenu(event, items);
}

/* -------------------------------------------------------------------- views */

async function setView(view) {
  if (!state.repo) {
    state.view = 'home';
    render();
    return;
  }
  if (state.view === view) {
    render();
    return;
  }
  state.view = view;
  render();
  if (view === 'log' && (state.logStale || !state.log.commits.length)) {
    await loadLog();
  } else if (view === 'changes') {
    if (selectedChangeFile() && !state.changes.diff) {
      await loadChangeDiff({ force: true });
      render();
    }
  } else if (view === 'stashes') {
    ensureStashSelection();
    if (selectedStash() && !state.stashes.diff) {
      await loadStashDiff({ force: true });
      render();
    }
  }
}

function showFileHistory(path) {
  state.view = 'log';
  state.log.path = path;
  state.log.grep = '';
  state.log.rev = 'HEAD';
  state.log.limit = 250;
  state.log.commits = [];
  state.log.selectedSha = null;
  state.details = null;
  state.logStale = true;
  render();
  loadLog();
}

function filterByRef(ref) {
  state.view = 'log';
  state.log.rev = ref.fullName || ref.name;
  state.log.path = null;
  state.log.grep = '';
  state.log.limit = 250;
  state.log.commits = [];
  state.log.selectedSha = null;
  state.details = null;
  state.logStale = true;
  render();
  loadLog();
}

async function openFile(path) {
  try {
    await rpc('shell.open', { repo: state.repo.path, path });
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function revealPath(path) {
  try {
    await rpc('shell.reveal', { repo: state.repo.path, path, select: true });
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function revealRepo() {
  if (!state.repo) return;
  try {
    await rpc('shell.reveal', { repo: state.repo.path, path: '', select: false });
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function revealDataDir() {
  const dir = state.appInfo?.dataDir;
  if (!dir) return;
  try {
    await rpc('shell.reveal', { repo: dir, path: dir });
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ------------------------------------------------------------------ lifecycle */

async function openRepoPath(path, { silent = false } = {}) {
  if (!path || state.repoLoading) return;
  state.repoLoading = true;
  busy.begin('正在打开仓库…');
  try {
    const snapshot = await rpc('repo.open', { path });
    state.repo = snapshot.repo;
    state.snapshot = snapshot;
    state.booted = true;
    state.view = 'log';
    resetLog();
    state.changes = {
      selectedKey: null,
      diff: null,
      diffLoading: false,
      diffError: null,
      conflict: null,
      conflictMode: 'working',
      message: '',
      amend: false,
      includeUntracked: false,
      checked: new Set(),
      known: new Set(),
      collapsed: new Set(),
      scrollTop: 0,
      diffMode: null,
    };
    state.stashes = { selectedRef: null, diff: null, loading: false };
    syncChanges();
    state.log.commits = [];
    state.log.selectedSha = null;
    state.details = null;
    await fetchLog({ selectFirst: true });
    await refreshRecent();
    document.title = `${snapshot.repo.name} — GitViewer`;
    render();
    if (state.settings.fetchOnOpen && snapshot.remotes.length) {
      netAction('fetch');
    }
  } catch (err) {
    if (!silent) showError(err);
    else toast(`无法打开仓库：${err.message}`, 'error', { duration: 7000 });
    resetRepoState();
    state.booted = true;
    state.view = 'home';
    render();
  } finally {
    busy.end();
    state.repoLoading = false;
  }
}

async function cloneRepo(url, dir) {
  if (busy.count > 0) {
    toast('已有操作正在进行，请稍候', 'warn');
    return;
  }
  busy.begin('正在克隆仓库（可能需要几分钟）…');
  try {
    const data = await rpc('repo.clone', { url, dir });
    const snapshot = data.snapshot;
    state.repo = snapshot.repo;
    state.snapshot = snapshot;
    state.booted = true;
    state.view = 'log';
    resetLog();
    state.changes = {
      selectedKey: null, diff: null, diffLoading: false, diffError: null,
      conflict: null, conflictMode: 'working',
      message: '', amend: false, checked: new Set(), known: new Set(), collapsed: new Set(),
      scrollTop: 0, diffMode: null,
    };
    syncChanges();
    await fetchLog({ selectFirst: true });
    await refreshRecent();
    document.title = `${snapshot.repo.name} — GitViewer`;
    render();
    toast('仓库克隆完成', 'success', {
      action: data.output ? { label: '查看输出', onClick: () => showOutputDialog('克隆输出', data.output) } : null,
    });
  } catch (err) {
    showError(err);
  } finally {
    busy.end();
  }
}

async function initRepo(dir, createGitignore = true) {
  if (busy.count > 0) {
    toast('已有操作正在进行，请稍候', 'warn');
    return;
  }
  busy.begin('正在初始化 Git 仓库…');
  try {
    const data = await rpc('repo.init', { dir, createGitignore });
    const snapshot = data.snapshot;
    state.repo = snapshot.repo;
    state.snapshot = snapshot;
    state.booted = true;
    state.view = 'changes';
    resetLog();
    state.changes = {
      selectedKey: null, diff: null, diffLoading: false, diffError: null,
      conflict: null, conflictMode: 'working',
      message: '', amend: false, checked: new Set(), known: new Set(), collapsed: new Set(),
      scrollTop: 0, diffMode: null,
    };
    state.log.commits = [];
    state.log.selectedSha = null;
    state.details = null;
    state.logStale = true;
    syncChanges();
    await loadChangeDiff({ force: true });
    await refreshRecent();
    document.title = `${snapshot.repo.name} — GitViewer`;
    render();
    const count = snapshot.status.counts.total;
    toast(
      count
        ? `已初始化 Git 仓库，${count} 个文件待提交`
        : '已初始化 Git 仓库',
      'success',
      { duration: 6000 },
    );
  } catch (err) {
    showError(err);
  } finally {
    busy.end();
  }
}

async function addRemote(name, url) {
  await perform('正在添加远程…', () => rpc('remote.add', {
    repo: state.repo.path, name, url,
  }), { success: `已添加远程 ${name}` });
}

async function removeRemote(name) {
  const ok = await confirmDanger({
    title: '移除远程仓库',
    message: `确定要移除远程 ${name} 吗？`,
    detail: '本地分支和提交不会被删除，但将无法再向该远程推送或拉取。',
    confirmText: '移除',
    danger: true,
  });
  if (!ok) return;
  await perform(`正在移除远程 ${name}…`, () => rpc('remote.remove', {
    repo: state.repo.path, name,
  }), { success: `已移除远程 ${name}` });
}

async function removeRecent(repo) {
  try {
    await rpc('recent.remove', { path: repo.path });
    state.recent = state.recent.filter((r) => r.path !== repo.path);
    render();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function recentMenu(repo, event) {
  contextMenu(event, [
    { label: '打开仓库', icon: 'folderOpen', disabled: !repo.exists, onClick: () => openRepoPath(repo.path) },
    { label: '在资源管理器中显示', icon: 'external', disabled: !repo.exists, onClick: () => rpc('shell.reveal', { repo: repo.path, path: '' }).catch((err) => toast(err.message, 'error')) },
    { label: '复制路径', icon: 'copy', onClick: async () => { await copyText(repo.path); toast('已复制路径', 'success'); } },
    { separator: true },
    { label: '从最近列表移除', icon: 'x', onClick: () => removeRecent(repo) },
  ]);
}

function closeRepo() {
  resetRepoState();
  state.view = 'home';
  state.log = {
    commits: [], limit: 250, rev: 'HEAD', grep: '', path: null,
    loading: false, truncated: false, scrollTop: 0, selectedSha: null, error: null,
  };
  document.title = 'GitViewer';
  render();
}

async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  applyThemeNow();
  render();
  try {
    await rpc('settings.save', { settings: patch });
    toast('设置已保存', 'success');
  } catch (err) {
    showError(err);
  }
}

function quit() {
  shutdownApp();
}

/* --------------------------------------------------------------------- render */

function render() {
  if (!state.booted) return;
  const token = ++renderToken;  const active = document.activeElement;
  const focusId = active?.id || '';
  let selection = null;
  if (active && typeof active.selectionStart === 'number') {
    selection = [active.selectionStart, active.selectionEnd];
  }
  const scrolls = {};
  for (const el of document.querySelectorAll('[data-scroll]')) {
    scrolls[el.dataset.scroll] = el.scrollTop;
  }

  const topbar = renderTopbar(ctx);
  const oldTop = document.getElementById('topbar');
  if (oldTop) oldTop.replaceWith(topbar); else document.body.prepend(topbar);

  const workspace = document.querySelector('.workspace');
  const rail = renderRail(ctx);
  const oldRail = document.getElementById('rail');
  if (rail) {
    if (oldRail) oldRail.replaceWith(rail);
    workspace.classList.remove('no-repo');
  } else {
    if (oldRail) {
      oldRail.replaceWith(h('nav', { class: 'rail empty', id: 'rail' }));
    }
    workspace.classList.add('no-repo');
  }

  const content = document.getElementById('content');
  let viewEl;
  try {
    if (!state.repo || state.view === 'home') {
      viewEl = renderHomeView(ctx);
    } else if (state.view === 'changes') {
      viewEl = renderChangesView(ctx);
    } else if (state.view === 'branches') {
      viewEl = renderBranchesView(ctx);
    } else if (state.view === 'stashes') {
      viewEl = renderStashesView(ctx);
    } else if (state.view === 'tags') {
      viewEl = renderTagsView(ctx);
    } else if (state.view === 'console') {
      viewEl = renderConsoleView(ctx);
    } else {
      viewEl = renderLogView(ctx);
    }
  } catch (err) {
    console.error(err);
    viewEl = h('div', { class: 'view-error' },
      h('div', { class: 'empty-icon', html: icon('alert', 32) }),
      h('div', {}, '界面渲染失败'),
      h('pre', {}, String(err.stack || err.message || err)));
  }
  content.replaceChildren(viewEl);

  const statusbar = renderStatusbar(ctx);
  const oldStatus = document.getElementById('statusbar');
  if (oldStatus) oldStatus.replaceWith(statusbar); else document.body.append(statusbar);

  document.body.dataset.view = state.repo ? state.view : 'home';
  document.body.dataset.repo = state.repo ? '1' : '0';

  requestAnimationFrame(() => {
    if (token !== renderToken) return;
    for (const el of document.querySelectorAll('[data-scroll]')) {
      const value = scrolls[el.dataset.scroll];
      if (value != null) el.scrollTop = value;
    }
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el && typeof el.focus === 'function') {
        el.focus();
        if (selection && typeof el.setSelectionRange === 'function') {
          try {
            el.setSelectionRange(selection[0], selection[1]);
          } catch {
            /* not a text input */
          }
        }
      }
    }
  });
}

/* ----------------------------------------------------------------------- boot */

function bindGlobalKeys() {
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    const target = event.target;
    const tag = target?.tagName;
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || target?.isContentEditable;
    if (event.key === 'F5') {
      event.preventDefault();
      refreshAll({ log: true });
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      openRepoDialog(ctx);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      const searchEl = document.querySelector('#log-search, #branch-search, #tag-search, #console-search');
      if (searchEl) {
        event.preventDefault();
        searchEl.focus();
        searchEl.select?.();
      }
      return;
    }
    if (event.altKey && /^[1-6]$/.test(event.key) && state.repo) {
      event.preventDefault();
      const views = ['log', 'changes', 'branches', 'stashes', 'tags', 'console'];
      setView(views[Number(event.key) - 1]);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && state.view === 'changes' && (target?.id === 'commit-message' || !typing)) {
      event.preventDefault();
      commitChanges(false);
      return;
    }
    if (!typing && state.view === 'log' && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      const commits = state.log.commits;
      if (!commits.length) return;
      event.preventDefault();
      const index = commits.findIndex((c) => c.hash === state.log.selectedSha);
      const nextIndex = Math.max(0, Math.min(commits.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
      const next = commits[nextIndex];
      if (next) {
        selectCommit(next.hash);
        requestAnimationFrame(() => {
          document.querySelector(`[data-sha="${next.hash}"]`)?.scrollIntoView({ block: 'nearest' });
        });
      }
    }
  });
}

async function boot() {
  bindGlobalKeys();
  try {
    const data = await rpc('app.bootstrap');
    state.settings = { ...state.settings, ...data.settings };
    state.recent = data.recent || [];
    state.appInfo = data.appInfo || {};
    state.demo = data.demo || null;
    applyThemeNow();
    state.booted = true;
    const params = new URLSearchParams(window.location.search);
    const repoParam = params.get('repo');
    const target = repoParam || data.lastRepo;
    if (target) {
      await openRepoPath(target, { silent: !repoParam });
    } else {
      state.view = 'home';
      render();
    }
    const requestedView = params.get('view');
    const revParam = params.get('rev');
    const pathParam = params.get('path');
    if ((revParam || pathParam) && state.repo) {
      state.log.rev = revParam || 'HEAD';
      state.log.path = pathParam || null;
      await loadLog();
    }
    if (requestedView && state.repo) {
      await setView(requestedView);
    }
    const commitParam = params.get('commit');
    if (commitParam && state.repo && state.view === 'log') {
      await selectCommit(commitParam);
    }
    const fileParam = params.get('file');
    if (fileParam && state.repo) {
      if (state.view === 'changes') {
        const file = currentChangeFiles().find((f) => f.path === fileParam);
        if (file) await selectChangeFile(file);
      } else if (commitParam) {
        await openDiff(ctx, { kind: 'commit', sha: commitParam, path: fileParam });
      } else {
        showFileHistory(fileParam);
      }
    }
    if (params.get('settings') === '1') openSettings(ctx);
  } catch (err) {
    state.booted = true;
    state.view = 'home';
    render();
    showError(err);
  }
}

window.addEventListener('pagehide', () => {
  sendBye();
});

// Keep the local service alive while the window is open. Closing the last
// window stops the heartbeat and the server exits after a short grace period.
setInterval(() => {
  fetch('/api/ping', { cache: 'no-store' }).catch(() => {});
}, 5000);

boot();
