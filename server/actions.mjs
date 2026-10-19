import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { git, gitOk, cleanGitError } from './git.mjs';
import {
  AppError,
  assertRefLike,
  assertShaLike,
  badRequest,
  normalizeRepoPath,
  safeRepoPath,
} from './util.mjs';
import {
  getOperationState,
  getRefs,
  getRemotes,
  getSnapshot,
  resolveRepo,
} from './repo.mjs';
import { DATA_DIR, getRecent, readSettings, removeRecent, saveSettings, touchRecent } from './store.mjs';

const PULL_MODES = new Set(['merge', 'rebase', 'ff-only']);
const RESET_MODES = new Set(['soft', 'mixed', 'hard']);

async function repoOf(dir) {
  return resolveRepo(dir);
}

function requireMessage(message) {
  if (typeof message !== 'string' || !message.trim()) {
    throw badRequest('请输入提交信息');
  }
  return message.replace(/\r\n/g, '\n').replace(/\s+$/, '');
}

function cleanPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return [];
  return [...new Set(paths.map((p) => safeRepoPath(p)))];
}

/**
 * Keep only pathspecs git can stage: files present in the worktree, or tracked
 * paths whose deletion is being staged. This avoids "pathspec did not match"
 * failures for the source side of an already-staged rename.
 */
async function stageablePaths(repo, paths) {
  const existing = [];
  const missing = [];
  for (const p of paths) {
    const full = path.join(repo.path, ...p.split('/'));
    if (fs.existsSync(full)) existing.push(p);
    else missing.push(p);
  }
  let tracked = [];
  if (missing.length) {
    const res = await git(['ls-files', '-z', '--', ...missing], { cwd: repo.path });
    if (res.code === 0) {
      tracked = res.stdout.split('\0').filter(Boolean);
    }
  }
  return [...new Set([...existing, ...tracked])];
}

async function checkBranchName(repo, name) {
  assertRefLike(name, '分支名');
  const res = await git(['check-ref-format', '--branch', name], { cwd: repo.path });
  if (res.code !== 0) throw badRequest(`分支名不合法：${name}`);
  return name;
}

async function checkTagName(repo, name) {
  assertRefLike(name, '标签名');
  const res = await git(['check-ref-format', `refs/tags/${name}`], { cwd: repo.path });
  if (res.code !== 0) throw badRequest(`标签名不合法：${name}`);
  return name;
}

function combineOutput(res) {
  return [res.stdout, res.stderr].filter((s) => s && s.trim()).join('\n').trim();
}

async function conflictAware(res, repo, opName) {
  if (res.code === 0) {
    return { conflicted: false, output: combineOutput(res) };
  }
  const state = await getOperationState(repo.path);
  const active = state.merge || state.rebase || state.cherryPick || state.revert;
  if (active) {
    return {
      conflicted: true,
      output: combineOutput(res) || `${opName}产生了冲突，请解决冲突后继续。`,
      operation: state,
    };
  }
  throw new AppError(cleanGitError(res.stderr) || `${opName}失败`, {
    stderr: res.stderr,
    stdout: res.stdout,
    command: res.command,
  });
}

export async function openRepo(dir) {
  const repo = await resolveRepo(dir);
  const snapshot = await getSnapshot(repo.path);
  touchRecent(repo);
  return snapshot;
}

export async function stageFiles(params) {
  const repo = await repoOf(params.repo);
  const paths = cleanPaths(params.paths);
  const args = ['add', '-A'];
  if (paths.length) {
    const stageable = await stageablePaths(repo, paths);
    if (!stageable.length) return { staged: 0 };
    args.push('--', ...stageable);
  }
  await gitOk(args, { cwd: repo.path });
  return { staged: paths.length };
}

export async function unstageFiles(params) {
  const repo = await repoOf(params.repo);
  const paths = cleanPaths(params.paths);
  const args = ['restore', '--staged'];
  if (paths.length) args.push('--', ...paths);
  const res = await git(args, { cwd: repo.path });
  if (res.code !== 0) {
    if (/could not resolve HEAD|unknown revision/i.test(res.stderr)) {
      const fallback = ['rm', '--cached', '-r', '--quiet'];
      if (paths.length) fallback.push('--', ...paths);
      await gitOk(fallback, { cwd: repo.path });
      return { unstaged: paths.length };
    }
    throw new AppError(cleanGitError(res.stderr) || '取消暂存失败', { stderr: res.stderr });
  }
  return { unstaged: paths.length };
}

export async function discardFiles(params) {
  const repo = await repoOf(params.repo);
  const paths = cleanPaths(params.paths);
  if (!paths.length) throw badRequest('请选择要回滚的文件');
  const visibleUntracked = Array.isArray(params.untracked) ? cleanPaths(params.untracked) : [];
  if (params.onlyUntracked) {
    if (!visibleUntracked.length) throw badRequest('没有可删除的未跟踪文件');
    await gitOk(['clean', '-f', '-d', '--', ...visibleUntracked], { cwd: repo.path });
    return { discarded: visibleUntracked.length };
  }
  const tracked = paths.filter((p) => !visibleUntracked.includes(p));
  if (tracked.length) {
    const res = await git(['restore', '--staged', '--worktree', '--', ...tracked], { cwd: repo.path });
    if (res.code !== 0) {
      throw new AppError(cleanGitError(res.stderr) || '回滚失败', { stderr: res.stderr });
    }
  }
  if (params.removeUntracked && visibleUntracked.length) {
    await gitOk(['clean', '-f', '-d', '--', ...visibleUntracked], { cwd: repo.path });
  }
  return { discarded: paths.length };
}

export async function ignorePath(params) {
  const repo = await repoOf(params.repo);
  const rel = safeRepoPath(params.path);
  const ignoreFile = path.join(repo.path, '.gitignore');
  let pattern = rel;
  if (pattern.endsWith('/')) pattern = pattern.slice(0, -1) + '/';
  let current = '';
  try {
    current = fs.readFileSync(ignoreFile, 'utf8');
  } catch {
    current = '';
  }
  const existing = new Set(current.split(/\r?\n/).map((l) => l.trim()));
  if (existing.has(pattern)) return { added: false, pattern };
  const prefix = current.length && !current.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(ignoreFile, `${current}${prefix}${pattern}\n`, 'utf8');
  return { added: true, pattern };
}

export async function createCommit(params) {
  const repo = await repoOf(params.repo);
  const amend = !!params.amend;
  const message = typeof params.message === 'string' ? params.message.replace(/\r\n/g, '\n').replace(/\s+$/, '') : '';
  if (!message && !amend) throw badRequest('请输入提交信息');
  const paths = cleanPaths(params.paths);
  if (paths.length) {
    const stageable = await stageablePaths(repo, paths);
    if (stageable.length) {
      await gitOk(['add', '-A', '--', ...stageable], { cwd: repo.path });
    }
  } else if (params.stageAll) {
    await gitOk(['add', '-A'], { cwd: repo.path });
  }
  const args = ['commit'];
  if (amend) args.push('--amend');
  if (params.signoff) args.push('--signoff');
  if (message) args.push('-m', message);
  else args.push('--no-edit');
  const res = await git(args, { cwd: repo.path, timeout: 120_000 });
  if (res.code !== 0) {
    throw new AppError(cleanGitError(res.stderr) || cleanGitError(res.stdout) || '提交失败', {
      stderr: res.stderr,
      stdout: res.stdout,
      command: res.command,
    });
  }
  const head = await gitOk(['rev-parse', 'HEAD'], { cwd: repo.path });
  return { sha: head.stdout.trim(), output: combineOutput(res) };
}

export async function createBranch(params) {
  const repo = await repoOf(params.repo);
  const name = await checkBranchName(repo, params.name);
  const start = params.start ? assertRefLike(params.start, '起点') : 'HEAD';
  if (params.checkout === false) {
    await gitOk(['branch', name, start], { cwd: repo.path });
  } else {
    await gitOk(['checkout', '-b', name, start], { cwd: repo.path });
  }
  return { name };
}

export async function checkoutBranch(params) {
  const repo = await repoOf(params.repo);
  const name = assertRefLike(params.name, '分支');
  if (params.remote) {
    const localName = name.split('/').slice(1).join('/');
    const refs = await getRefs(repo.path);
    const hasLocal = refs.some((r) => r.type === 'branch' && r.name === localName);
    if (hasLocal) {
      await gitOk(['checkout', localName], { cwd: repo.path });
      return { branch: localName };
    }
    await gitOk(['checkout', '-b', localName, '--track', name], { cwd: repo.path, timeout: 120_000 });
    return { branch: localName, tracking: name };
  }
  const res = await git(['checkout', name], { cwd: repo.path, timeout: 120_000 });
  if (res.code !== 0) {
    throw new AppError(cleanGitError(res.stderr) || '切换分支失败', { stderr: res.stderr });
  }
  return { branch: name, output: combineOutput(res) };
}

export async function deleteBranch(params) {
  const repo = await repoOf(params.repo);
  const name = assertRefLike(params.name, '分支');
  const args = ['branch', params.force ? '-D' : '-d', name];
  const res = await git(args, { cwd: repo.path });
  if (res.code !== 0) {
    throw new AppError(cleanGitError(res.stderr) || '删除分支失败', { stderr: res.stderr });
  }
  return { name, output: combineOutput(res) };
}

export async function renameBranch(params) {
  const repo = await repoOf(params.repo);
  const oldName = assertRefLike(params.name, '分支');
  const newName = await checkBranchName(repo, params.newName);
  await gitOk(['branch', '-m', oldName, newName], { cwd: repo.path });
  return { name: newName };
}

export async function mergeBranch(params) {
  const repo = await repoOf(params.repo);
  const name = assertRefLike(params.name, '分支');
  const res = await git(['merge', '--no-edit', name], { cwd: repo.path, timeout: 300_000 });
  return conflictAware(res, repo, '合并');
}

export async function rebaseBranch(params) {
  const repo = await repoOf(params.repo);
  const name = assertRefLike(params.name, '分支');
  const res = await git(['rebase', name], { cwd: repo.path, timeout: 300_000 });
  return conflictAware(res, repo, '变基');
}

export async function resetTo(params) {
  const repo = await repoOf(params.repo);
  const sha = assertShaLike(params.sha, '提交');
  const mode = params.mode || 'mixed';
  if (!RESET_MODES.has(mode)) throw badRequest('未知的重置模式');
  const res = await git(['reset', `--${mode}`, sha], { cwd: repo.path, timeout: 120_000 });
  if (res.code !== 0) {
    throw new AppError(cleanGitError(res.stderr) || '重置失败', { stderr: res.stderr });
  }
  return { sha, mode, output: combineOutput(res) };
}

export async function cherryPick(params) {
  const repo = await repoOf(params.repo);
  const sha = assertShaLike(params.sha, '提交');
  const res = await git(['cherry-pick', '--no-edit', sha], { cwd: repo.path, timeout: 300_000 });
  return conflictAware(res, repo, '拣选');
}

export async function revertCommit(params) {
  const repo = await repoOf(params.repo);
  const sha = assertShaLike(params.sha, '提交');
  const res = await git(['revert', '--no-edit', sha], { cwd: repo.path, timeout: 300_000 });
  return conflictAware(res, repo, '还原');
}

export async function abortOperation(params) {
  const repo = await repoOf(params.repo);
  const state = await getOperationState(repo.path);
  let cmd = null;
  if (state.merge) cmd = ['merge', '--abort'];
  else if (state.rebase) cmd = ['rebase', '--abort'];
  else if (state.cherryPick) cmd = ['cherry-pick', '--abort'];
  else if (state.revert) cmd = ['revert', '--abort'];
  if (!cmd) throw badRequest('当前没有可中止的操作');
  const res = await git(cmd, { cwd: repo.path, timeout: 120_000 });
  if (res.code !== 0) {
    throw new AppError(cleanGitError(res.stderr) || '中止操作失败', { stderr: res.stderr });
  }
  return { output: combineOutput(res) };
}

export async function continueOperation(params) {
  const repo = await repoOf(params.repo);
  const state = await getOperationState(repo.path);
  let cmd = null;
  if (state.rebase) cmd = ['rebase', '--continue'];
  else if (state.cherryPick) cmd = ['cherry-pick', '--continue'];
  else if (state.revert) cmd = ['revert', '--continue'];
  if (!cmd) throw badRequest('当前没有可继续的操作');
  const res = await git(cmd, {
    cwd: repo.path,
    timeout: 300_000,
    env: { GIT_EDITOR: 'true' },
  });
  return conflictAware(res, repo, '继续操作');
}

export async function acceptConflict(params) {
  const repo = await repoOf(params.repo);
  const p = safeRepoPath(params.path);
  const side = params.side;
  if (!['ours', 'theirs'].includes(side)) throw badRequest('未知的冲突处理方式');
  const res = await git(['checkout', `--${side}`, '--', p], { cwd: repo.path });
  if (res.code !== 0) {
    throw new AppError(cleanGitError(res.stderr) || '处理冲突失败', { stderr: res.stderr });
  }
  await gitOk(['add', '--', p], { cwd: repo.path });
  return { path: p, side };
}

export async function markResolved(params) {
  const repo = await repoOf(params.repo);
  const paths = cleanPaths(params.paths);
  await gitOk(['add', '--', ...paths], { cwd: repo.path });
  return { resolved: paths.length };
}

export async function createTag(params) {
  const repo = await repoOf(params.repo);
  const name = await checkTagName(repo, params.name);
  const args = ['tag'];
  if (params.annotated) {
    args.push('-a', name, '-m', params.message || name);
  } else {
    args.push(name);
  }
  if (params.sha) args.push(assertShaLike(params.sha, '提交'));
  const res = await git(args, { cwd: repo.path });
  if (res.code !== 0) {
    throw new AppError(cleanGitError(res.stderr) || '创建标签失败', { stderr: res.stderr });
  }
  return { name, output: combineOutput(res) };
}

export async function deleteTag(params) {
  const repo = await repoOf(params.repo);
  const name = await checkTagName(repo, params.name);
  await gitOk(['tag', '-d', name], { cwd: repo.path });
  return { name };
}

export async function pushTag(params) {
  const repo = await repoOf(params.repo);
  const name = await checkTagName(repo, params.name);
  const remotes = await getRemotes(repo.path);
  if (!remotes.length) throw badRequest('仓库没有配置远程');
  const remote = params.remote || remotes[0].name;
  const res = await git(['push', remote, `refs/tags/${name}`], { cwd: repo.path, timeout: 600_000 });
  if (res.code !== 0) {
    throw new AppError(cleanGitError(res.stderr) || '推送标签失败', { stderr: res.stderr });
  }
  return { output: combineOutput(res) };
}

export async function saveStash(params) {
  const repo = await repoOf(params.repo);
  const message = (params.message || '').trim();
  const args = ['stash', 'push'];
  if (params.includeUntracked) args.push('-u');
  if (message) args.push('-m', message);
  const res = await git(args, { cwd: repo.path, timeout: 120_000 });
  if (res.code !== 0) {
    throw new AppError(cleanGitError(res.stderr) || '贮藏失败', { stderr: res.stderr });
  }
  return { output: combineOutput(res), empty: /No local changes/i.test(res.stdout + res.stderr) };
}

export async function applyStash(params) {
  const repo = await repoOf(params.repo);
  const ref = assertRefLike(params.ref || 'stash@{0}', '贮藏');
  if (!/^stash@\{\d+\}$/.test(ref)) throw badRequest('无效的贮藏引用');
  const args = ['stash', params.pop ? 'pop' : 'apply', ref];
  const res = await git(args, { cwd: repo.path, timeout: 120_000 });
  if (res.code !== 0) {
    if (/conflict/i.test(res.stdout + res.stderr)) {
      return { conflicted: true, output: combineOutput(res) };
    }
    throw new AppError(cleanGitError(res.stderr) || '应用贮藏失败', { stderr: res.stderr });
  }
  return { conflicted: false, output: combineOutput(res) };
}

export async function dropStash(params) {
  const repo = await repoOf(params.repo);
  const ref = assertRefLike(params.ref || 'stash@{0}', '贮藏');
  if (!/^stash@\{\d+\}$/.test(ref)) throw badRequest('无效的贮藏引用');
  await gitOk(['stash', 'drop', ref], { cwd: repo.path });
  return { ref };
}

export async function fetchAll(params) {
  const repo = await repoOf(params.repo);
  const remotes = await getRemotes(repo.path);
  if (!remotes.length) throw badRequest('仓库没有配置远程');
  const args = params.remote
    ? ['fetch', '--prune', '--tags', assertRefLike(params.remote, '远程')]
    : ['fetch', '--all', '--prune', '--tags'];
  const res = await git(args, { cwd: repo.path, timeout: 900_000 });
  if (res.code !== 0) {
    throw new AppError(cleanGitError(res.stderr) || '获取远程更新失败', { stderr: res.stderr });
  }
  return { output: combineOutput(res) };
}

export async function pullBranch(params) {
  const repo = await repoOf(params.repo);
  const mode = params.mode || readSettings().pullMode || 'merge';
  if (!PULL_MODES.has(mode)) throw badRequest('未知的拉取模式');
  const args = ['pull', '--no-edit'];
  if (mode === 'rebase') args.push('--rebase', '--autostash');
  else if (mode === 'ff-only') args.push('--ff-only');
  if (params.remote) args.push(assertRefLike(params.remote, '远程'));
  const res = await git(args, { cwd: repo.path, timeout: 900_000 });
  if (res.code !== 0) {
    const state = await getOperationState(repo.path);
    if (state.merge || state.rebase) {
      return { conflicted: true, output: combineOutput(res), operation: state };
    }
    throw new AppError(cleanGitError(res.stderr) || '拉取失败', {
      stderr: res.stderr, stdout: res.stdout, command: res.command,
    });
  }
  return { output: combineOutput(res) };
}

export async function pushBranch(params) {
  const repo = await repoOf(params.repo);
  const remotes = await getRemotes(repo.path);
  if (!remotes.length) throw badRequest('仓库没有配置远程');
  if (params.branch) {
    const branch = assertRefLike(params.branch, '分支');
    const remote = params.remote || (remotes.length === 1 ? remotes[0].name : null);
    if (!remote) throw badRequest('仓库有多个远程，请选择要推送到的远程');
    const args = ['push'];
    if (params.setUpstream) args.push('-u');
    args.push(remote, branch);
    const res = await git(args, { cwd: repo.path, timeout: 900_000 });
    if (res.code !== 0) {
      throw new AppError(cleanGitError(res.stderr) || '推送失败', {
        stderr: res.stderr, stdout: res.stdout, command: res.command,
      });
    }
    return { output: combineOutput(res), branch, remote };
  }
  const upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd: repo.path });
  const hasUpstream = upstream.code === 0 && upstream.stdout.trim();
  const args = ['push'];
  let setUpstream = false;
  if (!hasUpstream) {
    if (params.remote) {
      args.push('-u', assertRefLike(params.remote, '远程'), 'HEAD');
    } else if (remotes.length === 1) {
      args.push('-u', remotes[0].name, 'HEAD');
    } else {
      throw badRequest('当前分支没有上游分支，请选择要推送到的远程');
    }
    setUpstream = true;
  } else if (params.force) {
    args.push('--force-with-lease');
  }
  if (params.remote && hasUpstream) args.push(assertRefLike(params.remote, '远程'));
  const res = await git(args, { cwd: repo.path, timeout: 900_000 });
  if (res.code !== 0) {
    throw new AppError(cleanGitError(res.stderr) || '推送失败', {
      stderr: res.stderr, stdout: res.stdout, command: res.command,
    });
  }
  return { output: combineOutput(res), setUpstream };
}

export async function addRemote(params) {
  const repo = await repoOf(params.repo);
  const name = assertRefLike(params.name, '远程名称');
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith('-')) throw badRequest('远程名称不能包含特殊字符');
  const url = String(params.url || '').trim();
  if (!url || /[\0\r\n]/.test(url)) throw badRequest('请输入有效的远程地址');
  await gitOk(['remote', 'add', name, url], { cwd: repo.path });
  return { name, url };
}

export async function removeRemote(params) {
  const repo = await repoOf(params.repo);
  const name = assertRefLike(params.name, '远程名称');
  await gitOk(['remote', 'remove', name], { cwd: repo.path });
  return { name };
}

export async function cloneRepo(params) {
  const url = String(params.url || '').trim();
  if (!url || /[\0\r\n]/.test(url) || url.startsWith('-')) throw badRequest('请输入有效的仓库地址');
  const dest = normalizeRepoPath(params.dir);
  if (fs.existsSync(dest)) {
    const entries = fs.readdirSync(dest);
    if (entries.length > 0) throw badRequest('目标目录已存在且不为空');
  } else {
    fs.mkdirSync(dest, { recursive: true });
  }
  const res = await git(['clone', '--progress', url, '.'], {
    cwd: dest,
    timeout: 1_800_000,
    maxStdout: 4 * 1024 * 1024,
  });
  if (res.code !== 0) {
    throw new AppError(cleanGitError(res.stderr) || '克隆失败', {
      stderr: res.stderr, stdout: res.stdout, command: res.command,
    });
  }
  const repo = await resolveRepo(dest);
  touchRecent(repo);
  return { repo, snapshot: await getSnapshot(repo.path), output: combineOutput(res) };
}

export async function initRepo(params) {
  const dest = normalizeRepoPath(params.dir);
  if (fs.existsSync(dest)) {
    let stat;
    try {
      stat = fs.statSync(dest);
    } catch {
      throw badRequest('无法访问该路径');
    }
    if (!stat.isDirectory()) throw badRequest('所选路径不是文件夹');
    if (fs.existsSync(path.join(dest, '.git'))) {
      throw badRequest('该目录已经是 Git 仓库，请直接打开它');
    }
    // A subdirectory of an existing repository must not get a nested repo by
    // accident; point the user at the real repository root instead.
    const top = await git(['rev-parse', '--show-toplevel'], { cwd: dest, timeout: 20_000 });
    if (top.code === 0 && top.stdout.trim()) {
      const root = path.normalize(top.stdout.trim());
      if (root.toLowerCase() !== dest.toLowerCase()) {
        throw badRequest(`该目录位于已有仓库中：${root}。请直接打开外层仓库。`);
      }
    }
    const bare = await git(['rev-parse', '--is-bare-repository'], { cwd: dest, timeout: 20_000 });
    if (bare.code === 0 && bare.stdout.trim() === 'true') {
      throw badRequest('该目录是一个裸仓库，不能作为工作区初始化');
    }
  } else {
    fs.mkdirSync(dest, { recursive: true });
  }

  const res = await git(['init', '-b', 'main'], { cwd: dest, timeout: 60_000 });
  if (res.code !== 0) {
    await gitOk(['init'], { cwd: dest, timeout: 60_000 });
  }

  if (params.createGitignore) {
    const ignoreFile = path.join(dest, '.gitignore');
    if (!fs.existsSync(ignoreFile)) {
      fs.writeFileSync(ignoreFile, [
        '# Created by GitViewer when initializing this project',
        '# Uncomment or remove entries as needed.',
        '.idea/',
        '*.iml',
        '.gradle/',
        'build/',
        'out/',
        'node_modules/',
        'dist/',
        'coverage/',
        '*.log',
        '.DS_Store',
        'Thumbs.db',
        '.env',
        '.env.local',
        '',
      ].join('\n'), 'utf8');
    }
  }

  const repo = await resolveRepo(dest);
  touchRecent(repo);
  const snapshot = await getSnapshot(repo.path);
  return { repo, snapshot, initialized: true };
}

export function settingsGet() {
  return readSettings();
}

export function settingsSave(params) {
  const patch = params.settings || {};
  return saveSettings(patch);
}

export function recentList() {
  return getRecent();
}

export function recentRemove(params) {
  return removeRecent(normalizeRepoPath(params.path));
}

export function fsRoots() {
  const roots = [];
  if (process.platform === 'win32') {
    for (let i = 65; i <= 90; i++) {
      const root = String.fromCharCode(i) + ':\\';
      try {
        if (fs.existsSync(root)) roots.push(root);
      } catch {
        /* skip */
      }
    }
  } else {
    roots.push('/');
  }
  return { roots, home: process.env.USERPROFILE || process.env.HOME || '' };
}

export function fsList(params) {
  const dir = params.path ? normalizeRepoPath(params.path) : null;
  if (!dir) return { ...fsRoots(), path: null, parent: null, dirs: [], isRepo: false };
  if (!fs.existsSync(dir)) throw badRequest('目录不存在');
  let stat;
  try {
    stat = fs.statSync(dir);
  } catch {
    throw badRequest('无法访问该目录');
  }
  if (!stat.isDirectory()) throw badRequest('不是文件夹');
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const dirs = [];
  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..' || entry.name === '.git') continue;
    let isDir = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try {
        isDir = fs.statSync(path.join(dir, entry.name)).isDirectory();
      } catch {
        isDir = false;
      }
    }
    if (!isDir) continue;
    const full = path.join(dir, entry.name);
    dirs.push({
      name: entry.name,
      path: full,
      isRepo: fs.existsSync(path.join(full, '.git')),
    });
  }
  dirs.sort((a, b) => Number(b.isRepo) - Number(a.isRepo) || a.name.localeCompare(b.name));
  const parent = path.dirname(dir);
  return {
    ...fsRoots(),
    path: dir,
    parent: parent === dir ? null : parent,
    dirs,
    isRepo: fs.existsSync(path.join(dir, '.git')),
  };
}

function nativePath(relOrAbs, repoPath) {
  if (path.isAbsolute(relOrAbs)) return relOrAbs;
  return path.join(repoPath, ...safeRepoPath(relOrAbs).split('/'));
}

function launchShell(target, extraArgs = []) {
  const args = process.platform === 'win32' ? [target, ...extraArgs] : [target, ...extraArgs];
  const child = spawn(process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open', args, {
    stdio: 'ignore',
    detached: true,
    windowsHide: false,
  });
  child.on('error', () => {});
  child.unref();
}

export function openInFileManager(params) {
  const repo = normalizeRepoPath(params.repo);
  const target = params.path ? nativePath(params.path, repo) : repo;
  if (!fs.existsSync(target)) throw badRequest('路径不存在');
  if (params.select) {
    launchShell(`/select,${target}`);
  } else {
    launchShell(target);
  }
  return { target };
}

export function openWithDefaultApp(params) {
  const repo = normalizeRepoPath(params.repo);
  const target = nativePath(params.path, repo);
  if (!fs.existsSync(target)) throw badRequest('文件不存在');
  launchShell(target);
  return { target };
}

export function appInfo() {
  return {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    home: process.env.USERPROFILE || process.env.HOME || '',
    dataDir: DATA_DIR,
    cwd: process.cwd(),
    pid: process.pid,
  };
}
