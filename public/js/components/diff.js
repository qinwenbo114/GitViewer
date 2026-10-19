import { h } from '../dom.js';
import { icon } from '../icons.js';

function tokenize(text) {
  return text.match(/\s+|[A-Za-z0-9_$]+|[^\sA-Za-z0-9_$]/g) || [];
}

function textNode(text) {
  return document.createTextNode(text);
}

function wordDiff(oldText, newText) {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix
    && suffix < b.length - prefix
    && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) suffix++;
  const aMid = a.slice(prefix, a.length - suffix).join('');
  const bMid = b.slice(prefix, b.length - suffix).join('');
  if (!aMid && !bMid) return [textNode(oldText), textNode(newText)];
  const make = (value, mid) => {
    const frag = document.createDocumentFragment();
    const before = value.slice(0, prefix);
    const after = value.slice(value.length - suffix);
    if (before) frag.append(textNode(before));
    if (mid) frag.append(h('span', { class: 'word-diff' }, mid));
    if (after) frag.append(textNode(after));
    return frag;
  };
  return [make(oldText, aMid), make(newText, bMid)];
}

function lineNumber(n) {
  return n == null ? '' : String(n);
}

function unifiedRow(line, pair) {
  const row = h('div', { class: `diff-row ${line.type}` });
  row.append(
    h('span', { class: 'ln old' }, lineNumber(line.oldNo)),
    h('span', { class: 'ln new' }, lineNumber(line.newNo)),
    h('span', { class: 'mark' }, line.type === 'add' ? '+' : line.type === 'del' ? '−' : ''),
    h('span', { class: 'code' }),
  );
  const code = row.querySelector('.code');
  if (pair) {
    const [oldNode, newNode] = wordDiff(pair.oldText, pair.newText);
    code.append(line.type === 'del' ? oldNode : newNode);
  } else {
    code.textContent = line.text;
  }
  if (line.noNewline) row.append(h('span', { class: 'no-newline', title: '文件末尾没有换行符' }, '¬'));
  row.title = line.noNewline ? '文件末尾没有换行符' : '';
  return row;
}

function hunkHeader(line) {
  return h('div', { class: 'diff-hunk' }, line.header);
}

function buildUnified(diff, limit = 6000) {
  const wrap = h('div', { class: 'diff-unified' });
  let rendered = 0;
  let truncated = false;
  outer:
  for (const hunk of diff.hunks) {
    wrap.append(hunkHeader(hunk));
    for (const line of hunk.lines) {
      if (rendered >= limit) { truncated = true; break outer; }
      wrap.append(unifiedRow(line));
      rendered++;
    }
  }
  if (truncated) wrap.append(h('div', { class: 'diff-truncated' }, `差异过大，仅显示前 ${limit} 行。`));
  return wrap;
}

function splitHalf(line, side, pair, other) {
  const isDel = side === 'left';
  const type = !line ? 'empty' : line.type;
  const half = h('div', {
    class: `diff-half ${side} ${type} ${!line ? 'empty' : ''}`,
  });
  half.append(
    h('span', { class: 'ln' }, line ? lineNumber(isDel ? line.oldNo : line.newNo) : ''),
    h('span', { class: 'mark' }, line ? (type === 'add' ? '+' : type === 'del' ? '−' : '') : ''),
    h('span', { class: 'code' }),
  );
  if (line) {
    const code = half.querySelector('.code');
    if (pair && other) {
      const [oldNode, newNode] = wordDiff(pair.oldText, pair.newText);
      code.append(isDel ? oldNode : newNode);
    } else {
      code.textContent = line.text;
    }
    code.title = line.text;
  }
  return half;
}

function pairLines(lines) {
  const rows = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.type === 'ctx') {
      rows.push({ left: line, right: line, pair: null });
      i++;
      continue;
    }
    const dels = [];
    const adds = [];
    while (i < lines.length && lines[i].type === 'del') dels.push(lines[i++]);
    while (i < lines.length && lines[i].type === 'add') adds.push(lines[i++]);
    if (!dels.length && !adds.length) {
      i++;
      continue;
    }
    const count = Math.max(dels.length, adds.length);
    for (let k = 0; k < count; k++) {
      rows.push({
        left: dels[k] || null,
        right: adds[k] || null,
        pair: dels[k] && adds[k] ? { oldText: dels[k].text, newText: adds[k].text } : null,
      });
    }
  }
  return rows;
}

function buildSplit(diff, limit = 4000) {
  const wrap = h('div', { class: 'diff-split' });
  let rendered = 0;
  let truncated = false;
  outer:
  for (const hunk of diff.hunks) {
    wrap.append(hunkHeader(hunk));
    const rows = pairLines(hunk.lines);
    for (const row of rows) {
      if (rendered >= limit) { truncated = true; break outer; }
      const el = h('div', { class: 'split-row' });
      el.append(
        splitHalf(row.left, 'left', row.pair, row.right),
        splitHalf(row.right, 'right', row.pair, row.left),
      );
      wrap.append(el);
      rendered++;
    }
  }
  if (truncated) wrap.append(h('div', { class: 'diff-truncated' }, `差异过大，仅显示前 ${limit} 行。`));
  return wrap;
}

export function diffSummary(diff) {
  if (!diff) return '';
  if (diff.binary) return '二进制文件';
  return `+${diff.adds} −${diff.dels}`;
}

export function renderDiff(diff, mode = 'split', { onModeChange } = {}) {
  const root = h('div', { class: 'diff-view' });
  const toolbar = h('div', { class: 'diff-toolbar' });
  const summary = h('div', { class: 'diff-summary' },
    diff?.binary
      ? h('span', { class: 'diff-binary-label' }, '二进制文件')
      : h('span', { class: 'diff-stat-add' }, `+${diff?.adds ?? 0}`),
    diff?.binary ? null : h('span', { class: 'diff-stat-del' }, `−${diff?.dels ?? 0}`),
    diff?.hunks?.length ? h('span', { class: 'diff-hunk-count' }, `${diff.hunks.length} 个区块`) : null,
  );
  const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': '差异视图模式' });
  for (const [value, label, iconName] of [['split', '并排', 'columns'], ['unified', '统一', 'rows']]) {
    seg.append(h('button', {
      class: `segmented-btn ${mode === value ? 'active' : ''}`,
      title: value === 'split' ? '并排显示（Split）' : '统一显示（Unified）',
      html: `${icon(iconName, 14)}<span>${label}</span>`,
      onclick: () => {
        if (mode === value) return;
        onModeChange?.(value);
      },
    }));
  }
  toolbar.append(summary, h('div', { class: 'spacer' }), seg);
  root.append(toolbar);

  const scroll = h('div', { class: 'diff-scroll' });
  if (!diff) {
    scroll.append(h('div', { class: 'diff-empty' }, h('span', { class: 'spinner' }), '正在读取差异…'));
  } else if (diff.binary) {
    scroll.append(h('div', { class: 'diff-empty' },
      h('div', { class: 'empty-icon', html: icon('file', 32) }),
      h('div', { class: 'empty-title' }, '二进制文件'),
      h('div', { class: 'empty-desc' }, 'GitViewer 无法以文本方式显示此文件的差异。')));
  } else if (!diff.hunks.length) {
    scroll.append(h('div', { class: 'diff-empty' },
      h('div', { class: 'empty-icon', html: icon('check', 32) }),
      h('div', { class: 'empty-title' }, '没有差异'),
      h('div', { class: 'empty-desc' }, '文件内容与目标版本一致，或只修改了文件模式。')));
  } else {
    scroll.append(mode === 'split' ? buildSplit(diff) : buildUnified(diff));
  }
  root.append(scroll);
  return root;
}
