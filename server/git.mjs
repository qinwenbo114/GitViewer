import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppError, commandLine, decodeText } from './util.mjs';
import { recordTrace } from './trace.mjs';

const GIT = process.env.GITVIEWER_GIT || 'git';
const STDIO_LIMIT = 8 * 1024 * 1024;
const STDERR_LIMIT = 1024 * 1024;

const BASE_ARGS = [
  '--no-pager',
  '-c', 'core.quotepath=false',
  '-c', 'color.ui=false',
  '-c', 'core.pager=cat',
];

function readLimited(file, limit) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return { buf: Buffer.alloc(0), truncated: false, size: 0 };
  }
  const size = Math.min(stat.size, limit);
  const buf = Buffer.allocUnsafe(size);
  const fd = fs.openSync(file, 'r');
  try {
    let offset = 0;
    while (offset < size) {
      const n = fs.readSync(fd, buf, offset, size - offset, offset);
      if (n <= 0) break;
      offset += n;
    }
    return { buf: buf.subarray(0, offset), truncated: stat.size > limit, size: stat.size };
  } finally {
    fs.closeSync(fd);
  }
}

function killTree(pid) {
  if (!pid) return;
  try {
    process.kill(pid);
  } catch {
    /* already gone */
  }
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        detached: false,
      }).on('error', () => {});
    } catch {
      /* ignore */
    }
  }
}

/**
 * Run git with stdout/stderr redirected to temporary files instead of pipes.
 * This keeps the runner working inside restricted sandboxes (where anonymous
 * pipes may be unavailable) and also avoids deadlocks on very large diffs.
 */
export async function git(args, opts = {}) {
  const cwd = opts.cwd;
  if (!cwd) throw new AppError('缺少工作目录');
  const timeout = opts.timeout ?? 120_000;
  const filteredArgs = args.filter((arg) => arg != null);
  const fullArgs = [...BASE_ARGS, ...filteredArgs];
  const displayCommand = commandLine(filteredArgs);
  const started = Date.now();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitviewer-'));
  const outPath = path.join(dir, 'out');
  const errPath = path.join(dir, 'err');
  const inPath = path.join(dir, 'in');
  let outFd;
  let errFd;
  let inFd = null;

  try {
    outFd = fs.openSync(outPath, 'w');
    errFd = fs.openSync(errPath, 'w');
    if (opts.input != null) {
      fs.writeFileSync(inPath, String(opts.input), 'utf8');
      inFd = fs.openSync(inPath, 'r');
    }

    const env = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_PAGER: 'cat',
      GIT_EDITOR: 'true',
      GIT_MERGE_AUTOEDIT: 'no',
      GIT_OPTIONAL_LOCKS: '0',
      LANG: 'en_US.UTF-8',
      ...(opts.env || {}),
    };
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    delete env.GIT_INDEX_FILE;

    const result = await new Promise((resolve) => {
      let child;
      let timedOut = false;
      let settled = false;
      const finish = (code, spawnError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code, spawnError, timedOut });
      };
      try {
        child = spawn(GIT, fullArgs, {
          cwd,
          env,
          windowsHide: true,
          stdio: [inFd == null ? 'ignore' : inFd, outFd, errFd],
        });
      } catch (err) {
        finish(-1, err);
        return;
      }
      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child.pid);
      }, timeout);
      child.on('error', (err) => finish(-1, err));
      child.on('close', (code) => finish(code == null ? -1 : code, null));
    });

    const outRead = readLimited(outPath, opts.maxStdout || STDIO_LIMIT);
    const errRead = readLimited(errPath, STDERR_LIMIT);
    const stdout = decodeText(outRead.buf);
    let stderr = decodeText(errRead.buf);
    if (result.spawnError) {
      stderr = `无法运行 git：${result.spawnError.message}\n请确认已安装 Git，并可在命令行中执行 git。`;
    }
    if (result.timedOut) {
      stderr += `\n[命令超时（${Math.round(timeout / 1000)} 秒），已终止]`;
    }
    if (outRead.truncated) {
      stderr += `\n[输出过大，已截断（共 ${(outRead.size / 1024 / 1024).toFixed(1)} MB）]`;
    }

    const resultObj = {
      code: result.timedOut ? -2 : result.code,
      stdout,
      stderr,
      stdoutBuffer: outRead.buf,
      ms: Date.now() - started,
      timedOut: result.timedOut,
      truncated: outRead.truncated,
      command: displayCommand,
    };

    recordTrace({
      command: displayCommand,
      code: resultObj.code,
      ms: resultObj.ms,
      stdout: stdout.slice(0, 6000),
      stderr: stderr.slice(0, 6000),
      cwd,
    });

    return resultObj;
  } finally {
    for (const fd of [outFd, errFd, inFd]) {
      if (fd != null) {
        try {
          fs.closeSync(fd);
        } catch {
          /* ignore */
        }
      }
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/** Run git and throw a descriptive AppError when the command fails. */
export async function gitOk(args, opts = {}) {
  const res = await git(args, opts);
  if (res.code !== 0) {
    const message = cleanGitError(res.stderr) || `git 命令失败（退出码 ${res.code}）`;
    throw new AppError(message, {
      command: res.command,
      stderr: res.stderr,
      stdout: res.stdout,
      code: res.code,
    });
  }
  return res;
}

export function cleanGitError(stderr) {
  return (stderr || '')
    .replace(/^hint:.*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
