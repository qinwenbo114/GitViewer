import { h, emptyState, loadingState, iconEl, contextMenu, copyText, toast } from '../dom.js';
import { icon } from '../icons.js';
import { fmtCommitDate, fmtFullDate, fmtRelative, commitUrl } from '../format.js';
import { statusBadge, filePathEl, diffStatsEl, refsEl, avatarEl } from './filelist.js';

function actionButton(iconName, title, onClick) {
  return h('button', {
    class: 'icon-btn sm',
    title,
    html: icon(iconName, 14),
    onclick: (event) => { event.stopPropagation(); onClick(event); },
  });
}

export function renderCommitDetails(ctx, { details, loading, selectedSha }) {
  const root = h('div', { class: 'details-inner' });
  if (!selectedSha) {
    root.append(emptyState({
      iconName: 'commit',
      title: '选择一个提交',
      description: '在左侧提交列表中选择提交，查看作者、提交信息与更改的文件。',
      compact: true,
    }));
    return root;
  }
  if (loading || !details) {
    root.append(loadingState('正在读取提交详情…'));
    return root;
  }
  if (details.error) {
    root.append(emptyState({ iconName: 'alert', title: '无法读取提交', description: details.error }));
    return root;
  }

  const snap = ctx.state;
  const head = h('div', { class: 'details-head' },
    h('span', { class: 'details-kind' }, h('span', { html: icon('commit', 13) }), 'COMMIT'),
    h('span', { class: 'mono details-hash' }, details.short),
    h('button', {
      class: 'icon-btn sm',
      title: '复制完整哈希',
      html: icon('copy', 13),
      onclick: async () => {
        await copyText(details.hash);
        toast('已复制提交哈希', 'success');
      },
    }),
    h('div', { class: 'spacer' }),
    actionButton('more', '更多操作', (event) => ctx.commitMenu(details.hash, event)),
  );
  root.append(head);

  root.append(h('div', { class: 'details-subject' }, details.subject || '(无提交信息)'));

  if (details.refs?.length) {
    const refs = refsEl(details.refs, { limit: 8, onRefClick: (ref) => ctx.onRefClick(ref) });
    if (refs) root.append(h('div', { class: 'details-refs' }, refs));
  }

  const meta = h('div', { class: 'meta-grid' });
  const author = h('div', { class: 'meta-author' },
    avatarEl(details.author.name, 30),
    h('div', { class: 'meta-author-text' },
      h('div', { class: 'meta-name' }, details.author.name || '未知作者'),
      h('div', { class: 'meta-mail' }, details.author.email || '')));
  meta.append(author);
  meta.append(h('div', { class: 'meta-row' },
    h('span', { class: 'meta-label' }, '作者时间'),
    h('span', { title: fmtFullDate(details.author.time) }, fmtCommitDate(details.author.time))));
  if (details.committer && (details.committer.name !== details.author.name || details.committer.time !== details.author.time)) {
    meta.append(h('div', { class: 'meta-row' },
      h('span', { class: 'meta-label' }, '提交者'),
      h('span', { title: fmtFullDate(details.committer.time) }, `${details.committer.name} · ${fmtCommitDate(details.committer.time)}`)));
  }
  meta.append(h('div', { class: 'meta-row' },
    h('span', { class: 'meta-label' }, '父提交'),
    h('span', { class: 'parent-links' },
      details.parents.length
        ? details.parents.map((sha) => h('button', {
          class: 'link-btn mono',
          title: sha,
          onclick: () => ctx.selectCommit(sha),
        }, sha.slice(0, 8)))
        : h('span', { class: 'muted' }, '根提交'))));
  root.append(meta);

  if (details.body) {
    root.append(h('pre', { class: 'details-body' }, details.body));
  }

  const filesHead = h('div', { class: 'files-head' },
    h('span', { class: 'files-title' }, `更改的文件 `, h('span', { class: 'count-pill' }, details.files.length)),
    h('span', { class: 'files-stats' },
      h('span', { class: 'stat-add' }, `+${details.stats.additions}`),
      h('span', { class: 'stat-del' }, `−${details.stats.deletions}`)),
  );
  root.append(filesHead);

  if (!details.files.length) {
    root.append(h('div', { class: 'details-no-files' }, '此提交没有文件变更。'));
    return root;
  }

  const list = h('div', { class: 'commit-file-list' });
  for (const file of details.files) {
    const row = h('div', {
      class: 'file-row commit-file',
      tabindex: '0',
      onclick: () => ctx.openDiff({ kind: 'commit', sha: details.hash, path: file.path, file }),
      oncontextmenu: (event) => {
        event.preventDefault();
        contextMenu(event, [
          { label: '查看差异', icon: 'eye', onClick: () => ctx.openDiff({ kind: 'commit', sha: details.hash, path: file.path, file }) },
          { label: '文件历史', icon: 'history', onClick: () => ctx.showFileHistory(file.path) },
          { label: '查看 Blame', icon: 'blame', onClick: () => ctx.showBlame({ path: file.path, rev: details.hash }) },
          { separator: true },
          { label: '复制文件路径', icon: 'copy', onClick: async () => { await copyText(file.path); toast('已复制路径', 'success'); } },
        ]);
      },
    });
    row.append(
      statusBadge(file.code, true),
      filePathEl(file.path, file.origPath),
      diffStatsEl(file.additions, file.deletions, file.binary),
      h('div', { class: 'row-actions' },
        actionButton('eye', '查看差异', () => ctx.openDiff({ kind: 'commit', sha: details.hash, path: file.path, file })),
        actionButton('history', '文件历史', () => ctx.showFileHistory(file.path)),
        actionButton('blame', 'Blame', () => ctx.showBlame({ path: file.path, rev: details.hash }))),
    );
    list.append(row);
  }
  root.append(list);

  const remote = snap.snapshot?.remotes?.[0]?.fetchUrl;
  const url = commitUrl(remote, details.hash);
  if (url) {
    root.append(h('div', { class: 'details-footer' },
      h('a', { class: 'link-btn', href: url, target: '_blank', rel: 'noreferrer', html: `${icon('external', 13)}<span>在远程仓库中查看</span>` })));
  }

  return root;
}
