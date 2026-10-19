import { h, emptyState, copyText, toast, contextMenu } from '../dom.js';
import { icon } from '../icons.js';
import { fmtFullDate } from '../format.js';

function commandStatus(entry) {
  if (entry.code === 0) return h('span', { class: 'cmd-status ok' }, '成功');
  if (entry.code === -2) return h('span', { class: 'cmd-status timeout' }, '超时');
  return h('span', { class: 'cmd-status fail' }, `退出码 ${entry.code}`);
}

export function renderConsoleView(ctx) {
  const state = ctx.state;
  const root = h('div', { class: 'view console-view' });
  const filter = state.console.filter.toLowerCase();
  const items = state.console.items
    .slice()
    .reverse()
    .filter((entry) => {
      if (!filter) return true;
      return `${entry.command}\n${entry.stdout || ''}\n${entry.stderr || ''}`.toLowerCase().includes(filter);
    });

  const search = h('input', {
    class: 'input search-input',
    id: 'console-search',
    type: 'search',
    placeholder: '筛选命令或输出…',
    value: state.console.filter,
    oninput: (event) => {
      state.console.filter = event.target.value;
      ctx.render();
    },
  });

  root.append(h('div', { class: 'view-toolbar' },
    h('div', { class: 'toolbar-title' },
      h('span', { html: icon('terminal', 15) }),
      h('span', {}, 'Git 控制台'),
      h('span', { class: 'count-pill' }, state.console.items.length)),
    h('div', { class: 'search-wrap small' }, h('span', { class: 'search-icon', html: icon('search', 13) }), search),
    h('div', { class: 'spacer' }),
    h('button', {
      class: 'btn small',
      html: `${icon('copy', 13)}<span>复制全部</span>`,
      disabled: !state.console.items.length,
      onclick: async () => {
        const text = state.console.items.map((entry) => `$ ${entry.command}\n${entry.stdout || ''}${entry.stderr || ''}`).join('\n\n');
        await copyText(text);
        toast('已复制控制台内容', 'success');
      },
    }),
    h('button', {
      class: 'btn small',
      html: `${icon('trash', 13)}<span>清空</span>`,
      disabled: !state.console.items.length,
      onclick: () => { state.console.items = []; ctx.render(); },
    })));

  const scroll = h('div', { class: 'console-scroll', 'data-scroll': 'console' });
  if (!items.length) {
    scroll.append(emptyState({
      iconName: 'terminal',
      title: state.console.items.length ? '没有匹配的命令' : '尚无 Git 命令',
      description: 'GitViewer 执行的每一条 Git 命令及其输出都会记录在这里。',
      compact: true,
    }));
  } else {
    for (const entry of items) {
      const expanded = state.console.expanded.has(entry.id);
      const block = h('div', { class: `console-entry ${entry.code !== 0 ? 'failed' : ''}` });
      const summary = h('div', {
        class: 'console-summary',
        onclick: () => {
          if (expanded) state.console.expanded.delete(entry.id);
          else state.console.expanded.add(entry.id);
          ctx.render();
        },
        oncontextmenu: (event) => contextMenu(event, [
          { label: '复制命令', icon: 'copy', onClick: async () => { await copyText(entry.command); toast('已复制命令', 'success'); } },
          { label: '复制输出', icon: 'copy', onClick: async () => { await copyText(`${entry.stdout || ''}${entry.stderr || ''}`); toast('已复制输出', 'success'); } },
        ]),
      },
      h('span', { class: 'console-chevron', html: icon(expanded ? 'chevronDown' : 'chevronRight', 12) }),
      h('span', { class: 'console-time', title: fmtFullDate(entry.at / 1000) }, new Date(entry.at).toLocaleTimeString('zh-CN', { hour12: false })),
      h('span', { class: 'console-cmd mono' }, `git ${entry.command.replace(/^git\s+/, '')}`),
      h('span', { class: 'spacer' }),
      h('span', { class: 'console-ms' }, `${entry.ms} ms`),
      commandStatus(entry));
      block.append(summary);
      if (expanded) {
        const output = [entry.stdout, entry.stderr].filter(Boolean).join('\n');
        block.append(h('pre', { class: 'console-output' }, output || '（没有输出）'));
      }
      scroll.append(block);
    }
  }
  root.append(scroll);
  return root;
}
