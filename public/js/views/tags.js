import {
  h, emptyState, formDialog, confirmDialog, contextMenu, copyText, toast,
} from '../dom.js';
import { icon } from '../icons.js';
import { fmtCommitDate, fmtRelative } from '../format.js';

function tagRow(ctx, tag, state) {
  const row = h('div', {
    class: 'tag-row',
    oncontextmenu: (event) => tagMenu(ctx, tag, event, state),
  });
  row.append(
    h('div', { class: 'tag-name-cell' },
      h('span', { class: 'tag-icon', html: icon('tag', 16) }),
      h('span', { class: 'tag-name' }, tag.name),
      tag.annotated ? h('span', { class: 'annotated-pill' }, '附注') : null),
    h('span', { class: 'tag-sha mono' }, tag.sha.slice(0, 8)),
    h('span', { class: 'tag-subject', title: tag.subject }, tag.subject || ''),
    h('span', { class: 'tag-date', title: fmtCommitDate(tag.date) }, tag.date ? fmtRelative(tag.date * 1000) : ''),
    h('div', { class: 'tag-actions' },
      h('button', {
        class: 'icon-btn sm',
        title: '检出此标签（分离 HEAD）',
        html: icon('check', 13),
        onclick: (event) => { event.stopPropagation(); ctx.checkoutTag(tag); },
      }),
      h('button', {
        class: 'icon-btn sm',
        title: '查看此标签的提交',
        html: icon('history', 13),
        onclick: (event) => { event.stopPropagation(); ctx.filterByRef(tag); },
      }),
      h('button', {
        class: 'icon-btn sm',
        title: '推送到远程',
        disabled: !state.snapshot.remotes.length,
        html: icon('push', 13),
        onclick: (event) => { event.stopPropagation(); ctx.pushTag(tag); },
      }),
      h('button', {
        class: 'icon-btn sm',
        title: '更多',
        html: icon('more', 13),
        onclick: (event) => { event.stopPropagation(); tagMenu(ctx, tag, event, state); },
      })),
  );
  return row;
}

function tagMenu(ctx, tag, event, state) {
  contextMenu(event, [
    { label: '检出此标签', icon: 'check', onClick: () => ctx.checkoutTag(tag) },
    { label: '查看提交历史', icon: 'history', onClick: () => ctx.filterByRef(tag) },
    { label: '复制标签名', icon: 'copy', onClick: async () => { await copyText(tag.name); toast('已复制标签名', 'success'); } },
    { separator: true },
    { label: '推送标签到远程', icon: 'push', disabled: !state.snapshot.remotes.length, onClick: () => ctx.pushTag(tag) },
    { label: '删除标签…', icon: 'trash', danger: true, onClick: () => ctx.deleteTag(tag) },
  ]);
}

function newTagDialog(ctx) {
  const refs = ctx.state.snapshot?.refs || [];
  const options = [{ value: 'HEAD', label: '当前 HEAD' }];
  for (const ref of refs) {
    if (ref.type === 'branch') options.push({ value: ref.fullName, label: `分支：${ref.name}` });
  }
  formDialog({
    title: '新建标签',
    description: '标签用于标记发布版本或重要提交。附注标签会记录创建者、日期和说明。',
    fields: [
      { name: 'name', label: '标签名称', placeholder: '例如 v1.2.0', required: true },
      { name: 'target', label: '目标提交', type: 'select', options, value: 'HEAD' },
      { name: 'annotated', label: '创建附注标签', type: 'checkbox', value: true },
      { name: 'message', label: '标签说明', placeholder: '发布说明（附注标签）' },
    ],
    submitText: '创建标签',
    width: 540,
  }).then((data) => {
    if (!data) return;
    ctx.createTag(data.name, data.target, data.annotated, data.message);
  });
}

export function renderTagsView(ctx) {
  const state = ctx.state;
  const root = h('div', { class: 'view tags-view' });
  const query = state.tags.query.toLowerCase();
  const tags = (state.snapshot?.refs || [])
    .filter((r) => r.type === 'tag' && (!query || r.name.toLowerCase().includes(query)))
    .sort((a, b) => (b.date || 0) - (a.date || 0));

  const search = h('input', {
    class: 'input search-input',
    id: 'tag-search',
    type: 'search',
    placeholder: '筛选标签…',
    value: state.tags.query,
    oninput: (event) => {
      state.tags.query = event.target.value;
      ctx.render();
    },
  });

  root.append(h('div', { class: 'view-toolbar' },
    h('div', { class: 'toolbar-title' },
      h('span', { html: icon('tag', 15) }),
      h('span', {}, '标签'),
      tags.length ? h('span', { class: 'count-pill' }, tags.length) : null),
    h('div', { class: 'search-wrap small' }, h('span', { class: 'search-icon', html: icon('search', 13) }), search),
    h('div', { class: 'spacer' }),
    h('button', {
      class: 'btn small primary',
      html: `${icon('plus', 13)}<span>新建标签</span>`,
      onclick: () => newTagDialog(ctx),
    }),
    h('button', {
      class: 'icon-btn',
      title: '刷新 (F5)',
      html: icon('refresh', 15),
      onclick: () => ctx.refreshAll({ log: false }),
    }),
  ));

  const scroll = h('div', { class: 'tags-scroll', 'data-scroll': 'tags' });
  scroll.append(h('div', { class: 'tag-table-head' },
    h('div', {}, '标签'), h('div', {}, '提交'), h('div', {}, '说明'), h('div', {}, '日期'), h('div', {}, '')));
  if (!tags.length) {
    scroll.append(emptyState({
      iconName: 'tag',
      title: query ? '没有匹配的标签' : '还没有标签',
      description: query ? '尝试其他关键词。' : '为发布版本创建标签，便于后续查找与回滚。',
      actions: query ? [] : [h('button', { class: 'btn', onclick: () => newTagDialog(ctx) }, '新建标签')],
    }));
  } else {
    for (const tag of tags) scroll.append(tagRow(ctx, tag, state));
  }
  root.append(scroll);
  return root;
}
