import { h } from '../dom.js';
import { fmtCommitDate } from '../format.js';
import { icon } from '../icons.js';

const COLORS = ['#5a9fd4', '#c98a5b', '#6fb37a', '#b07fd6', '#d4b264', '#d07d7d', '#54b3b3', '#8f8fd8'];

function colorFor(sha) {
  let hash = 0;
  for (let i = 0; i < sha.length; i += 2) hash = (hash * 31 + parseInt(sha.slice(i, i + 2), 16)) >>> 0;
  return COLORS[hash % COLORS.length];
}

export function renderBlame(blame, ctx) {
  const root = h('div', { class: 'blame-view' });
  const info = h('div', { class: 'blame-info' },
    h('span', { html: icon('blame', 14) }),
    h('span', { class: 'mono' }, blame.path),
    h('span', { class: 'muted' }, `${blame.lines.length} 行`),
    blame.truncated ? h('span', { class: 'warn-pill' }, '已截断') : null,
  );
  root.append(info);
  const scroll = h('div', { class: 'blame-scroll' });
  let prevSha = null;
  let groupIndex = -1;
  let lastColor = '';
  for (const line of blame.lines) {
    const isStart = line.sha !== prevSha;
    if (isStart) {
      groupIndex++;
      lastColor = colorFor(line.sha);
    }
    const row = h('div', {
      class: `blame-row ${isStart ? 'group-start' : ''} ${groupIndex % 2 ? 'odd' : ''}`,
      style: { '--blame-color': lastColor },
    });
    row.append(h('span', { class: 'blame-line' }, String(line.line)));
    const commitCell = h('span', { class: 'blame-commit' });
    if (isStart) {
      commitCell.append(
        h('button', {
          class: 'link-btn mono',
          title: `查看提交 ${line.sha}`,
          onclick: () => ctx.openCommitFromBlame(line.sha),
        }, line.sha.slice(0, 8)),
        h('span', { class: 'blame-author', title: line.author }, line.author || ''),
        h('span', { class: 'blame-date' }, fmtCommitDate(line.time)),
      );
    }
    row.append(commitCell, h('code', { class: 'blame-code' }, line.text));
    scroll.append(row);
    prevSha = line.sha;
  }
  root.append(scroll);
  return root;
}
