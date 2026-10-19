import { h } from '../dom.js';
import { icon } from '../icons.js';

export function statusBadge(code, small = false) {
  const map = {
    A: 'add', M: 'mod', D: 'del', R: 'ren', C: 'copy', U: 'conflict', T: 'mod', '?': 'untracked',
  };
  const label = code || '?';
  return h('span', {
    class: `status-badge ${map[code] || 'mod'} ${small ? 'sm' : ''}`,
    title: label,
  }, label);
}

export function filePathEl(path, origPath = null, { bold = false } = {}) {
  const idx = path.lastIndexOf('/');
  const dir = idx >= 0 ? path.slice(0, idx + 1) : '';
  const name = idx >= 0 ? path.slice(idx + 1) : path;
  const el = h('span', { class: `file-path ${bold ? 'bold' : ''}`, title: origPath ? `${origPath} → ${path}` : path },
    dir ? h('span', { class: 'file-dir' }, dir) : null,
    h('span', { class: 'file-name' }, name));
  if (origPath) {
    el.append(h('span', { class: 'file-orig' }, ` ← ${origPath}`));
  }
  return el;
}

export function diffStatsEl(additions, deletions, binary = false) {
  if (binary) return h('span', { class: 'file-stats binary' }, '二进制');
  if (additions == null && deletions == null) return h('span', { class: 'file-stats' });
  return h('span', { class: 'file-stats' },
    additions ? h('span', { class: 'stat-add' }, `+${additions}`) : null,
    deletions ? h('span', { class: 'stat-del' }, `−${deletions}`) : null);
}

export function refsEl(refs, { limit = 5, onRefClick } = {}) {
  if (!refs || !refs.length) return null;
  const wrap = h('span', { class: 'ref-list' });
  const shown = refs.slice(0, limit);
  for (const ref of shown) {
    const cls = ref.type === 'tag' ? 'tag' : ref.type === 'remote' ? 'remote' : ref.head ? 'head' : 'branch';
    const iconName = ref.type === 'tag' ? 'tag' : ref.type === 'remote' ? 'server' : 'branch';
    const chip = h('span', {
      class: `ref-chip ${cls}`,
      title: ref.type === 'tag' ? `标签 ${ref.name}` : ref.type === 'remote' ? `远程分支 ${ref.name}` : `分支 ${ref.name}`,
      onclick: onRefClick ? (event) => { event.stopPropagation(); onRefClick(ref); } : null,
      html: `${icon(iconName, 11)}<span>${escapeText(ref.name)}</span>`,
    });
    wrap.append(chip);
  }
  if (refs.length > limit) wrap.append(h('span', { class: 'ref-chip more' }, `+${refs.length - limit}`));
  return wrap;
}

function escapeText(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function avatarEl(name, size = 28) {
  let hash = 0;
  for (const ch of name || '?') hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  const initials = (() => {
    const trimmed = (name || '').trim();
    if (!trimmed) return '?';
    if (/[\u4e00-\u9fa5]/.test(trimmed)) return trimmed.slice(-1);
    const parts = trimmed.split(/[\s._-]+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : trimmed.slice(0, 2)).toUpperCase();
  })();
  return h('span', {
    class: 'avatar',
    style: {
      width: `${size}px`, height: `${size}px`, fontSize: `${Math.max(10, size * 0.38)}px`,
      background: `hsl(${hue} 42% 38%)`, color: '#fff',
    },
    title: name || '',
  }, initials);
}
