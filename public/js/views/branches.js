import {
  h, emptyState, contextMenu, promptDialog, formDialog, confirmDialog, copyText, toast, button,
} from '../dom.js';
import { icon } from '../icons.js';
import { fmtCommitDate, fmtRelative } from '../format.js';

function aheadBehindEl(ref) {
  if (ref.type === 'branch' && ref.gone) {
    return h('span', { class: 'track gone', title: '上游分支已被删除' }, '上游已删除');
  }
  if (!ref.ahead && !ref.behind) {
    return h('span', { class: 'track' }, ref.upstream ? '已同步' : '');
  }
  return h('span', { class: 'track' },
    ref.ahead ? h('span', { class: 'ahead', title: `${ref.ahead} 个提交待推送` }, `↑${ref.ahead}`) : null,
    ref.behind ? h('span', { class: 'behind', title: `${ref.behind} 个提交待拉取` }, `↓${ref.behind}`) : null);
}

function branchRow(ctx, ref, current) {
  const isCurrent = ref.type === 'branch' && current === ref.name;
  const row = h('div', {
    class: `branch-row ${isCurrent ? 'current' : ''}`,
    oncontextmenu: (event) => branchMenu(ctx, ref, event),
    ondblclick: () => {
      if (!isCurrent) ctx.checkoutBranch(ref);
    },
  });
  const nameCell = h('div', { class: 'branch-name-cell' },
    isCurrent
      ? h('span', { class: 'current-dot', title: '当前分支' })
      : h('span', { class: 'branch-dot', html: icon(ref.type === 'remote' ? 'server' : 'branch', 14) }),
    h('span', { class: 'branch-name', title: ref.fullName }, ref.name),
    isCurrent ? h('span', { class: 'current-pill' }, '当前') : null,
    ref.type === 'tag' ? h('span', { class: 'tag-pill' }, '标签') : null,
  );
  const commitCell = h('div', { class: 'branch-commit-cell' },
    h('span', { class: 'branch-subject', title: ref.subject }, ref.subject || '(无提交)'),
    h('span', { class: 'branch-date', title: fmtCommitDate(ref.date) }, ref.date ? fmtRelative(ref.date * 1000) : ''),
  );
  const actions = h('div', { class: 'branch-actions' },
    ref.type === 'branch' && !isCurrent
      ? h('button', {
        class: 'btn tiny',
        title: `检出 ${ref.name}`,
        html: `${icon('check', 12)}<span>检出</span>`,
        onclick: (event) => { event.stopPropagation(); ctx.checkoutBranch(ref); },
      })
      : null,
    !isCurrent
      ? h('button', {
        class: 'icon-btn sm',
        title: `将 ${ref.name} 合并到当前分支`,
        html: icon('merge', 14),
        onclick: (event) => { event.stopPropagation(); ctx.mergeBranch(ref); },
      })
      : null,
    !isCurrent
      ? h('button', {
        class: 'icon-btn sm',
        title: `将当前分支变基到 ${ref.name}`,
        html: icon('rebase', 14),
        onclick: (event) => { event.stopPropagation(); ctx.rebaseBranch(ref); },
      })
      : null,
    h('button', {
      class: 'icon-btn sm',
      title: '更多操作',
      html: icon('more', 14),
      onclick: (event) => { event.stopPropagation(); branchMenu(ctx, ref, event); },
    }),
  );
  row.append(nameCell, h('div', { class: 'branch-upstream' }, ref.upstream || (ref.type === 'remote' ? ref.remote : '') || '—'), aheadBehindEl(ref), commitCell, actions);
  return row;
}

function branchMenu(ctx, ref, event) {
  const current = ctx.state.snapshot?.head?.branch;
  const isCurrent = ref.type === 'branch' && current === ref.name;
  const items = [
    {
      label: ref.type === 'remote' ? '检出为本地分支' : '检出分支',
      icon: 'check',
      disabled: isCurrent,
      onClick: () => ctx.checkoutBranch(ref),
    },
    {
      label: `查看 ${ref.name} 的日志`,
      icon: 'history',
      onClick: () => ctx.filterByRef(ref),
    },
    {
      label: '合并到当前分支',
      icon: 'merge',
      disabled: isCurrent,
      onClick: () => ctx.mergeBranch(ref),
    },
    {
      label: '将当前分支变基到此处',
      icon: 'rebase',
      disabled: isCurrent,
      onClick: () => ctx.rebaseBranch(ref),
    },
    { separator: true },
    {
      label: '从此分支新建分支…',
      icon: 'plus',
      onClick: () => ctx.createBranchDialog(ref.name),
    },
    {
      label: '复制分支名',
      icon: 'copy',
      onClick: async () => { await copyText(ref.name); toast('已复制分支名', 'success'); },
    },
  ];
  if (ref.type === 'remote') {
    items.push({
      label: '从远程分支新建跟踪分支…',
      icon: 'download',
      onClick: () => ctx.checkoutBranch(ref),
    });
  }
  if (ref.type === 'branch') {
    items.push(
      { separator: true },
      { label: '重命名分支…', icon: 'edit', onClick: () => ctx.renameBranch(ref) },
      { label: '推送分支到远程', icon: 'push', disabled: !ctx.state.snapshot.remotes.length, onClick: () => ctx.pushBranchRef(ref) },
      { label: '删除分支…', icon: 'trash', danger: true, disabled: isCurrent, onClick: () => ctx.deleteBranch(ref) },
    );
  }
  contextMenu(event, items);
}

function newBranchDialog(ctx, startName) {
  const state = ctx.state;
  const refs = state.snapshot?.refs || [];
  const options = [{ value: 'HEAD', label: '当前 HEAD' }];
  for (const ref of refs) {
    if (ref.type === 'branch' || ref.type === 'tag') options.push({ value: ref.fullName, label: `${ref.type === 'tag' ? '标签' : '分支'}：${ref.name}` });
  }
  formDialog({
    title: '新建分支',
    description: '分支会从选定的提交开始，并可选择立即检出。',
    fields: [
      { name: 'name', label: '分支名称', placeholder: '例如 feature/login', required: true },
      { name: 'start', label: '起点', type: 'select', options, value: startName || 'HEAD' },
      { name: 'checkout', label: '创建后立即检出', type: 'checkbox', value: true },
    ],
    submitText: '创建分支',
    width: 520,
  }).then((data) => {
    if (!data) return;
    ctx.createBranch(data.name, data.start, data.checkout);
  });
}

export function renderBranchesView(ctx) {
  const state = ctx.state;
  const root = h('div', { class: 'view branches-view' });
  const refs = state.snapshot?.refs || [];
  const current = state.snapshot?.head?.branch;
  const query = state.branches.query.toLowerCase();
  const branches = refs.filter((r) => r.type === 'branch' && (!query || r.name.toLowerCase().includes(query)));
  const remotes = refs.filter((r) => r.type === 'remote' && (!query || r.name.toLowerCase().includes(query)));
  const remotesConfigured = state.snapshot?.remotes || [];

  const search = h('input', {
    class: 'input search-input',
    id: 'branch-search',
    type: 'search',
    placeholder: '筛选分支…',
    value: state.branches.query,
    oninput: (event) => {
      state.branches.query = event.target.value;
      ctx.render();
    },
  });

  const toolbar = h('div', { class: 'view-toolbar' },
    h('div', { class: 'toolbar-title' }, h('span', { html: icon('branch', 15) }), h('span', {}, '分支')),
    h('div', { class: 'search-wrap small' }, h('span', { class: 'search-icon', html: icon('search', 13) }), search),
    h('div', { class: 'spacer' }),
    h('button', {
      class: 'btn small primary',
      html: `${icon('plus', 13)}<span>新建分支</span>`,
      onclick: () => newBranchDialog(ctx),
    }),
    h('button', {
      class: 'icon-btn',
      title: '刷新 (F5)',
      html: icon('refresh', 15),
      onclick: () => ctx.refreshAll({ log: false }),
    }),
  );
  root.append(toolbar);

  const scroll = h('div', { class: 'branches-scroll', 'data-scroll': 'branches' });
  const head = h('div', { class: 'branch-table-head' },
    h('div', {}, '分支'), h('div', {}, '上游'), h('div', {}, '状态'), h('div', {}, '最近提交'), h('div', {}, ''));
  scroll.append(head);

  const currentRef = refs.find((r) => r.type === 'branch' && r.name === current);
  if (currentRef) {
    scroll.append(h('div', { class: 'current-branch-card' },
      h('div', { class: 'current-branch-main' },
        h('span', { class: 'current-dot' }),
        h('span', { class: 'current-branch-name' }, current),
        h('span', { class: 'muted' }, currentRef.subject || ''),
      ),
      h('div', { class: 'current-branch-meta' },
        currentRef.upstream ? h('span', { class: 'muted' }, `跟踪 ${currentRef.upstream}`) : h('span', { class: 'warn-text' }, '尚未设置上游分支'),
        aheadBehindEl(currentRef)),
      h('div', { class: 'current-branch-actions' },
        !currentRef.upstream && remotesConfigured.length
          ? h('button', { class: 'btn small', html: `${icon('push', 13)}<span>发布分支</span>`, onclick: () => ctx.pushBranchRef(currentRef) })
          : h('button', { class: 'btn small', html: `${icon('pull', 13)}<span>拉取</span>`, onclick: () => ctx.netAction('pull') }),
        h('button', { class: 'btn small', html: `${icon('merge', 13)}<span>合并…</span>`, onclick: () => ctx.mergeRefPicker() }))));
  }

  const section = (title, list, remote = false) => {
    const sec = h('section', { class: 'branch-section' });
    sec.append(h('div', { class: 'branch-section-head' },
      h('span', { class: 'section-icon', html: icon(remote ? 'server' : 'branch', 14) }),
      h('span', {}, title),
      h('span', { class: 'count-pill' }, list.length)));
    if (!list.length) {
      sec.append(h('div', { class: 'branch-empty' }, remote ? '暂无远程分支。' : '没有本地分支。'));
    } else {
      for (const ref of list) sec.append(branchRow(ctx, ref, current));
    }
    return sec;
  };

  scroll.append(section('本地分支', branches, false));

  const remoteSection = h('section', { class: 'branch-section' });
  remoteSection.append(h('div', { class: 'branch-section-head' },
    h('span', { class: 'section-icon', html: icon('server', 14) }),
    h('span', {}, '远程仓库'),
    h('span', { class: 'count-pill' }, remotesConfigured.length),
    h('div', { class: 'spacer' }),
    h('button', {
      class: 'btn tiny',
      html: `${icon('plus', 12)}<span>添加远程</span>`,
      onclick: () => ctx.addRemoteDialog(),
    })));
  if (!remotesConfigured.length) {
    remoteSection.append(h('div', { class: 'branch-empty' }, '尚未配置远程仓库。添加远程后即可获取、拉取和推送。'));
  } else {
    for (const remote of remotesConfigured) {
      remoteSection.append(h('div', { class: 'remote-row' },
        h('span', { class: 'remote-icon', html: icon('server', 15) }),
        h('span', { class: 'remote-name' }, remote.name),
        h('span', { class: 'remote-url mono', title: remote.fetchUrl || remote.pushUrl }, remote.fetchUrl || remote.pushUrl || ''),
        h('div', { class: 'remote-actions' },
          h('button', {
            class: 'icon-btn sm',
            title: `从 ${remote.name} 获取`,
            html: icon('fetch', 13),
            onclick: () => ctx.fetchRemote(remote.name),
          }),
          h('button', {
            class: 'icon-btn sm',
            title: '复制远程地址',
            html: icon('copy', 13),
            onclick: async () => {
              await copyText(remote.fetchUrl || remote.pushUrl || '');
              toast('已复制远程地址', 'success');
            },
          }),
          h('button', {
            class: 'icon-btn sm',
            title: '移除远程',
            html: icon('trash', 13),
            onclick: () => ctx.removeRemote(remote.name),
          }))));
    }
  }
  scroll.append(remoteSection);
  scroll.append(section('远程分支', remotes, true));
  root.append(scroll);
  return root;
}
