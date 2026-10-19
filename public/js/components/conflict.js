import { h } from '../dom.js';
import { icon } from '../icons.js';

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

export function renderConflictView(conflict, mode = 'working', { onModeChange } = {}) {
  const root = h('div', { class: 'conflict-view' });
  const tabs = [
    { key: 'working', label: '工作区（含标记）', icon: 'warning' },
    { key: 'ours', label: '我的版本', icon: 'user' },
    { key: 'theirs', label: '对方版本', icon: 'users' },
    { key: 'base', label: '共同祖先', icon: 'git' },
  ];
  const toolbar = h('div', { class: 'conflict-toolbar' },
    h('div', { class: 'conflict-tabs' },
      ...tabs.map((tab) => h('button', {
        class: `conflict-tab ${mode === tab.key ? 'active' : ''}`,
        html: `${icon(tab.icon, 13)}<span>${tab.label}</span>`,
        onclick: () => onModeChange?.(tab.key),
      }))),
    h('div', { class: 'spacer' }),
    h('span', { class: 'muted conflict-hint' }, '解决冲突后点击「标记为已解决」'),
  );
  root.append(toolbar);

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
