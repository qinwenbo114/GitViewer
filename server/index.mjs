import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTrace } from './trace.mjs';
import { AppError } from './util.mjs';
import {
  getCommit,
  getConflict,
  getDiff,
  getFileContent,
  getBlame,
  getFileHistory,
  getSnapshot,
  queryLog,
} from './repo.mjs';
import {
  abortOperation,
  acceptConflict,
  addRemote,
  appInfo,
  applyStash,
  checkoutBranch,
  cherryPick,
  cloneRepo,
  continueOperation,
  createBranch,
  createCommit,
  createTag,
  deleteBranch,
  deleteTag,
  discardFiles,
  dropStash,
  fetchAll,
  fsList,
  fsRoots,
  ignorePath,
  initRepo,
  markResolved,
  mergeBranch,
  openInFileManager,
  openRepo,
  openWithDefaultApp,
  pullBranch,
  pushBranch,
  pushTag,
  rebaseBranch,
  recentList,
  recentRemove,
  removeRemote,
  renameBranch,
  resetTo,
  revertCommit,
  saveStash,
  settingsGet,
  settingsSave,
  stageFiles,
  unstageFiles,
} from './actions.mjs';
import { getRecent, readSettings } from './store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PUBLIC_DIR = path.resolve(HERE, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const methods = {
  'app.info': appInfo,
  'app.bootstrap': () => {
    const settings = readSettings();
    const demoPath = path.resolve(PUBLIC_DIR, '..', 'demo');
    return {
      settings,
      recent: getRecent(),
      lastRepo: settings.lastRepo,
      appInfo: appInfo(),
      nodeVersion: process.version,
      demo: {
        path: demoPath,
        exists: fs.existsSync(demoPath),
      },
    };
  },
  'settings.get': settingsGet,
  'settings.save': settingsSave,
  'recent.list': recentList,
  'recent.remove': recentRemove,

  'repo.open': (p) => openRepo(p.path),
  'repo.snapshot': (p) => getSnapshot(p.repo),
  'repo.clone': cloneRepo,
  'repo.init': initRepo,
  'repo.log': (p) => queryLog(p.repo, p),
  'repo.commit': (p) => getCommit(p.repo, p.sha),
  'repo.diff': (p) => getDiff(p.repo, p),
  'repo.file': (p) => getFileContent(p.repo, p),
  'repo.conflict': (p) => getConflict(p.repo, p),
  'repo.blame': (p) => getBlame(p.repo, p),
  'repo.fileHistory': (p) => getFileHistory(p.repo, p),

  'fs.roots': fsRoots,
  'fs.list': fsList,
  'shell.reveal': openInFileManager,
  'shell.open': openWithDefaultApp,

  'wc.stage': stageFiles,
  'wc.unstage': unstageFiles,
  'wc.discard': discardFiles,
  'wc.ignore': ignorePath,

  'commit.create': createCommit,
  'commit.cherryPick': cherryPick,
  'commit.revert': revertCommit,
  'commit.reset': resetTo,

  'branch.create': createBranch,
  'branch.checkout': checkoutBranch,
  'branch.delete': deleteBranch,
  'branch.rename': renameBranch,
  'branch.merge': mergeBranch,
  'branch.rebase': rebaseBranch,

  'op.abort': abortOperation,
  'op.continue': continueOperation,
  'op.accept': acceptConflict,
  'op.resolve': markResolved,

  'tag.create': createTag,
  'tag.delete': deleteTag,
  'tag.push': pushTag,

  'stash.save': saveStash,
  'stash.apply': applyStash,
  'stash.drop': dropStash,

  'net.fetch': fetchAll,
  'net.pull': pullBranch,
  'net.push': pushBranch,

  'remote.add': addRemote,
  'remote.remove': removeRemote,
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new AppError('请求内容过大', { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const target = path.resolve(PUBLIC_DIR, '.' + rel);
  if (!target.startsWith(PUBLIC_DIR + path.sep) && target !== PUBLIC_DIR) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA fallback
      const index = path.join(PUBLIC_DIR, 'index.html');
      if (fs.existsSync(index)) {
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
        fs.createReadStream(index).pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      }
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(target).pipe(res);
  });
}

export function createHandler(options = {}) {
  let idleTimer = null;
  const cancelIdle = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };
  const scheduleExit = () => {
    cancelIdle();
    if (options.keepAlive) return;
    idleTimer = setTimeout(() => {
      options.onShutdown?.();
    }, options.idleExitMs || 8000);
  };

  return async function handler(req, res) {
    cancelIdle();
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = url.pathname;

    if (pathname === '/api/ping') {
      sendJson(res, 200, { ok: true, pid: process.pid, time: Date.now() });
      return;
    }
    if (pathname === '/api/bye') {
      scheduleExit();
      sendJson(res, 200, { ok: true });
      return;
    }
    if (pathname === '/api/shutdown') {
      sendJson(res, 200, { ok: true });
      options.onShutdown?.();
      return;
    }

    if (pathname === '/api/rpc') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: { message: '必须使用 POST' } });
        return;
      }
      let payload;
      try {
        payload = JSON.parse(await readBody(req));
      } catch (err) {
        sendJson(res, 400, { ok: false, error: { message: '无法解析请求：' + err.message } });
        return;
      }
      const method = payload?.method;
      const params = payload?.params || {};
      if (typeof method !== 'string' || !methods[method]) {
        sendJson(res, 200, { ok: false, error: { message: `未知的操作：${method}` }, trace: [] });
        return;
      }
      const started = Date.now();
      try {
        const { result, trace } = await withTrace(() => methods[method](params));
        sendJson(res, 200, { ok: true, data: result, trace, ms: Date.now() - started });
      } catch (err) {
        const trace = err.trace || [];
        const message = err instanceof AppError ? err.message : (err.message || '操作失败');
        if (!(err instanceof AppError)) console.error(`[rpc] ${method} failed:`, err);
        sendJson(res, 200, {
          ok: false,
          error: {
            message,
            command: err.detail?.command || null,
            stderr: err.detail?.stderr || null,
            stdout: err.detail?.stdout || null,
            code: err.detail?.code ?? null,
          },
          trace,
          ms: Date.now() - started,
        });
      }
      return;
    }

    if (pathname.startsWith('/api/')) {
      sendJson(res, 404, { ok: false, error: { message: '未知接口' } });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end('Method not allowed');
      return;
    }
    serveStatic(req, res, pathname);
  };
}

export async function startServer(options = {}) {
  const host = options.host || '127.0.0.1';
  const basePort = options.port ?? 47110;
  let onShutdown = options.onShutdown || (() => {});
  let handler;
  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((err) => {
      console.error('[server]', err);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: { message: '服务器内部错误' } });
      else res.end();
    });
  });
  handler = createHandler({
    idleExitMs: options.idleExitMs,
    keepAlive: options.keepAlive,
    onShutdown: () => {
      onShutdown();
    },
  });

  const listen = (port) => new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });

  let lastError = null;
  for (let i = 0; i < 25; i++) {
    try {
      await listen(basePort + i);
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      if (err.code !== 'EADDRINUSE') break;
    }
  }
  if (lastError) throw lastError;
  const port = server.address().port;
  return {
    server,
    port,
    url: `http://${host}:${port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
