import { h, emptyState } from '../dom.js';
import { logo, icon } from '../icons.js';
import { fmtRelative } from '../format.js';

export function renderHomeView(ctx) {
  const state = ctx.state;
  const root = h('div', { class: 'home-view' });
  const hero = h('div', { class: 'home-hero' },
    h('div', { class: 'home-logo', html: logo(64) }),
    h('h1', { class: 'home-title' }, 'GitViewer'),
    h('p', { class: 'home-subtitle' }, '像 Android Studio 一样直观地查看提交、管理变更与分支。'),
    h('div', { class: 'home-actions' },
      h('button', {
        class: 'btn primary large',
        html: `${icon('folderOpen', 16)}<span>打开仓库</span>`,
        onclick: () => ctx.openRepoDialog(),
      }),
      h('button', {
        class: 'btn large',
        html: `${icon('download', 16)}<span>克隆仓库</span>`,
        onclick: () => ctx.cloneDialog(),
      }),
      h('button', {
        class: 'btn large',
        html: `${icon('plus', 16)}<span>初始化仓库</span>`,
        onclick: () => ctx.initDialog(),
      })));
  root.append(hero);

  if (state.demo?.exists) {
    root.append(h('div', { class: 'home-demo' },
      h('span', { class: 'demo-badge', html: icon('sparkle', 14) }),
      h('span', {}, '第一次使用？打开内置示例仓库了解提交图、分支和贮藏。'),
      h('button', {
        class: 'btn small',
        html: `${icon('play', 12)}<span>打开示例仓库</span>`,
        onclick: () => ctx.openRepoPath(state.demo.path),
      })));
  }

  const recents = state.recent || [];
  const recentSection = h('section', { class: 'home-recent' },
    h('div', { class: 'home-section-head' },
      h('span', { html: icon('history', 15) }),
      h('span', {}, '最近打开的仓库'),
      h('span', { class: 'count-pill' }, recents.length)));
  if (!recents.length) {
    recentSection.append(h('div', { class: 'home-empty' }, '还没有打开过仓库。选择一个本地仓库，或克隆远程仓库开始。'));
  } else {
    const list = h('div', { class: 'recent-list' });
    for (const repo of recents) {
      const row = h('div', {
        class: `recent-item ${repo.exists ? '' : 'missing'}`,
        onclick: () => { if (repo.exists) ctx.openRepoPath(repo.path); },
        oncontextmenu: (event) => {
          event.preventDefault();
          ctx.recentMenu(repo, event);
        },
      },
      h('span', { class: 'recent-icon', html: icon(repo.exists ? 'folder' : 'alert', 20) }),
      h('div', { class: 'recent-main' },
        h('div', { class: 'recent-name' }, repo.name || repo.path),
        h('div', { class: 'recent-path' }, repo.path)),
      repo.exists
        ? h('span', { class: 'recent-time' }, fmtRelative(repo.lastOpened))
        : h('span', { class: 'warn-pill' }, '路径不存在'),
      h('button', {
        class: 'icon-btn sm',
        title: '从列表中移除',
        html: icon('x', 13),
        onclick: (event) => { event.stopPropagation(); ctx.removeRecent(repo); },
      }));
      list.append(row);
    }
    recentSection.append(list);
  }
  root.append(recentSection);

  root.append(h('div', { class: 'home-footer' },
    h('span', {}, '提示：按 '),
    h('kbd', {}, 'F5'),
    h('span', {}, ' 刷新，'),
    h('kbd', {}, 'Ctrl+F'),
    h('span', {}, ' 搜索提交，'),
    h('kbd', {}, 'Ctrl+Enter'),
    h('span', {}, ' 提交更改。')));
  return root;
}
