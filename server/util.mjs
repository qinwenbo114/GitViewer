import path from 'node:path';

export class AppError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'AppError';
    this.detail = detail;
    this.status = detail.status || 400;
  }
}

export function badRequest(message, detail) {
  return new AppError(message, { ...detail, status: 400 });
}

/** Quote a single command line argument for display purposes only. */
export function quoteArg(arg) {
  if (arg === '') return '""';
  if (/^[A-Za-z0-9_@%+=:,./\\-]+$/.test(arg)) return arg;
  return `"${arg.replace(/(["\\])/g, '\\$1')}"`;
}

export function commandLine(args) {
  return 'git ' + args.map(quoteArg).join(' ');
}

const utf8Decoder = new TextDecoder('utf-8', { fatal: false });
let gbkDecoder = null;

export function decodeText(buf) {
  if (!buf || buf.length === 0) return '';
  // Strip UTF-8 BOM.
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    buf = buf.subarray(3);
  }
  const text = utf8Decoder.decode(buf);
  const bad = (text.match(/\uFFFD/g) || []).length;
  // Heuristic: if there is a meaningful amount of invalid UTF-8, try GBK
  // (common for legacy Chinese source files on Windows).
  if (bad > 2 && bad > buf.length / 2000) {
    try {
      gbkDecoder ||= new TextDecoder('gbk', { fatal: false });
      const gbk = gbkDecoder.decode(buf);
      const gbkBad = (gbk.match(/\uFFFD/g) || []).length;
      if (gbkBad < bad) return gbk;
    } catch {
      /* GBK decoder unavailable */
    }
  }
  return text;
}

export function isProbablyBinary(buf) {
  if (!buf || buf.length === 0) return false;
  const n = Math.min(buf.length, 8000);
  let suspicious = 0;
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b === 0) return true;
    if (b < 7 || (b > 13 && b < 32)) suspicious++;
  }
  return suspicious / n > 0.1;
}

export function parseNumstat(output) {
  const map = new Map();
  if (!output) return map;
  for (const line of output.split('\n')) {
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [add, del, ...rest] = parts;
    let file = rest.join('\t');
    let orig = null;
    // Rename format: "1\t2\told => new" or "1\t2\tpath/{old => new}/x".
    if (file.includes('=>')) {
      const brace = file.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
      if (brace) {
        const prefix = brace[1];
        const suffix = brace[4];
        orig = prefix + brace[2] + suffix;
        file = prefix + brace[3] + suffix;
      } else {
        const idx = file.indexOf(' => ');
        orig = file.slice(0, idx);
        file = file.slice(idx + 4);
      }
    }
    map.set(file, {
      additions: add === '-' ? null : Number(add),
      deletions: del === '-' ? null : Number(del),
      binary: add === '-' || del === '-',
      origPath: orig,
    });
  }
  return map;
}

export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export function assertShaLike(value, name = 'commit') {
  if (typeof value !== 'string' || !/^[0-9a-fA-F]{4,64}$/.test(value)) {
    throw badRequest(`无效的 ${name}`);
  }
  return value;
}

export function assertRefLike(value, name = '分支') {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255) {
    throw badRequest(`无效的${name}`);
  }
  if (value.startsWith('-') || /[\0\r\n]/.test(value)) {
    throw badRequest(`无效的${name}`);
  }
  return value;
}

/** Validate a repository-relative path coming from the client. */
export function safeRepoPath(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw badRequest('缺少文件路径');
  }
  if (value.includes('\0')) throw badRequest('无效的文件路径');
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw badRequest('文件路径必须是仓库内的相对路径');
  }
  const parts = normalized.split('/');
  if (parts.some((p) => p === '..')) {
    throw badRequest('文件路径不能跳出仓库');
  }
  return normalized;
}

export function normalizeRepoPath(dir) {
  if (typeof dir !== 'string' || !dir.trim()) throw badRequest('缺少仓库路径');
  let resolved = path.resolve(dir.trim());
  // Strip trailing separators (but keep drive roots like C:\).
  if (resolved.length > 3 && /[\\/]$/.test(resolved)) {
    resolved = resolved.replace(/[\\/]+$/, '');
  }
  return resolved;
}

export function shortHash(hash, len = 8) {
  return (hash || '').slice(0, len);
}

export function splitLines(text) {
  if (!text) return [];
  return text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
}
