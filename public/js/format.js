const pad = (n) => String(n).padStart(2, '0');

export function fmtCommitDate(unix) {
  if (!unix) return '';
  const d = new Date(unix * 1000);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = sameYear
    ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtFullDate(unix) {
  if (!unix) return '';
  const d = new Date(unix * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}`;
}

export function fmtRelative(input) {
  if (!input) return '';
  const ts = typeof input === 'number' ? input : new Date(input).getTime();
  const diff = Date.now() - ts;
  if (diff < 45_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} 小时前`;
  if (diff < 30 * 86_400_000) return `${Math.round(diff / 86_400_000)} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

export function fmtNumber(n) {
  if (n == null) return '—';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function fmtBytes(size) {
  if (size == null) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export const STATUS_META = {
  A: { label: '新增', cls: 'add', full: 'Added' },
  M: { label: '修改', cls: 'mod', full: 'Modified' },
  D: { label: '删除', cls: 'del', full: 'Deleted' },
  R: { label: '重命名', cls: 'ren', full: 'Renamed' },
  C: { label: '复制', cls: 'copy', full: 'Copied' },
  U: { label: '冲突', cls: 'conflict', full: 'Conflicted' },
  T: { label: '类型变更', cls: 'mod', full: 'Type changed' },
  '?': { label: '未跟踪', cls: 'untracked', full: 'Untracked' },
  '!': { label: '已忽略', cls: 'ignored', full: 'Ignored' },
};

export function statusMeta(code) {
  return STATUS_META[code] || { label: code || '?', cls: 'mod', full: code || '?' };
}

export function splitPath(p) {
  const idx = p.lastIndexOf('/');
  if (idx === -1) return { dir: '', name: p };
  return { dir: p.slice(0, idx + 1), name: p.slice(idx + 1) };
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function debounce(fn, wait = 300) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

export function truncate(text, len = 60) {
  const value = String(text || '');
  return value.length > len ? value.slice(0, len - 1) + '…' : value;
}

export function initials(name) {
  if (!name) return '?';
  const trimmed = name.trim();
  if (!trimmed) return '?';
  if (/[\u4e00-\u9fa5]/.test(trimmed)) return trimmed.slice(-2);
  const parts = trimmed.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}

export function branchNameOf(ref) {
  return (ref || '').replace(/^refs\/heads\//, '').replace(/^refs\/remotes\//, '');
}

export function commitUrl(remoteUrl, sha) {
  if (!remoteUrl || !sha) return null;
  let url = remoteUrl.replace(/\.git$/, '');
  if (/^git@/.test(url)) {
    url = url.replace(/^git@([^:]+):/, 'https://$1/');
  }
  if (/^https?:\/\//.test(url)) return `${url}/commit/${sha}`;
  return null;
}
