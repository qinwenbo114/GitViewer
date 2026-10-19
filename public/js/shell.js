import {
  h, iconEl, contextMenu, openModal, toast, copyText, confirmDialog,
} from './dom.js';
import { logo, icon } from './icons.js';
import { fmtCommitDate } from './format.js';
import { openRepoDialog, cloneDialog, initDialog, createBranchDialog } from './components/dialogs.js';

export function applyTheme(settings) {
  document.documentElement.dataset.theme = settings?.theme === 'light' ? 'light' : 'dark';
}

function repoMenu(ctx, event) {
  const state = ctx.state;
  const items = [];
  if (state.recent?.length) {
    items.push({ label: '最近打开', disabled: true });
    for (const repo of state.recent.slice(0, 8)) {
      items.push({
        label: repo.exists ? repo.name : `${repo.name}（路径不存在）`,
        icon: repo.exists ? 'folder' : 'alert',
        disabled: !repo.exists,
        onClick: () => ctx.openRepoPath(repo.path),
      });
    }
    items.push({ separator: true });
  }
  items.push(
    { label: '打开仓库…', icon: 'folderOpen', shortcut: 'Ctrl+O', onClick: () => openRepoDialog(ctx) },
    { label: '克隆仓库…', icon: 'download', onClick: () => cloneDialog(ctx) },
    { label: '初始化仓库…', icon: 'plus', onClick: () => initDialog(ctx) },
  );
  if (state.repo) {
    items.push(
      { separator: true },
      { label: '在资源管理器中打开', icon: 'external', onClick: () => ctx.revealRepo() },
      { label: '复制仓库路径', icon: 'copy', onClick: async () => { await copyText(state.repo.path); toast('已复制仓库路径', 'success'); } },
      { label: '关闭仓库', icon: 'x', onClick: () => ctx.closeRepo() },
    );
  }
  contextMenu(event, items);
}

function pullMenu(ctx, event, anchor) {
  const rect = anchor?.getBoundingClientRect();
  const ev = event || { clientX: rect?.left || 40, clientY: rect?.bottom || 40 };
  contextMenu(ev, [
    { label: '拉取并合并（merge）', icon: 'pull', onClick: () => ctx.netAction('pull', { mode: 'merge' }) },
    { label: '拉取并变基（rebase）', icon: 'rebase', onClick: () => ctx.netAction('pull', { mode: 'rebase' }) },
    { label: '仅快进（ff-only）', icon: 'download', onClick: () => ctx.netAction('pull', { mode: 'ff-only' }) },
    { separator: true },
    { label: '获取所有远程更新', icon: 'fetch', onClick: () => ctx.netAction('fetch') },
  ]);
}

function pushMenu(ctx, event, anchor) {
  const rect = anchor?.getBoundingClientRect();
  const ev = event || { clientX: rect?.left || 40, clientY: rect?.bottom || 40 };
  contextMenu(ev, [
    { label: '推送当前分支', icon: 'push', onClick: () => ctx.netAction('push') },
    {
      label: '强制推送（--force-with-lease）',
      icon: 'upload',
      danger: true,
      onClick: () => ctx.netAction('push', { force: true }),
    },
  ]);
}

function branchPopover(ctx, anchor) {
  document.querySelectorAll('.branch-popover').forEach((el) => el.remove());
  const state = ctx.state;
  const refs = state.snapshot?.refs || [];
  const current = state.snapshot?.head?.branch;
  const local = refs.filter((r) => r.type === 'branch');
  const remote = refs.filter((r) => r.type === 'remote');
  const popover = h('div', { class: 'branch-popover' });
  const search = h('input', {
    class: 'input search-input',
    placeholder: '搜索分支…',
    type: 'search',
  });
  const list = h('div', { class: 'branch-popover-list' });
  popover.append(
    h('div', { class: 'popover-head' }, h('span', { html: icon('branch', 14) }), h('span', {}, '切换分支')),
    h('div', { class: 'search-wrap small' }, h('span', { class: 'search-icon', html: icon('search', 13) }), search),
    list,
    h('div', { class: 'popover-footer' },
      h('button', {
        class: 'popover-action',
        html: `${icon('plus', 13)}<span>新建分支…</span>`,
        onclick: () => { close(); createBranchDialog(ctx); },
      })),
  );
  document.getElementById('menu-root').append(popover);
  const rect = anchor.getBoundingClientRect();
  popover.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 380))}px`;
  popover.style.top = `${rect.bottom + 6}px`;

  function renderList() {
    const q = search.value.toLowerCase();
    list.replaceChildren();
    const section = (title, items) => {
      const filtered = items.filter((r) => !q || r.name.toLowerCase().includes(q));
      if (!filtered.length) return;
      list.append(h('div', { class: 'popover-section' }, title));
      for (const ref of filtered) {
        const isCurrent = ref.type === 'branch' && ref.name === current;
        list.append(h('button', {
          class: `branch-option ${isCurrent ? 'current' : ''}`,
          onclick: () => { close(); if (!isCurrent) ctx.checkoutBranch(ref); },
        },
        h('span', { class: 'branch-option-icon', html: icon(ref.type === 'remote' ? 'server' : 'branch', 14) }),
        h('span', { class: 'branch-option-name' }, ref.name),
        isCurrent ? h('span', { class: 'current-pill' }, '当前') : null,
        ref.type === 'branch' && (ref.ahead || ref.behind)
          ? h('span', { class: 'branch-option-track' },
            ref.ahead ? `↑${ref.ahead}` : '', ref.behind ? ` ↓${ref.behind}` : '')
          : null,
        h('span', { class: 'branch-option-date' }, ref.date ? fmtCommitDate(ref.date) : ''),
        h('span', { class: 'branch-option-check', html: isCurrent ? icon('check', 14) : '' })));
      }
    };
    section('本地分支', local);
    section('远程分支', remote);
    if (!local.length && !remote.length) list.append(h('div', { class: 'popover-empty' }, '没有分支'));
  }
  search.addEventListener('input', renderList);
  renderList();

  function close() {
    popover.remove();
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
  }
  function onDown(ev) {
    if (!popover.contains(ev.target) && ev.target !== anchor) close();
  }
  function onKey(ev) {
    if (ev.key === 'Escape') { ev.stopPropagation(); close(); }
  }
  setTimeout(() => {
    search.focus();
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);
}

export function renderTopbar(ctx) {
  const state = ctx.state;
  const repo = state.repo;
  const snapshot = state.snapshot;
  const head = snapshot?.head;
  const topbar = h('header', { class: 'topbar', id: 'topbar' });

  const brand = h('button', {
    class: 'brand',
    title: 'GitViewer',
    onclick: () => ctx.setView(repo ? 'log' : 'home'),
  },
  h('span', { class: 'brand-logo', html: logo(24) }),
  h('span', { class: 'brand-name' }, 'GitViewer'));

  const picker = h('button', {
    class: `repo-picker ${repo ? '' : 'empty'}`,
    title: repo ? '切换仓库' : '打开仓库',
    onclick: (event) => repoMenu(ctx, event),
  },
  h('span', { class: 'repo-picker-icon', html: icon(repo ? 'folder' : 'folderOpen', 16) }),
  h('span', { class: 'repo-picker-text' },
    h('span', { class: 'repo-picker-name' }, repo ? repo.name : '打开仓库'),
    h('span', { class: 'repo-picker-path' }, repo ? repo.path : '选择本地 Git 仓库或克隆远程仓库')),
  h('span', { class: 'repo-picker-chevron', html: icon('chevronDown', 13) }));

  topbar.append(brand, picker);

  if (repo && head) {
    const branchName = head.branch || (head.detached ? '分离 HEAD' : '未出生分支');
    const ahead = head.ahead || 0;
    const behind = head.behind || 0;
    const branchChip = h('button', {
      class: 'branch-chip',
      title: '切换分支',
      onclick: () => branchPopover(ctx, branchChip),
    },
    h('span', { html: icon(head.detached ? 'git' : 'branch', 14) }),
    h('span', { class: 'branch-chip-name' }, branchName),
    ahead ? h('span', { class: 'ahead', title: `${ahead} 个提交待推送` }, `↑${ahead}`) : null,
    behind ? h('span', { class: 'behind', title: `${behind} 个提交待拉取` }, `↓${behind}`) : null,
    h('span', { class: 'branch-chip-caret', html: icon('chevronDown', 11) }));
    topbar.append(branchChip);
  }

  topbar.append(h('div', { class: 'spacer' }));

  if (repo) {
    const actions = h('div', { class: 'topbar-actions' });
    actions.append(
      h('button', {
        class: 'toolbar-btn',
        title: '获取所有远程更新 (Fetch)',
        html: `${icon('fetch', 15)}<span>获取</span>`,
        onclick: () => ctx.netAction('fetch'),
      }),
      h('div', { class: 'split-btn' },
        h('button', {
          class: 'toolbar-btn',
          title: '拉取远程更新 (Pull)',
          disabled: !snapshot.remotes.length,
          html: `${icon('pull', 15)}<span>拉取</span>`,
          onclick: () => ctx.netAction('pull'),
        }),
        h('button', {
          class: 'toolbar-btn split-caret',
          title: '拉取选项',
          disabled: !snapshot.remotes.length,
          html: icon('chevronDown', 11),
          onclick: (event) => pullMenu(ctx, null, event.currentTarget),
        })),
      h('div', { class: 'split-btn' },
        h('button', {
          class: 'toolbar-btn',
          title: '推送当前分支 (Push)',
          disabled: !snapshot.remotes.length,
          html: `${icon('push', 15)}<span>推送</span>`,
          onclick: () => ctx.netAction('push'),
        }),
        h('button', {
          class: 'toolbar-btn split-caret',
          title: '推送选项',
          disabled: !snapshot.remotes.length,
          html: icon('chevronDown', 11),
          onclick: (event) => pushMenu(ctx, null, event.currentTarget),
        })),
      h('button', {
        class: 'icon-btn',
        title: '刷新 (F5)',
        html: icon('refresh', 16),
        onclick: () => ctx.refreshAll({ log: true }),
      }),
    );
    topbar.append(actions);
  }

  topbar.append(h('button', {
    class: 'icon-btn',
    title: '设置',
    html: icon('settings', 17),
    onclick: () => ctx.openSettings(),
  }));

  topbar.append(h('div', { class: 'global-progress', id: 'global-progress' },
    h('div', { class: 'progress-bar' }),
    h('span', { class: 'progress-label' })));
  return topbar;
}

export function renderRail(ctx) {
  const state = ctx.state;
  if (!state.repo) return null;
  const counts = state.snapshot?.status?.counts || {};
  const views = [
    { key: 'log', label: '日志', icon: 'commit' },
    { key: 'changes', label: '变更', icon: 'edit', badge: counts.total || 0, tone: 'warn' },
    { key: 'branches', label: '分支', icon: 'branch' },
    { key: 'stashes', label: '贮藏', icon: 'archive', badge: state.snapshot?.stashes?.length || 0 },
    { key: 'tags', label: '标签', icon: 'tag' },
    { key: 'console', label: '控制台', icon: 'terminal' },
  ];
  const rail = h('nav', { class: 'rail', id: 'rail' });
  for (const view of views) {
    rail.append(h('button', {
      class: `rail-btn ${state.view === view.key ? 'active' : ''}`,
      title: view.label,
      onclick: () => ctx.setView(view.key),
    },
    h('span', { class: 'rail-icon', html: icon(view.icon, 20) }),
    h('span', { class: 'rail-label' }, view.label),
    view.badge ? h('span', { class: `rail-badge ${view.tone || ''}` }, view.badge > 99 ? '99+' : view.badge) : null));
  }
  rail.append(h('div', { class: 'rail-spacer' }));
  rail.append(h('button', {
    class: 'rail-btn',
    title: '设置',
    onclick: () => ctx.openSettings(),
  },
  h('span', { class: 'rail-icon', html: icon('settings', 19) }),
  h('span', { class: 'rail-label' }, '设置')));
  return rail;
}

export function renderStatusbar(ctx) {
  const state = ctx.state;
  const bar = h('footer', { class: 'statusbar', id: 'statusbar' });
  const snap = state.snapshot;
  if (!state.repo) {
    bar.append(h('span', { class: 'status-item muted' }, 'GitViewer'), h('span', { class: 'spacer' }),
      h('span', { class: 'status-item muted' }, '本地 Git 可视化工具'));
    return bar;
  }
  const head = snap.head;
  const items = [
    h('span', { class: 'status-item' },
      h('span', { html: icon(head.detached ? 'git' : 'branch', 12) }),
      h('span', {}, head.branch || 'HEAD')),
    head.upstream
      ? h('span', { class: 'status-item muted', title: `上游：${head.upstream}` }, head.upstream)
      : null,
    head.ahead ? h('span', { class: 'status-item ahead' }, `↑${head.ahead}`) : null,
    head.behind ? h('span', { class: 'status-item behind' }, `↓${head.behind}`) : null,
    snap.operation.merge ? h('span', { class: 'status-item op' }, '合并中')
      : snap.operation.rebase ? h('span', { class: 'status-item op' }, '变基中')
        : snap.operation.cherryPick ? h('span', { class: 'status-item op' }, '拣选中')
          : snap.operation.revert ? h('span', { class: 'status-item op' }, '还原中') : null,
    h('span', { class: 'spacer' }),
    h('span', {
      class: 'status-item status-path',
      title: '点击复制仓库路径',
      onclick: async () => { await copyText(state.repo.path); toast('已复制仓库路径', 'success'); },
    }, state.repo.path),
    snap.status.counts.total
      ? h('span', { class: 'status-item warn' }, `${snap.status.counts.total} 个变更`)
      : h('span', { class: 'status-item ok' }, '工作区干净'),
    h('span', {
      class: 'status-item muted',
      title: snap.gitVersion || '',
    }, (snap.gitVersion || '').replace('git version ', 'Git ').replace(/\.windows\.\d+$/, '')),
  ];
  bar.append(...items.filter(Boolean));
  return bar;
}

function settingRow(label, control, help = '') {
  return h('label', { class: 'setting-row' },
    h('span', { class: 'setting-label' }, label),
    h('span', { class: 'setting-control' }, control, help ? h('span', { class: 'setting-help' }, help) : null));
}

export function openSettings(ctx) {
  const state = ctx.state;
  const s = { ...state.settings };
  const themeSelect = h('select', { class: 'input' },
    h('option', { value: 'dark', selected: s.theme === 'dark' }, '深色（Darcula 风格）'),
    h('option', { value: 'light', selected: s.theme === 'light' }, '浅色'));
  const diffSelect = h('select', { class: 'input' },
    h('option', { value: 'split', selected: s.diffMode === 'split' }, '并排显示'),
    h('option', { value: 'unified', selected: s.diffMode === 'unified' }, '统一显示'));
  const pullSelect = h('select', { class: 'input' },
    h('option', { value: 'merge', selected: s.pullMode === 'merge' }, '合并（merge）'),
    h('option', { value: 'rebase', selected: s.pullMode === 'rebase' }, '变基（rebase）'),
    h('option', { value: 'ff-only', selected: s.pullMode === 'ff-only' }, '仅快进（ff-only）'));
  const confirmCheck = h('input', { type: 'checkbox', checked: s.confirmDestructive });
  const fetchCheck = h('input', { type: 'checkbox', checked: s.fetchOnOpen });
  const compactCheck = h('input', { type: 'checkbox', checked: s.graphCompact });
  const signoffCheck = h('input', { type: 'checkbox', checked: s.commitSignoff });

  themeSelect.addEventListener('change', () => {
    document.documentElement.dataset.theme = themeSelect.value;
  });

  const info = state.appInfo || {};
  const about = h('div', { class: 'settings-about' },
    h('div', { class: 'about-line' }, h('span', {}, 'GitViewer'), h('span', { class: 'mono' }, 'v1.0.0')),
    h('div', { class: 'about-line' }, h('span', {}, 'Git'), h('span', { class: 'mono' }, state.snapshot?.gitVersion || '检测中…')),
    h('div', { class: 'about-line' }, h('span', {}, 'Node.js'), h('span', { class: 'mono' }, info.nodeVersion || '—')),
    h('div', { class: 'about-line' }, h('span', {}, '数据目录'), h('span', { class: 'mono small', title: info.dataDir }, info.dataDir || '—')),
    h('div', { class: 'about-line' }, h('span', {}, '当前仓库'), h('span', { class: 'mono small', title: state.repo?.path }, state.repo?.path || '—')),
    h('div', { class: 'about-actions' },
      h('button', {
        class: 'btn small',
        html: `${icon('folderOpen', 13)}<span>打开数据目录</span>`,
        onclick: () => ctx.revealDataDir(),
      }),
      h('button', {
        class: 'btn small danger',
        html: `${icon('signout', 13)}<span>退出 GitViewer</span>`,
        onclick: async () => {
          const ok = await confirmDialog({
            title: '退出 GitViewer',
            message: '确定要关闭本地服务并退出吗？',
            confirmText: '退出',
            danger: true,
          });
          if (ok) ctx.quit();
        },
      })));

  const body = h('div', { class: 'settings-body' },
    h('section', { class: 'settings-section' },
      h('h3', {}, '外观'),
      settingRow('主题', themeSelect),
      settingRow('紧凑提交列表', compactCheck, '减少提交行的行高，显示更多历史。')),
    h('section', { class: 'settings-section' },
      h('h3', {}, '差异与提交'),
      settingRow('默认差异视图', diffSelect),
      settingRow('为提交添加 Signed-off-by', signoffCheck)),
    h('section', { class: 'settings-section' },
      h('h3', {}, '同步'),
      settingRow('默认拉取方式', pullSelect),
      settingRow('打开仓库时自动获取', fetchCheck)),
    h('section', { class: 'settings-section' },
      h('h3', {}, '安全'),
      settingRow('执行危险操作前确认', confirmCheck, '包括回滚、删除分支、强制推送等。')),
    h('section', { class: 'settings-section' },
      h('h3', {}, '关于'),
      about),
    h('section', { class: 'settings-section shortcuts' },
      h('h3', {}, '快捷键'),
      h('div', { class: 'shortcut-grid' },
        h('span', {}, '刷新'), h('kbd', {}, 'F5'),
        h('span', {}, '搜索提交'), h('kbd', {}, 'Ctrl+F'),
        h('span', {}, '提交更改'), h('kbd', {}, 'Ctrl+Enter'),
        h('span', {}, '切换视图'), h('kbd', {}, 'Alt+1…6'),
        h('span', {}, '关闭弹层'), h('kbd', {}, 'Esc'))),
  );

  const cancel = h('button', { class: 'btn' }, '取消');
  const save = h('button', { class: 'btn primary' }, '保存设置');
  let saved = false;
  const modal = openModal({
    title: '设置',
    body,
    footer: [cancel, save],
    width: 720,
    cls: 'settings-modal',
    onClose: () => {
      if (!saved) document.documentElement.dataset.theme = ctx.state.settings.theme;
    },
  });
  cancel.addEventListener('click', () => {
    modal.close();
  });
  save.addEventListener('click', () => {
    const next = {
      theme: themeSelect.value,
      diffMode: diffSelect.value,
      pullMode: pullSelect.value,
      confirmDestructive: confirmCheck.checked,
      fetchOnOpen: fetchCheck.checked,
      graphCompact: compactCheck.checked,
      commitSignoff: signoffCheck.checked,
    };
    saved = true;
    modal.close();
    ctx.saveSettings(next);
  });
}
