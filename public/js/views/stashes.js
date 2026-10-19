import {
  h, emptyState, loadingState, confirmDialog, formDialog, toast,
} from '../dom.js';
import { icon } from '../icons.js';
import { fmtCommitDate, fmtRelative } from '../format.js';
import { renderDiff } from '../components/diff.js';

const DEFAULT_LIST_WIDTH = 380;

function listWidth() {
  const stored = Number(localStorage.getItem('gitviewer.stashWidth'));
  return Number.isFinite(stored) && stored >= 300 ? stored : DEFAULT_LIST_WIDTH;
}

function stashTitle(stash) {
  const raw = stash.subject || stash.ref;
  const match = raw.match(/^(?:On|WIP on) ([^:]+):\s*(.*)$/);
  if (match) {
    return { branch: match[1], message: match[2] || '（无描述）' };
  }
  return { branch: '', message: raw };
}

function stashSaveDialog(ctx) {
  const counts = ctx.state.snapshot?.status?.counts || {};
  formDialog({
    title: '贮藏当前更改',
    description: counts.total
      ? `将暂存并移除 ${counts.total} 个文件的未提交更改，稍后可以重新应用。`
      : '当前工作区没有可贮藏的更改。',
    fields: [
      { name: 'message', label: '贮藏说明', placeholder: '例如：WIP 搜索面板样式', value: '' },
      { name: 'includeUntracked', label: '包含未跟踪文件', type: 'checkbox', value: true },
    ],
    submitText: '创建贮藏',
  }).then((data) => {
    if (!data) return;
    ctx.saveStash(data.message, data.includeUntracked);
  });
}

function stashRow(ctx, stash, selected) {
  const info = stashTitle(stash);
  const row = h('div', {
    class: `stash-row ${selected ? 'selected' : ''}`,
    onclick: () => ctx.selectStash(stash.ref),
  });
  row.append(
    h('span', { class: 'stash-icon', html: icon('archive', 16) }),
    h('div', { class: 'stash-main' },
      h('div', { class: 'stash-message' }, info.message),
      h('div', { class: 'stash-meta' },
        h('span', { class: 'mono' }, stash.ref),
        info.branch ? h('span', { class: 'stash-branch', html: `${icon('branch', 11)}<span>${info.branch}</span>` }) : null,
        h('span', { title: fmtCommitDate(new Date(stash.date).getTime() / 1000) }, fmtRelative(stash.date)))),
    h('div', { class: 'stash-actions' },
      h('button', {
        class: 'icon-btn sm',
        title: '应用贮藏（保留）',
        html: icon('stashApply', 14),
        onclick: (event) => { event.stopPropagation(); ctx.applyStash(stash.ref, false); },
      }),
      h('button', {
        class: 'icon-btn sm',
        title: '弹出贮藏（应用并删除）',
        html: icon('upload', 14),
        onclick: (event) => { event.stopPropagation(); ctx.applyStash(stash.ref, true); },
      }),
      h('button', {
        class: 'icon-btn sm',
        title: '删除贮藏',
        html: icon('trash', 14),
        onclick: (event) => { event.stopPropagation(); ctx.dropStash(stash.ref); },
      })),
  );
  return row;
}

export function renderStashesView(ctx) {
  const state = ctx.state;
  const stashState = state.stashes;
  const stashes = state.snapshot?.stashes || [];
  const root = h('div', { class: 'view stashes-view' });

  const toolbar = h('div', { class: 'view-toolbar' },
    h('div', { class: 'toolbar-title' },
      h('span', { html: icon('archive', 15) }),
      h('span', {}, '贮藏'),
      stashes.length ? h('span', { class: 'count-pill' }, stashes.length) : null),
    h('div', { class: 'spacer' }),
    h('button', {
      class: 'btn small primary',
      disabled: !state.snapshot.status.counts.total,
      title: state.snapshot.status.counts.total ? '' : '工作区没有可贮藏的更改',
      html: `${icon('archive', 13)}<span>贮藏更改…</span>`,
      onclick: () => stashSaveDialog(ctx),
    }),
    h('button', {
      class: 'icon-btn',
      title: '刷新 (F5)',
      html: icon('refresh', 15),
      onclick: () => ctx.refreshAll({ log: false }),
    }),
  );
  root.append(toolbar);

  const main = h('div', { class: 'stashes-main' });
  main.style.gridTemplateColumns = `${listWidth()}px 5px minmax(0, 1fr)`;

  const left = h('div', { class: 'stash-list-pane' });
  const scroll = h('div', { class: 'stash-list', 'data-scroll': 'stashes' });
  if (!stashes.length) {
    scroll.append(emptyState({
      iconName: 'archive',
      title: '没有贮藏',
      description: '贮藏可以临时保存未提交的更改，方便切换分支或处理紧急问题。',
      actions: state.snapshot.status.counts.total
        ? [h('button', { class: 'btn', onclick: () => stashSaveDialog(ctx) }, '贮藏当前更改')]
        : [],
    }));
  } else {
    for (const stash of stashes) {
      scroll.append(stashRow(ctx, stash, stash.ref === stashState.selectedRef));
    }
  }
  left.append(scroll);
  main.append(left);

  const splitter = h('div', { class: 'splitter-col' });
  splitter.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    splitter.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = left.getBoundingClientRect().width;
    const onMove = (ev) => {
      const next = Math.max(300, Math.min(window.innerWidth - 460, startWidth + (ev.clientX - startX)));
      main.style.gridTemplateColumns = `${next}px 5px minmax(0, 1fr)`;
    };
    const onUp = () => {
      splitter.removeEventListener('pointermove', onMove);
      splitter.removeEventListener('pointerup', onUp);
      localStorage.setItem('gitviewer.stashWidth', String(Math.round(left.getBoundingClientRect().width)));
    };
    splitter.addEventListener('pointermove', onMove);
    splitter.addEventListener('pointerup', onUp);
  });
  main.append(splitter);

  const right = h('div', { class: 'stash-detail-pane' });
  const selected = stashes.find((s) => s.ref === stashState.selectedRef);
  if (!selected) {
    right.append(emptyState({
      iconName: 'archive',
      title: '选择一个贮藏',
      description: '查看贮藏内容并决定是否应用或删除。',
      compact: true,
    }));
  } else {
    const info = stashTitle(selected);
    right.append(h('div', { class: 'diff-pane-head stash-detail-head' },
      h('span', { class: 'stash-icon lg', html: icon('archive', 18) }),
      h('div', { class: 'stash-detail-title' },
        h('div', { class: 'stash-detail-message' }, info.message),
        h('div', { class: 'stash-detail-meta' },
          h('span', { class: 'mono' }, selected.ref),
          info.branch ? h('span', { class: 'muted' }, `分支 ${info.branch}`) : null,
          h('span', { class: 'muted' }, selected.date))),
      h('div', { class: 'spacer' }),
      h('button', {
        class: 'btn small',
        html: `${icon('stashApply', 13)}<span>应用</span>`,
        onclick: () => ctx.applyStash(selected.ref, false),
      }),
      h('button', {
        class: 'btn small primary',
        html: `${icon('upload', 13)}<span>弹出</span>`,
        onclick: () => ctx.applyStash(selected.ref, true),
      }),
      h('button', {
        class: 'icon-btn sm',
        title: '删除贮藏',
        html: icon('trash', 14),
        onclick: () => ctx.dropStash(selected.ref),
      })));
    if (stashState.loading) {
      right.append(loadingState('正在读取贮藏内容…'));
    } else if (stashState.diffError) {
      right.append(emptyState({ iconName: 'alert', title: '无法读取贮藏', description: stashState.diffError, compact: true }));
    } else {
      right.append(renderDiff(stashState.diff, state.settings.diffMode, {
        onModeChange: (next) => {
          state.settings.diffMode = next;
          ctx.saveSettings({ diffMode: next });
          ctx.render();
        },
      }));
    }
  }
  main.append(right);
  root.append(main);
  return root;
}
