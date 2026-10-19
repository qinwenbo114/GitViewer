import {
  h, openModal, formDialog, emptyState, loadingState,
} from '../dom.js';
import { icon } from '../icons.js';
import { rpc } from '../api.js';

export function pickDirectory({ title = '选择文件夹', initial = null, selectLabel = '选择此文件夹' } = {}) {
  return new Promise((resolve) => {
    let current = null;
    let selected = null;
    let roots = [];
    let home = '';

    const pathInput = h('input', {
      class: 'input dir-path-input',
      type: 'text',
      spellcheck: 'false',
      placeholder: '输入文件夹路径后按 Enter',
    });
    const upBtn = h('button', {
      class: 'icon-btn',
      title: '上一级',
      html: icon('arrowLeft', 15),
      onclick: () => { if (current?.parent) load(current.parent); },
    });
    const goBtn = h('button', {
      class: 'btn small',
      html: icon('chevronRight', 13),
      title: '转到',
      onclick: () => { if (pathInput.value.trim()) load(pathInput.value.trim()); },
    });
    const rootsBar = h('div', { class: 'dir-roots' });
    const list = h('div', { class: 'dir-list' });
    const error = h('div', { class: 'field-error' });
    const status = h('div', { class: 'dir-status' });
    const body = h('div', { class: 'dir-picker' },
      h('div', { class: 'dir-toolbar' }, upBtn, pathInput, goBtn),
      rootsBar,
      h('div', { class: 'dir-list-wrap' }, list),
      error,
      status,
    );

    const cancel = h('button', { class: 'btn' }, '取消');
    const choose = h('button', { class: 'btn primary' }, selectLabel);
    const modal = openModal({
      title,
      body,
      footer: [status, h('div', { class: 'spacer' }), cancel, choose],
      width: 760,
      cls: 'dir-modal',
      onClose: () => resolve(null),
    });
    cancel.addEventListener('click', () => { modal.close(); });
    choose.addEventListener('click', () => {
      const target = selected || current?.path;
      if (!target) return;
      resolve(target);
      modal.close();
    });

    pathInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        load(pathInput.value.trim());
      }
    });

    function renderRoots() {
      rootsBar.replaceChildren();
      for (const root of roots) {
        rootsBar.append(h('button', {
          class: 'root-chip',
          title: root,
          onclick: () => load(root),
        }, root));
      }
      if (home) {
        rootsBar.append(h('button', {
          class: 'root-chip',
          title: home,
          onclick: () => load(home),
        }, '个人文件夹'));
      }
    }

    function highlight(target) {
      for (const row of list.children) {
        row.classList.toggle('selected', row.dataset.path === target);
      }
      selected = target;
      choose.disabled = !target;
      status.textContent = target || '';
    }

    async function load(target) {
      error.textContent = '';
      list.replaceChildren(loadingState('正在读取文件夹…'));
      try {
        const data = await rpc('fs.list', target ? { path: target } : {});
        roots = data.roots || roots;
        home = data.home || home;
        renderRoots();
        if (!data.path) {
          current = { path: null, parent: null };
          pathInput.value = '';
          list.replaceChildren(h('div', { class: 'dir-hint' }, '选择一个磁盘，或直接在地址栏输入路径。'));
          highlight(null);
          return;
        }
        current = data;
        pathInput.value = data.path;
        list.replaceChildren();
        if (data.parent) {
          const upRow = h('div', {
            class: 'dir-row',
            onclick: () => load(data.parent),
            ondblclick: () => load(data.parent),
          },
          h('span', { class: 'dir-icon', html: icon('arrowLeft', 15) }),
          h('span', { class: 'dir-name' }, '..'),
          h('span', { class: 'dir-sub' }, data.parent));
          list.append(upRow);
        }
        if (!data.dirs.length) {
          list.append(h('div', { class: 'dir-hint' }, '此文件夹下没有子文件夹。'));
        }
        for (const dir of data.dirs) {
          const row = h('div', {
            class: 'dir-row',
            'data-path': dir.path,
            title: dir.path,
            onclick: () => highlight(dir.path),
            ondblclick: () => load(dir.path),
          },
          h('span', { class: 'dir-icon', html: icon(dir.isRepo ? 'git' : 'folder', 16) }),
          h('span', { class: 'dir-name' }, dir.name),
          dir.isRepo ? h('span', { class: 'repo-badge' }, 'Git 仓库') : null);
          list.append(row);
        }
        highlight(data.isRepo ? data.path : null);
        if (data.isRepo) status.textContent = `${data.path}（Git 仓库）`;
      } catch (err) {
        list.replaceChildren();
        error.textContent = err.message;
      }
    }

    load(initial);
  });
}

export function openRepoDialog(ctx) {
  const initial = ctx.state.recent?.[0]?.path || ctx.state.repo?.path || null;
  pickDirectory({ title: '打开 Git 仓库', initial, selectLabel: '打开此仓库' }).then((path) => {
    if (path) ctx.openRepoPath(path);
  });
}

export function browseField(initial, placeholder = '选择文件夹') {
  const input = h('input', {
    class: 'input',
    type: 'text',
    placeholder,
    value: initial || '',
    spellcheck: 'false',
  });
  const browse = h('button', {
    class: 'btn',
    html: `${icon('folderOpen', 14)}<span>浏览…</span>`,
  });
  const wrap = h('div', { class: 'input-with-button' }, input, browse);
  browse.addEventListener('click', async () => {
    const picked = await pickDirectory({ initial: input.value || initial });
    if (picked) {
      input.value = picked;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  return { wrap, input };
}

export function cloneDialog(ctx) {
  const url = h('input', {
    class: 'input',
    type: 'text',
    placeholder: 'https://github.com/user/repo.git 或 git@github.com:user/repo.git',
    spellcheck: 'false',
  });
  const destField = browseField('', '克隆到哪个文件夹');
  const body = h('div', { class: 'dialog-form' },
    h('p', { class: 'dialog-detail' }, '克隆完成后会自动打开仓库。大型仓库可能需要几分钟。'),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, '仓库地址'), url),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, '本地目录'), destField.wrap));
  const cancel = h('button', { class: 'btn' }, '取消');
  const clone = h('button', { class: 'btn primary', disabled: true }, '克隆');
  const modal = openModal({ title: '克隆远程仓库', body, footer: [cancel, clone], width: 620 });
  const syncState = () => {
    clone.disabled = !url.value.trim() || !destField.input.value.trim();
  };
  url.addEventListener('input', syncState);
  destField.input.addEventListener('input', syncState);
  cancel.addEventListener('click', () => modal.close());
  clone.addEventListener('click', () => {
    const u = url.value.trim();
    const d = destField.input.value.trim();
    if (!u || !d) {
      if (!u) url.focus();
      else destField.input.focus();
      return;
    }
    modal.close();
    ctx.cloneRepo(u, d);
  });
  url.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') destField.input.focus();
  });
  setTimeout(() => url.focus(), 40);
}

export function initDialog(ctx) {
  const destField = browseField('', '选择已有项目文件夹（可以非空）');
  const gitignore = h('input', { type: 'checkbox', checked: true });
  const body = h('div', { class: 'dialog-form' },
    h('p', { class: 'dialog-detail' },
      '选择一个已有项目文件夹（可以包含文件），GitViewer 会执行 git init 并创建 main 分支。'),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, '项目文件夹'), destField.wrap),
    h('label', { class: 'field checkbox-field' },
      gitignore,
      h('span', { class: 'field-label' }, '创建推荐 .gitignore')),
    h('p', { class: 'field-help init-help' },
      '推荐忽略 .idea、build、node_modules、dist、日志等文件。如果项目中已有 .gitignore，则不会覆盖。'),
    h('p', { class: 'field-help init-help' },
      '初始化后，现有文件会显示为“未跟踪”。请检查 .gitignore，确认要纳入版本管理的文件，再完成第一次提交。'));
  const cancel = h('button', { class: 'btn' }, '取消');
  const create = h('button', { class: 'btn primary', disabled: true }, '初始化仓库');
  const modal = openModal({ title: '初始化 Git 仓库', body, footer: [cancel, create], width: 620 });
  destField.input.addEventListener('input', () => {
    create.disabled = !destField.input.value.trim();
  });
  cancel.addEventListener('click', () => modal.close());
  create.addEventListener('click', () => {
    const d = destField.input.value.trim();
    if (!d) return;
    modal.close();
    ctx.initRepo(d, gitignore.checked);
  });
}

export function addRemoteDialog(ctx) {
  formDialog({
    title: '添加远程仓库',
    fields: [
      { name: 'name', label: '远程名称', value: 'origin', required: true },
      { name: 'url', label: '远程地址', placeholder: 'https://… 或 git@…', required: true },
    ],
    submitText: '添加远程',
  }).then((data) => {
    if (data) ctx.addRemote(data.name, data.url);
  });
}

export function createBranchDialog(ctx, startName) {
  const refs = ctx.state.snapshot?.refs || [];
  const options = [{ value: 'HEAD', label: '当前 HEAD' }];
  for (const ref of refs) {
    if (ref.type === 'branch' || ref.type === 'tag') {
      options.push({ value: ref.fullName, label: `${ref.type === 'tag' ? '标签' : '分支'}：${ref.name}` });
    }
  }
  formDialog({
    title: '新建分支',
    fields: [
      { name: 'name', label: '分支名称', placeholder: '例如 feature/login', required: true },
      { name: 'start', label: '起点', type: 'select', options, value: startName || 'HEAD' },
      { name: 'checkout', label: '创建后立即检出', type: 'checkbox', value: true },
    ],
    submitText: '创建分支',
  }).then((data) => {
    if (data) ctx.createBranch(data.name, data.start, data.checkout);
  });
}

export function mergeRefPicker(ctx) {
  const refs = ctx.state.snapshot?.refs || [];
  const current = ctx.state.snapshot?.head?.branch;
  const options = [];
  for (const ref of refs) {
    if (ref.type === 'branch' && ref.name !== current) options.push({ value: ref.name, label: `分支：${ref.name}` });
    if (ref.type === 'remote') options.push({ value: ref.name, label: `远程：${ref.name}` });
    if (ref.type === 'tag') options.push({ value: ref.name, label: `标签：${ref.name}` });
  }
  if (!options.length) {
    ctx.notify('没有可合并的分支', 'warn');
    return;
  }
  formDialog({
    title: '合并到当前分支',
    description: `将选定的分支合并到 ${current || '当前 HEAD'}。`,
    fields: [{ name: 'name', label: '要合并的分支', type: 'select', options, value: options[0].value }],
    submitText: '合并',
  }).then((data) => {
    if (data) ctx.mergeBranch({ name: data.name, type: 'branch' });
  });
}

export function browseForRepo(ctx, initial) {
  pickDirectory({ title: '选择仓库文件夹', initial, selectLabel: '选择' }).then((path) => {
    if (path) ctx.openRepoPath(path);
  });
}
