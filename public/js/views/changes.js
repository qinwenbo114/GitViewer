import {
  h, emptyState, loadingState, contextMenu, copyText, toast, button,
} from '../dom.js';
import { icon } from '../icons.js';
import { fmtRelative } from '../format.js';
import { statusBadge, filePathEl, diffStatsEl, avatarEl } from '../components/filelist.js';
import { renderDiff } from '../components/diff.js';
import { renderConflictView } from '../components/conflict.js';

const DEFAULT_LEFT_WIDTH = 450;
const GROUPS = [
  { key: 'staged', title: '已暂存', icon: 'check', hint: '这些更改将包含在下一次提交中' },
  { key: 'conflicted', title: '冲突', icon: 'alert', hint: '解决冲突后才能提交' },
  { key: 'unstaged', title: '未暂存', icon: 'edit', hint: '工作区中的修改，尚未加入暂存区' },
  { key: 'untracked', title: '未跟踪', icon: 'file', hint: '新文件，尚未被 Git 跟踪' },
];

function leftWidth() {
  const stored = Number(localStorage.getItem('gitviewer.changesWidth'));
  return Number.isFinite(stored) && stored >= 360 ? stored : DEFAULT_LEFT_WIDTH;
}

export function fileKey(file) {
  return `${file.group}:${file.path}`;
}

function groupFiles(files, group) {
  return files.filter((f) => f.group === group).sort((a, b) => a.path.localeCompare(b.path));
}

function selectedFile(state) {
  const files = state.snapshot?.status?.files || [];
  if (!state.changes.selectedKey) return null;
  return files.find((f) => fileKey(f) === state.changes.selectedKey) || null;
}

function diffSpecFor(file) {
  if (!file) return null;
  if (file.group === 'staged') return { kind: 'staged', path: file.path, file };
  return { kind: 'working', path: file.path, untracked: file.group === 'untracked', file };
}

function commitStats(checkedFiles) {
  return checkedFiles.reduce((acc, f) => ({
    additions: acc.additions + (f.additions || 0),
    deletions: acc.deletions + (f.deletions || 0),
  }), { additions: 0, deletions: 0 });
}

function checkedFilesOf(state) {
  const files = state.snapshot?.status?.files || [];
  return files.filter((f) => state.changes.checked.has(fileKey(f)));
}

function renderFileRow(ctx, file, state) {
  const key = fileKey(file);
  const checked = state.changes.checked.has(key);
  const isSelected = state.changes.selectedKey === key;
  const row = h('div', {
    class: `file-row change-row ${isSelected ? 'selected' : ''} ${file.group === 'conflicted' ? 'conflicted' : ''}`,
    tabindex: '0',
    onclick: () => ctx.selectChangeFile(file),
    oncontextmenu: (event) => changeFileMenu(ctx, file, event),
    onkeydown: (event) => {
      if (event.key === 'Enter') ctx.selectChangeFile(file);
    },
  });
  const checkbox = h('input', {
    type: 'checkbox',
    class: 'row-check',
    checked,
    title: '选中以便提交时暂存',
    onclick: (event) => event.stopPropagation(),
    onchange: (event) => {
      if (event.target.checked) state.changes.checked.add(key);
      else state.changes.checked.delete(key);
      ctx.updateCommitBar();
    },
  });
  const actionIcon = file.group === 'conflicted' ? 'check' : file.group === 'staged' ? 'minus' : 'plus';
  const actionTitle = file.group === 'conflicted' ? '标记为已解决' : file.group === 'staged' ? '取消暂存' : '暂存文件';
  row.append(
    checkbox,
    statusBadge(file.code, true),
    filePathEl(file.path, file.origPath),
    diffStatsEl(file.additions, file.deletions, file.binary),
    h('div', { class: 'row-actions' },
      h('button', {
        class: 'icon-btn sm',
        title: actionTitle,
        html: icon(actionIcon, 13),
        onclick: (event) => {
          event.stopPropagation();
          if (file.group === 'conflicted') ctx.markResolved([file.path]);
          else if (file.group === 'staged') ctx.unstageFiles([file.path]);
          else ctx.stageFiles([file.path]);
        },
      }),
      file.group === 'conflicted'
        ? h('button', {
          class: 'icon-btn sm',
          title: '解决冲突',
          html: icon('merge', 13),
          onclick: (event) => { event.stopPropagation(); acceptMenu(ctx, file, event); },
        })
        : h('button', {
          class: 'icon-btn sm',
          title: '回滚更改',
          html: icon('undo', 13),
          onclick: (event) => { event.stopPropagation(); ctx.discardFiles([file]); },
        }),
      h('button', {
        class: 'icon-btn sm',
        title: '更多',
        html: icon('more', 13),
        onclick: (event) => { event.stopPropagation(); changeFileMenu(ctx, file, event); },
      })),
  );
  return row;
}

function acceptMenu(ctx, file, event) {
  contextMenu(event, [
    { label: '使用我的版本（ours）', icon: 'check', onClick: () => ctx.acceptConflict(file, 'ours') },
    { label: '使用对方版本（theirs）', icon: 'download', onClick: () => ctx.acceptConflict(file, 'theirs') },
    { separator: true },
    { label: '标记为已解决', icon: 'check', onClick: () => ctx.markResolved([file.path]) },
  ]);
}

function changeFileMenu(ctx, file, event) {
  const items = [
    { label: '查看差异', icon: 'eye', onClick: () => ctx.selectChangeFile(file) },
    { label: file.group === 'staged' ? '取消暂存' : '暂存文件', icon: file.group === 'staged' ? 'minus' : 'plus', onClick: () => {
      if (file.group === 'staged') ctx.unstageFiles([file.path]);
      else ctx.stageFiles([file.path]);
    } },
  ];
  if (file.group === 'conflicted') {
    items.push(
      { separator: true },
      { label: '使用我的版本（ours）', icon: 'check', onClick: () => ctx.acceptConflict(file, 'ours') },
      { label: '使用对方版本（theirs）', icon: 'download', onClick: () => ctx.acceptConflict(file, 'theirs') },
      { label: '标记为已解决', icon: 'check', onClick: () => ctx.markResolved([file.path]) },
    );
  } else {
    items.push({ label: '回滚更改…', icon: 'undo', danger: true, onClick: () => ctx.discardFiles([file]) });
  }
  items.push(
    { separator: true },
    { label: '文件历史', icon: 'history', onClick: () => ctx.showFileHistory(file.path) },
    { label: '查看 Blame', icon: 'blame', onClick: () => ctx.showBlame({ path: file.path, rev: 'HEAD' }) },
    { separator: true },
    { label: '添加到 .gitignore', icon: 'eye', onClick: () => ctx.ignorePath(file.path), disabled: file.group === 'staged' },
    { label: '在资源管理器中显示', icon: 'folderOpen', onClick: () => ctx.revealPath(file.path) },
    { label: '复制文件路径', icon: 'copy', onClick: async () => { await copyText(file.path); toast('已复制路径', 'success'); } },
  );
  contextMenu(event, items);
}

function commitBox(ctx, state) {
  const snapshot = state.snapshot;
  const counts = snapshot.status.counts;
  const checked = checkedFilesOf(state);
  const staged = groupFiles(snapshot.status.files, 'staged');
  const hasRemote = (snapshot.remotes || []).length > 0;
  const message = h('textarea', {
    class: 'commit-message',
    id: 'commit-message',
    rows: 3,
    placeholder: '提交信息（Ctrl+Enter 提交）',
    value: state.changes.message,
    oninput: (event) => { state.changes.message = event.target.value; updateBar(); },
    onkeydown: (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        ctx.commitChanges(false);
      }
    },
  });

  const barInfo = h('div', { class: 'commit-bar-info' });
  const commitBtn = h('button', {
    class: 'btn primary commit-btn',
    html: `${icon('check', 15)}<span>提交</span>`,
    onclick: () => ctx.commitChanges(false),
  });
  const commitPushBtn = h('button', {
    class: 'btn commit-btn',
    title: hasRemote ? '提交并推送到远程' : '仓库没有配置远程',
    disabled: !hasRemote,
    html: `${icon('push', 14)}<span>提交并推送</span>`,
    onclick: () => ctx.commitChanges(true),
  });
  const amend = h('input', {
    type: 'checkbox',
    id: 'commit-amend',
    checked: state.changes.amend,
    onchange: (event) => {
      state.changes.amend = event.target.checked;
      if (event.target.checked) ctx.prefillAmendMessage();
      updateBar();
    },
  });
  function updateBar() {
    const selected = checkedFilesOf(state);
    const stagedCount = groupFiles(state.snapshot.status.files, 'staged').length;
    const selectedStaged = selected.filter((f) => f.group === 'staged').length;
    const stats = commitStats(selected);
    const unselectedStaged = Math.max(0, stagedCount - selectedStaged);
    const conflicts = state.snapshot.status.counts.conflicted || 0;
    const merging = !!state.snapshot.operation?.merge;
    const canCommit = !conflicts && (
      (merging && state.changes.message.trim())
      || state.changes.amend
      || (state.changes.message.trim() && (selected.length || stagedCount))
    );
    commitBtn.disabled = !canCommit || ctx.isBusy();
    commitPushBtn.disabled = !canCommit || !hasRemote || ctx.isBusy();
    const parts = [];
    if (conflicts) {
      parts.push(h('span', { class: 'warn-text' }, `还有 ${conflicts} 个冲突未解决，解决后才能提交`));
    }
    if (stagedCount) parts.push(h('span', { class: 'staged-pill' }, `${stagedCount} 个已暂存`));
    if (selected.length) parts.push(h('span', {}, `已选 ${selected.length} 个文件`));
    if (selected.length) {
      parts.push(h('span', { class: 'commit-stat-add' }, `+${stats.additions}`));
      parts.push(h('span', { class: 'commit-stat-del' }, `−${stats.deletions}`));
    }
    if (unselectedStaged > 0) {
      parts.push(h('span', { class: 'warn-text', title: '未勾选的已暂存文件仍会包含在提交中' }, `另有 ${unselectedStaged} 个已暂存文件未勾选`));
    }
    barInfo.replaceChildren(...parts);
  }

  const box = h('div', { class: 'commit-box', id: 'commit-box' },
    message,
    h('div', { class: 'commit-options' },
      h('label', { class: 'checkbox-inline', title: '修改上一次提交' }, amend, h('span', {}, '修正上次提交')),
      h('span', { class: 'spacer' }),
      h('span', { class: 'commit-author-mini' },
        avatarEl(snapshot.user?.name || '?', 18),
        h('span', {}, snapshot.user?.name || '未配置用户')),
    ),
    h('div', { class: 'commit-bar' }, barInfo, h('div', { class: 'commit-buttons' }, commitBtn, commitPushBtn)),
  );
  updateBar();
  // Expose for targeted refreshes after checkbox changes.
  box.__update = updateBar;
  return box;
}

function operationBanner(ctx, state) {
  const op = state.snapshot.operation || {};
  const conflicts = state.snapshot.status.counts.conflicted;
  let label = null;
  if (op.merge) label = '合并';
  else if (op.rebase) label = '变基';
  else if (op.cherryPick) label = '拣选';
  else if (op.revert) label = '还原';
  if (!label) return null;
    return h('div', { class: `operation-banner ${conflicts ? 'danger' : ''}` },
    h('span', { class: 'op-icon', html: icon(conflicts ? 'alert' : 'info', 16) }),
    h('div', { class: 'op-text' },
      h('div', { class: 'op-title' }, `${label}进行中${conflicts ? ` · ${conflicts} 个冲突` : ''}`),
      h('div', { class: 'op-desc' }, conflicts
        ? (op.merge ? '解决冲突并标记为已解决，然后填写提交信息完成合并。' : '解决冲突后标记为已解决，然后继续操作。')
        : op.merge
          ? '所有冲突已解决。填写提交信息并点击「提交」完成合并。'
          : '可以继续或中止当前操作。')),
    h('div', { class: 'op-actions' },
      op.merge
        ? (conflicts ? null : h('button', { class: 'btn small primary', onclick: () => ctx.commitChanges(false) }, '完成合并'))
        : conflicts
          ? h('button', { class: 'btn small', onclick: () => ctx.continueOperation() }, '继续')
          : h('button', { class: 'btn small primary', onclick: () => ctx.continueOperation() }, '继续'),
      h('button', { class: 'btn small', onclick: () => ctx.abortOperation() }, '中止')));
}

export function renderChangesView(ctx) {
  const state = ctx.state;
  const snapshot = state.snapshot;
  const files = snapshot.status.files;
  const counts = snapshot.status.counts;
  const root = h('div', { class: 'view changes-view' });

  const toolbar = h('div', { class: 'view-toolbar' },
    h('div', { class: 'toolbar-title' },
      h('span', { html: icon('edit', 15) }),
      h('span', {}, '本地变更'),
      counts.total ? h('span', { class: 'count-pill' }, counts.total) : null),
    h('div', { class: 'spacer' }),
    h('button', {
      class: 'btn small',
      title: '暂存所有未暂存的更改',
      disabled: !counts.unstaged && !counts.untracked,
      html: `${icon('plus', 13)}<span>全部暂存</span>`,
      onclick: () => ctx.stageAll(),
    }),
    h('button', {
      class: 'btn small',
      title: '取消暂存所有更改',
      disabled: !counts.staged,
      html: `${icon('minus', 13)}<span>全部取消暂存</span>`,
      onclick: () => ctx.unstageAll(),
    }),
    h('button', {
      class: 'icon-btn',
      title: '刷新 (F5)',
      html: icon('refresh', 15),
      onclick: () => ctx.refreshAll({ log: false }),
    }),
  );
  root.append(toolbar);

  const main = h('div', { class: 'changes-main' });
  main.style.gridTemplateColumns = `minmax(380px, ${leftWidth()}px) 5px minmax(0, 1fr)`;

  const left = h('div', { class: 'changes-left' });
  left.append(commitBox(ctx, state));
  const banner = operationBanner(ctx, state);
  if (banner) left.append(banner);

  const scroll = h('div', { class: 'changes-scroll', 'data-scroll': 'changes' });
  if (!files.length) {
    scroll.append(emptyState({
      iconName: 'check',
      title: '工作区是干净的',
      description: '没有需要提交的更改。修改文件后会自动出现在这里。',
      actions: [h('button', { class: 'btn', onclick: () => ctx.refreshAll({ log: false }) }, '刷新')],
    }));
  } else {
    for (const group of GROUPS) {
      const list = groupFiles(files, group.key);
      if (!list.length) continue;
      const collapsed = state.changes.collapsed.has(group.key);
      const allChecked = list.every((f) => state.changes.checked.has(fileKey(f)));
      const section = h('section', { class: `change-group group-${group.key}` });
      const head = h('div', { class: 'change-group-head' },
        h('button', {
          class: 'chevron-btn',
          title: collapsed ? '展开' : '折叠',
          html: icon(collapsed ? 'chevronRight' : 'chevronDown', 13),
          onclick: () => {
            if (collapsed) state.changes.collapsed.delete(group.key);
            else state.changes.collapsed.add(group.key);
            ctx.render();
          },
        }),
        h('input', {
          type: 'checkbox',
          class: 'row-check',
          title: '全选此分组',
          checked: allChecked,
          onchange: (event) => {
            for (const file of list) {
              if (event.target.checked) state.changes.checked.add(fileKey(file));
              else state.changes.checked.delete(fileKey(file));
            }
            ctx.render();
          },
        }),
        h('span', { class: 'group-icon', html: icon(group.icon, 13) }),
        h('span', { class: 'group-title' }, group.title),
        h('span', { class: 'count-pill' }, list.length),
        h('div', { class: 'spacer' }),
        group.key === 'staged'
          ? h('button', {
            class: 'icon-btn sm',
            title: '取消暂存此分组',
            html: icon('minus', 13),
            onclick: (event) => { event.stopPropagation(); ctx.unstageFiles(list.map((f) => f.path)); },
          })
          : group.key !== 'conflicted'
            ? h('button', {
              class: 'icon-btn sm',
              title: '暂存此分组',
              html: icon('plus', 13),
              onclick: (event) => { event.stopPropagation(); ctx.stageFiles(list.map((f) => f.path)); },
            })
            : null,
      );
      section.append(head);
      if (!collapsed) {
        const rows = h('div', { class: 'change-rows' });
        for (const file of list) rows.append(renderFileRow(ctx, file, state));
        section.append(rows);
      }
      scroll.append(section);
    }
  }
  left.append(scroll);
  main.append(left);

  const splitter = h('div', { class: 'splitter-col', title: '拖动调整文件列表宽度' });
  splitter.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    splitter.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = left.getBoundingClientRect().width;
    const onMove = (ev) => {
      const next = Math.max(360, Math.min(window.innerWidth - 480, startWidth + (ev.clientX - startX)));
      main.style.gridTemplateColumns = `minmax(380px, ${next}px) 5px minmax(0, 1fr)`;
    };
    const onUp = () => {
      splitter.removeEventListener('pointermove', onMove);
      splitter.removeEventListener('pointerup', onUp);
      const current = Math.round(left.getBoundingClientRect().width);
      localStorage.setItem('gitviewer.changesWidth', String(current));
    };
    splitter.addEventListener('pointermove', onMove);
    splitter.addEventListener('pointerup', onUp);
  });
  main.append(splitter);

  const diffPane = h('div', { class: 'change-diff-pane' });
  const file = selectedFile(state);
  if (!file) {
    diffPane.append(emptyState({
      iconName: 'eye',
      title: files.length ? '选择一个文件' : '没有可比较的更改',
      description: files.length ? '选择左侧文件查看具体差异。' : '修改文件后，这里会显示工作区与仓库版本的差异。',
      compact: true,
    }));
  } else {
    const spec = diffSpecFor(file);
    const header = h('div', { class: 'diff-pane-head' },
      statusBadge(file.code, true),
      filePathEl(file.path, file.origPath, { bold: true }),
      diffStatsEl(file.additions, file.deletions, file.binary),
      h('div', { class: 'spacer' }),
      file.group === 'staged'
        ? h('button', { class: 'btn small', html: `${icon('minus', 13)}<span>取消暂存</span>`, onclick: () => ctx.unstageFiles([file.path]) })
        : file.group === 'conflicted'
          ? null
          : h('button', { class: 'btn small', html: `${icon('plus', 13)}<span>暂存</span>`, onclick: () => ctx.stageFiles([file.path]) }),
      h('button', { class: 'icon-btn sm', title: '文件历史', html: icon('history', 14), onclick: () => ctx.showFileHistory(file.path) }),
      h('button', { class: 'icon-btn sm', title: 'Blame', html: icon('blame', 14), onclick: () => ctx.showBlame({ path: file.path, rev: 'HEAD' }) }),
      h('button', { class: 'icon-btn sm', title: '更多', html: icon('more', 14), onclick: (event) => changeFileMenu(ctx, file, event) }),
    );
    diffPane.append(header);
    if (file.group === 'conflicted') {
      diffPane.append(h('div', { class: 'conflict-bar' },
        h('span', { html: icon('alert', 14) }),
        h('span', {}, '此文件存在合并冲突'),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn small', onclick: () => ctx.acceptConflict(file, 'ours') }, '使用我的版本'),
        h('button', { class: 'btn small', onclick: () => ctx.acceptConflict(file, 'theirs') }, '使用对方版本'),
        h('button', { class: 'btn small primary', onclick: () => ctx.markResolved([file.path]) }, '标记为已解决')));
    }
    if (state.changes.diffLoading) {
      diffPane.append(loadingState('正在读取差异…'));
    } else if (state.changes.diffError) {
      diffPane.append(emptyState({ iconName: 'alert', title: '无法读取差异', description: state.changes.diffError, compact: true }));
    } else if (file.group === 'conflicted' && state.changes.conflict) {
      diffPane.append(renderConflictView(state.changes.conflict, state.changes.conflictMode, {
        onModeChange: (mode) => {
          state.changes.conflictMode = mode;
          ctx.render();
        },
      }));
    } else {
      const mode = state.changes.diffMode || state.settings.diffMode;
      const diffEl = renderDiff(state.changes.diff, mode, {
        onModeChange: (next) => {
          state.changes.diffMode = next;
          ctx.render();
        },
      });
      diffPane.append(diffEl);
    }
  }
  main.append(diffPane);
  root.append(main);
  return root;
}
