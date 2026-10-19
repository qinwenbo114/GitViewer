import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startServer } from './server/index.mjs';
import { APP_ROOT, DATA_DIR } from './server/store.mjs';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 47110;

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(path.join(DATA_DIR, 'launch.log'), line + '\n', 'utf8');
  } catch {
    /* ignore */
  }
}

function pingExisting(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port, path: '/api/ping', timeout: 800 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve(json && json.ok ? json : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function findBrowser() {
  const candidates = [];
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  candidates.push(path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  candidates.push(path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  candidates.push(path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  candidates.push(path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  candidates.push(path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  candidates.push(path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function openAppWindow(url, profileDir) {
  const browser = findBrowser();
  const args = [
    `--app=${url}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
    '--window-size=1500,950',
    '--window-position=80,50',
  ];
  if (browser) {
    try {
      fs.mkdirSync(profileDir, { recursive: true });
    } catch {
      /* ignore */
    }
    const child = spawn(browser, args, {
      stdio: 'ignore',
      detached: true,
      windowsHide: false,
    });
    child.on('error', (err) => log(`browser launch failed: ${err.message}`));
    child.unref();
    log(`opened ${path.basename(browser)} app window -> ${url}`);
    return true;
  }
  log('no Edge/Chrome found, falling back to the default browser');
  try {
    const child = spawn(process.platform === 'win32' ? 'cmd' : 'xdg-open',
      process.platform === 'win32' ? ['/c', 'start', '', url] : [url], {
        stdio: 'ignore', detached: true, windowsHide: true,
      });
    child.on('error', () => {});
    child.unref();
    return false;
  } catch {
    return false;
  }
}

async function main() {
  process.title = 'GitViewer';
  const argv = process.argv.slice(2);
  const noOpen = argv.includes('--no-open');
  const repoArgIndex = argv.indexOf('--repo');
  const repo = repoArgIndex >= 0 ? argv[repoArgIndex + 1] : null;
  const portIndex = argv.indexOf('--port');
  const requestedPort = portIndex >= 0 ? Number(argv[portIndex + 1]) : DEFAULT_PORT;

  if (!noOpen) {
    const existing = await pingExisting(DEFAULT_PORT);
    if (existing) {
      log(`GitViewer is already running on port ${DEFAULT_PORT} (pid ${existing.pid})`);
      openAppWindow(`http://${HOST}:${DEFAULT_PORT}/`, path.join(DATA_DIR, 'browser-profile'));
      process.exit(0);
    }
  }

  let shuttingDown = false;
  const stop = async (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('shutting down');
    try {
      await instance.close();
    } catch {
      /* ignore */
    }
    setTimeout(() => process.exit(code), 50);
  };

  const instance = await startServer({
    port: requestedPort,
    host: HOST,
    keepAlive: process.env.GITVIEWER_KEEPALIVE === '1',
    onShutdown: () => stop(0),
    idleExitMs: 8000,
  });

  const base = `http://${HOST}:${instance.port}/`;
  const url = repo ? `${base}?repo=${encodeURIComponent(repo)}` : base;
  log(`GitViewer server listening on ${base} (pid ${process.pid})`);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, 'runtime.json'), JSON.stringify({
      url, port: instance.port, pid: process.pid, startedAt: Date.now(), repo,
    }, null, 2));
  } catch {
    /* ignore */
  }

  if (!noOpen) {
    openAppWindow(url, path.join(DATA_DIR, 'browser-profile'));
  } else {
    console.log(`GitViewer: ${url}`);
  }

  process.on('SIGINT', () => stop(0));
  process.on('SIGTERM', () => stop(0));
}

main().catch((err) => {
  log(`fatal: ${err.stack || err.message}`);
  console.error(err);
  process.exit(1);
});
