import { addTrace } from './state.js';

export class ApiError extends Error {
  constructor(message, detail = {}, trace = []) {
    super(message);
    this.name = 'ApiError';
    this.detail = detail;
    this.trace = trace;
  }
}

let requestSeq = 0;

export async function rpc(method, params = {}) {
  const id = ++requestSeq;
  let res;
  try {
    res = await fetch('/api/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, params }),
    });
  } catch (err) {
    throw new ApiError('无法连接 GitViewer 本地服务，请确认后台进程仍在运行。', {
      stderr: String(err?.message || err),
    });
  }
  let json;
  try {
    json = await res.json();
  } catch (err) {
    throw new ApiError(`服务返回了无法解析的响应（HTTP ${res.status}）`);
  }
  addTrace(json.trace);
  if (!json.ok) {
    const error = new ApiError(json.error?.message || '操作失败', json.error || {}, json.trace || []);
    error.method = method;
    error.requestId = id;
    throw error;
  }
  return json.data;
}

export function sendBye() {
  try {
    navigator.sendBeacon('/api/bye', '');
  } catch {
    /* ignore */
  }
}

export async function shutdownApp() {
  try {
    await fetch('/api/shutdown', { method: 'POST' });
  } catch {
    /* ignore */
  }
  window.close();
}
