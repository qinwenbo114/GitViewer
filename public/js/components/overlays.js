import { h, emptyState, loadingState, copyText, toast, openModal } from '../dom.js';
import { icon } from '../icons.js';
import { rpc } from '../api.js';
import { renderDiff } from './diff.js';
import { renderBlame } from './blame.js';
import { fmtFullDate } from '../format.js';

let activeOverlay = null;

export function closeOverlay() {
  if (!activeOverlay) return;
  const { el, onClose } = activeOverlay;
  activeOverlay = null;
  document.removeEventListener('keydown', onKey, true);
  el.classList.add('overlay-out');
  setTimeout(() => el.remove(), 140);
  document.body.classList.remove('overlay-open');
  onClose?.();
}

function onKey(event) {
  if (event.key === 'Escape') {
    event.stopPropagation();
    closeOverlay();
  }
}

function ensureOverlayRoot() {
  let root = document.getElementById('overlay-root');
  if (!root) {
    root = h('div', { id: 'overlay-root' });
    document.body.append(root);
  }
  return root;
}

export function showOverlay({ title, subtitle = '', iconName = 'eye', actions = [], body, onClose }) {
  closeOverlay();
  const root = ensureOverlayRoot();
  const bodyWrap = h('div', { class: 'overlay-body' });
  if (body) bodyWrap.append(body);
  const head = h('div', { class: 'overlay-head' },
    h('span', { class: 'overlay-icon', html: icon(iconName, 18) }),
    h('div', { class: 'overlay-title-wrap' },
      h('div', { class: 'overlay-title', title }, title),
      subtitle ? h('div', { class: 'overlay-subtitle' }, subtitle) : null),
    h('div', { class: 'spacer' }),
    h('div', { class: 'overlay-actions' }, ...actions),
    h('button', {
      class: 'icon-btn overlay-close',
      title: '关闭 (Esc)',
      html: icon('x', 17),
      onclick: () => closeOverlay(),
    }));
  const el = h('div', { class: 'overlay' }, head, bodyWrap);
  root.append(el);
  document.body.classList.add('overlay-open');
  document.addEventListener('keydown', onKey, true);
  activeOverlay = { el, onClose };
  return {
    el,
    body: bodyWrap,
    close: closeOverlay,
    setBody(next) {
      bodyWrap.replaceChildren(next);
    },
    setSubtitle(text) {
      const sub = head.querySelector('.overlay-subtitle');
      if (sub) sub.textContent = text;
    },
  };
}

function subtitleFor(ctx, spec) {
  if (spec.kind === 'commit') {
    const details = ctx.state.details;
    if (details && (details.hash === spec.sha || details.hash.startsWith(spec.sha) || spec.sha.startsWith(details.hash))) {
      return `提交 ${details.short} · ${details.subject}`;
    }
    return `提交 ${String(spec.sha).slice(0, 8)}`;
  }
  if (spec.kind === 'staged') return '已暂存内容 ↔ HEAD';
  if (spec.kind === 'stash') return `贮藏 ${spec.sha}`;
  if (spec.untracked) return '未跟踪的新文件';
  return '工作区 ↔ 暂存区';
}

export async function openDiff(ctx, spec) {
  const path = spec.path || spec.file?.path || '';
  const title = spec.title || path || '差异';
  const mode0 = spec.mode || ctx.state.changes.diffMode || ctx.state.settings.diffMode || 'split';
  let mode = mode0;
  let diff = null;
  let error = null;
  let loading = true;

  const actions = [
    h('button', {
      class: 'btn small',
      title: '复制差异内容',
      html: `${icon('copy', 13)}<span>复制差异</span>`,
      onclick: async () => {
        if (!diff) return;
        await copyText(diff.text || '');
        toast('已复制差异', 'success');
      },
    }),
    h('button', {
      class: 'btn small',
      title: '查看此文件的提交历史',
      html: `${icon('history', 13)}<span>文件历史</span>`,
      onclick: () => { closeOverlay(); ctx.showFileHistory(path); },
    }),
    h('button', {
      class: 'btn small',
      title: '查看此文件的逐行作者',
      html: `${icon('blame', 13)}<span>Blame</span>`,
      onclick: () => { closeOverlay(); ctx.showBlame({ path, rev: spec.kind === 'commit' ? spec.sha : 'HEAD' }); },
    }),
  ];
  if (spec.kind === 'working' || spec.kind === 'staged') {
    actions.push(h('button', {
      class: 'btn small',
      title: '用默认程序打开工作区文件',
      html: `${icon('external', 13)}<span>打开文件</span>`,
      onclick: () => ctx.openFile(path),
    }));
  }

  const overlay = showOverlay({
    title,
    subtitle: subtitleFor(ctx, spec),
    iconName: 'eye',
    actions,
    body: loadingState('正在读取差异…'),
  });

  const paint = () => {
    if (error) {
      overlay.setBody(emptyState({ iconName: 'alert', title: '无法读取差异', description: error, compact: true }));
      return;
    }
    if (loading) {
      overlay.setBody(loadingState('正在读取差异…'));
      return;
    }
    overlay.setBody(renderDiff(diff, mode, {
      onModeChange: (next) => {
        mode = next;
        paint();
      },
    }));
  };

  try {
    diff = await rpc('repo.diff', {
      repo: ctx.state.repo.path,
      kind: spec.kind,
      sha: spec.sha,
      path,
      untracked: spec.untracked,
    });
    overlay.setSubtitle(`${subtitleFor(ctx, spec)} · ${diff.hunks.length} 个区块`);
  } catch (err) {
    error = err.message;
  } finally {
    loading = false;
    paint();
  }
  return overlay;
}

export async function showBlameOverlay(ctx, { path, rev = 'HEAD' }) {
  const overlay = showOverlay({
    title: path,
    subtitle: `Blame · ${rev}`,
    iconName: 'blame',
    actions: [
      h('button', {
        class: 'btn small',
        html: `${icon('history', 13)}<span>文件历史</span>`,
        onclick: () => { closeOverlay(); ctx.showFileHistory(path); },
      }),
      h('button', {
        class: 'btn small',
        html: `${icon('external', 13)}<span>打开文件</span>`,
        onclick: () => ctx.openFile(path),
      }),
    ],
    body: loadingState('正在计算逐行作者…'),
  });
  try {
    const blame = await rpc('repo.blame', {
      repo: ctx.state.repo.path,
      path,
      rev: rev === 'HEAD' ? null : rev,
    });
    overlay.setBody(renderBlame(blame, {
      openCommitFromBlame: (sha) => {
        closeOverlay();
        ctx.setView('log');
        ctx.selectCommit(sha);
      },
    }));
    overlay.setSubtitle(`Blame · ${rev} · ${blame.lines.length} 行${blame.truncated ? '（已截断）' : ''}`);
  } catch (err) {
    overlay.setBody(emptyState({ iconName: 'alert', title: '无法生成 Blame', description: err.message, compact: true }));
  }
  return overlay;
}

export function showOutputDialog(title, output, command = '') {
  const text = [command ? `$ ${command}` : '', output || '（没有输出）'].filter(Boolean).join('\n\n');
  const body = h('div', { class: 'dialog-text' },
    h('pre', { class: 'output-pre' }, text));
  const copy = h('button', {
    class: 'btn',
    html: `${icon('copy', 13)}<span>复制</span>`,
    onclick: async () => { await copyText(text); toast('已复制输出', 'success'); },
  });
  const close = h('button', { class: 'btn primary' }, '关闭');
  const modal = openModal({ title, body, footer: [copy, close], width: 680 });
  close.addEventListener('click', () => modal.close());
}

export function showCommitInfo(ctx, sha) {
  closeOverlay();
  ctx.setView('log');
  ctx.selectCommit(sha);
}
