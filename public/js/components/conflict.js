import { h } from '../dom.js';
import { icon } from '../icons.js';

const MARKER_OURS = /^<{7}/;
const MARKER_BASE = /^\|{7}/;
const MARKER_SEP = /^={7}/;
const MARKER_END = /^>{7}/;

function splitLines(text) {
  return String(text || '').replace(/\r\n/g, '\n').split('\n');
}

function renderCode(content, { markers = false } = {}) {
  const scroll = h('div', { class: 'conflict-scroll' });
  const lines = splitLines(content);
  let state = 'common';
  lines.forEach((text, index) => {
    let cls = state;
    let marker = false;
    if (markers) {
      if (text.startsWith('<<<<<<<')) { state = 'ours'; cls = 'ours'; marker = true; }
      else if (text.startsWith('|||||||')) { state = 'base'; cls = 'base'; marker = true; }
      else if (text.startsWith('=======')) { state = 'theirs'; cls = 'theirs'; marker = true; }
      else if (text.startsWith('>>>>>>>')) { state = 'common'; cls = 'marker'; marker = true; }
    }
    const row = h('div', { class: `conflict-line ${cls} ${marker ? 'marker-row' : ''}` });
    row.append(
      h('span', { class: 'conflict-ln' }, String(index + 1)),
      h('span', { class: 'conflict-code' }, text),
    );
    scroll.append(row);
  });
  return scroll;
}

/** 解析文本里的冲突块，带字符区间，供“我的/对方/两边都要”替换。 */
function parseBlocks(text) {
  const lines = String(text || '').split('\n');
  const blocks = [];
  let cur = null;
  let offset = 0;
  lines.forEach((line, index) => {
    const start = offset;
    offset += line.length + 1;
    if (MARKER_OURS.test(line)) {
      cur = { index: blocks.length, startLine: index + 1, start, ours: [], theirs: [], state: 'ours' };
      return;
    }
    if (!cur) return;
    if (MARKER_BASE.test(line) && cur.state === 'ours') { cur.state = 'base'; return; }
    if (MARKER_SEP.test(line) && cur.state !== 'theirs') { cur.state = 'theirs'; return; }
    if (MARKER_END.test(line)) {
      cur.endLine = index + 1;
      cur.end = start + line.length;
      blocks.push(cur);
      cur = null;
      return;
    }
    if (cur.state === 'ours') cur.ours.push(line);
    else if (cur.state === 'theirs') cur.theirs.push(line);
  });
  return blocks.filter((block) => block.end != null && block.end > block.start);
}

function applySide(text, block, side) {
  const lines = side === 'ours'
    ? block.ours
    : side === 'theirs' ? block.theirs : [...block.ours, ...block.theirs];
  const before = text.slice(0, block.start);
  const after = text.slice(Math.min(block.end + 1, text.length));
  const replacement = lines.length ? `${lines.join('\n')}\n` : '';
  return before + replacement + after;
}

function countMarkers(text) {
  return splitLines(text).filter((line) => /^(<{7}|={7}|>{7}|\|{7})/.test(line)).length;
}

function renderEditor(editor, handlers) {
  let draft = editor.text;
  let blockTimer = null;

  const blocksBar = h('div', { class: 'conflict-blocks' });
  const statusEl = h('span', { class: 'conflict-status' });

  const area = h('textarea', {
    class: 'conflict-textarea',
    spellcheck: 'false',
    autocomplete: 'off',
    autocapitalize: 'off',
    wrap: 'off',
    value: draft,
  });

  const saveBtn = h('button', {
    class: 'btn small primary',
    html: `${icon('check', 13)}<span>保存并标记为已解决</span>`,
    disabled: !!editor.saving,
    onclick: () => handlers.onSave?.(),
  });
  const cancelBtn = h('button', {
    class: 'btn small',
    html: `${icon('x', 13)}<span>取消编辑</span>`,
    onclick: () => handlers.onCancel?.(),
  });

  function refreshStatus() {
    const markers = countMarkers(draft);
    const dirty = draft !== editor.original;
    statusEl.replaceChildren(
      h('span', { class: markers ? 'warn-text' : 'ok-text' },
        markers ? `${markers} 处冲突标记未处理` : '没有残留的冲突标记'),
      dirty ? h('span', { class: 'conflict-status-dirty' }, '· 有未保存的修改') : null,
    );
    saveBtn.disabled = !!editor.saving;
  }

  function rebuildBlocks() {
    const blocks = parseBlocks(draft);
    blocksBar.replaceChildren();
    if (!blocks.length) {
      blocksBar.append(h('span', { class: 'conflict-hint muted' },
        '未检测到冲突块（标记可能已被手工删除），可直接编辑内容后保存。'));
      return;
    }
    for (const block of blocks) {
      blocksBar.append(h('div', { class: 'conflict-block' },
        h('span', { class: 'conflict-block-label' }, `冲突 ${block.index + 1} · 第 ${block.startLine}–${block.endLine} 行`),
        h('button', { class: 'btn tiny', onclick: () => apply(block, 'ours') }, '我的'),
        h('button', { class: 'btn tiny', onclick: () => apply(block, 'theirs') }, '对方'),
        h('button', { class: 'btn tiny', onclick: () => apply(block, 'both') }, '两边都要')));
    }
  }

  function apply(block, side) {
    const fresh = parseBlocks(draft).find((item) => item.index === block.index);
    if (!fresh) return;
    draft = applySide(draft, fresh, side);
    area.value = draft;
    handlers.onDraft?.(draft);
    rebuildBlocks();
    refreshStatus();
  }

  area.addEventListener('input', () => {
    draft = area.value;
    handlers.onDraft?.(draft);
    refreshStatus();
    clearTimeout(blockTimer);
    blockTimer = setTimeout(rebuildBlocks, 180);
  });
  area.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      clearTimeout(blockTimer);
      handlers.onSave?.();
    }
  });

  rebuildBlocks();
  refreshStatus();

  const wrap = h('div', { class: 'conflict-editor' });
  if (editor.error) wrap.append(h('div', { class: 'conflict-editor-error' }, editor.error));
  wrap.append(
    blocksBar,
    area,
    h('div', { class: 'conflict-editor-foot' },
      statusEl,
      h('span', { class: 'spacer' }),
      h('span', { class: 'conflict-hint muted' }, 'Ctrl+S 保存'),
      cancelBtn,
      saveBtn),
  );
  queueMicrotask(() => area.focus());
  return wrap;
}

export function renderConflictView(conflict, mode = 'working', opts = {}) {
  const { onModeChange, editor = null, onBeginEdit, onDraft, onSave, onCancel } = opts;
  const root = h('div', { class: 'conflict-view' });
  const tabs = [
    { key: 'working', label: '工作区（含标记）', icon: 'warning' },
    { key: 'ours', label: '我的版本', icon: 'user' },
    { key: 'theirs', label: '对方版本', icon: 'users' },
    { key: 'base', label: '共同祖先', icon: 'git' },
  ];
  const editing = !!(editor && mode === 'working');
  const canEdit = mode === 'working' && !conflict.working?.binary;
  const toolbar = h('div', { class: 'conflict-toolbar' },
    h('div', { class: 'conflict-tabs' },
      ...tabs.map((tab) => h('button', {
        class: `conflict-tab ${mode === tab.key ? 'active' : ''}`,
        html: `${icon(tab.icon, 13)}<span>${tab.label}</span>`,
        onclick: () => onModeChange?.(tab.key),
      }))),
    h('div', { class: 'spacer' }),
    editing
      ? h('span', { class: 'muted conflict-hint' }, '保存后若没有残留标记，会自动 git add 并标记为已解决')
      : h('span', { class: 'muted conflict-hint' }, '解决冲突后点击「标记为已解决」'),
    !editing && canEdit
      ? h('button', {
        class: 'btn small',
        html: `${icon('edit', 13)}<span>编辑</span>`,
        onclick: () => onBeginEdit?.(),
      })
      : null,
  );
  root.append(toolbar);

  if (editing) {
    root.append(renderEditor(editor, {
      onDraft: (text) => onDraft?.(text),
      onSave: () => onSave?.(),
      onCancel: () => onCancel?.(),
    }));
    return root;
  }

  const part = conflict[mode];
  if (!part) {
    root.append(h('div', { class: 'conflict-empty' }, '该版本没有内容。'));
    return root;
  }
  if (part.binary) {
    root.append(h('div', { class: 'conflict-empty' }, '二进制文件冲突，请选择保留「我的版本」或「对方版本」。'));
    return root;
  }
  if (mode === 'working' && !/^(<<<<<<<|=======|>>>>>>>)/m.test(part.content || '')) {
    root.append(h('div', { class: 'conflict-note' },
      h('span', { html: icon('info', 13) }),
      h('span', {}, '工作区文件已不再包含冲突标记，确认内容后标记为已解决。')));
  }
  root.append(renderCode(part.content, { markers: mode === 'working' }));
  return root;
}
