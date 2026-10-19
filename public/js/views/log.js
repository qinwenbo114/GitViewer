import {
  h, emptyState, loadingState, contextMenu, iconEl, copyText, toast,
} from '../dom.js';
import { icon } from '../icons.js';
import { fmtCommitDate, fmtFullDate } from '../format.js';
import { drawGraph, graphWidth, MIN_GRAPH_WIDTH } from '../components/graph.js';
import { renderCommitDetails } from '../components/details.js';
import { refsEl } from '../components/filelist.js';

const DEFAULT_DETAILS_WIDTH = 460;
let searchTimer = null;

function detailsWidth() {
  const stored = Number(localStorage.getItem('gitviewer.detailsWidth'));
  return Number.isFinite(stored) && stored >= 340 ? stored : DEFAULT_DETAILS_WIDTH;
}

function revOptions(state) {
  const refs = state.snapshot?.refs || [];
  const branches = refs.filter((r) => r.type === 'branch');
  const remotes = refs.filter((r) => r.type === 'remote');
  const tags = refs.filter((r) => r.type === 'tag');
  const current = state.snapshot?.head?.branch;
  const opts = [
    h('option', { value: 'HEAD', selected: state.log.rev === 'HEAD' }, current ? `当前分支（${current}）` : '当前 HEAD'),
    h('option', { value: 'ALL', selected: state.log.rev === 'ALL' }, '所有分支'),
  ];
  if (branches.length) {
    opts.push(h('optgroup', { label: '本地分支' },
      ...branches.map((r) => h('option', { value: r.fullName, selected: state.log.rev === r.fullName }, r.name))));
  }
  if (remotes.length) {
    opts.push(h('optgroup', { label: '远程分支' },
      ...remotes.map((r) => h('option', { value: r.fullName, selected: state.log.rev === r.fullName }, r.name))));
  }
  if (tags.length) {
    opts.push(h('optgroup', { label: '标签' },
      ...tags.map((r) => h('option', { value: r.fullName, selected: state.log.rev === r.fullName }, r.name))));
  }
  return opts;
}

function commitRow(ctx, commit, selected, graphW) {
  const row = h('div', {
    class: `commit-row ${selected ? 'selected' : ''}`,
    'data-sha': commit.hash,
    style: { '--graph-width': `${graphW}px` },
    title: `${commit.subject}\n${commit.author.name} · ${fmtFullDate(commit.author.time)}\n${commit.hash}`,
    onclick: () => ctx.selectCommit(commit.hash),
    oncontextmenu: (event) => ctx.commitMenu(commit.hash, event),
  });
  const subject = h('div', { class: 'commit-subject' },
    h('span', { class: 'commit-subject-text' }, commit.subject || '(无提交信息)'),
    refsEl(commit.refs, { limit: 4, onRefClick: (ref) => ctx.filterByRef(ref) }));
  row.append(
    subject,
    h('div', { class: 'commit-author', title: commit.author.email }, commit.author.name || ''),
    h('div', { class: 'commit-date', title: fmtFullDate(commit.author.time) }, fmtCommitDate(commit.author.time)),
    h('div', { class: 'commit-hash mono', title: commit.hash }, commit.short),
  );
  return row;
}

export function renderLogView(ctx) {
  const state = ctx.state;
  const log = state.log;
  const refs = state.snapshot?.refs || [];
  const root = h('div', { class: 'view log-view' });

  const search = h('input', {
    class: 'input search-input',
    id: 'log-search',
    type: 'search',
    placeholder: '搜索提交信息…',
    value: log.grep,
    autocomplete: 'off',
    oninput: (event) => {
      log.grep = event.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => ctx.loadLog(), 350);
    },
    onkeydown: (event) => {
      if (event.key === 'Enter') {
        clearTimeout(searchTimer);
        ctx.loadLog();
      }
    },
  });

  const revSelect = h('select', {
    class: 'input select compact',
    id: 'log-rev',
    title: '选择要查看的版本范围',
    onchange: (event) => {
      log.rev = event.target.value;
      ctx.loadLog();
    },
  }, ...revOptions(state));

  const toolbar = h('div', { class: 'view-toolbar log-toolbar' },
    h('div', { class: 'search-wrap' }, h('span', { class: 'search-icon', html: icon('search', 14) }), search),
    revSelect,
    log.path
      ? h('span', { class: 'filter-chip', title: log.path },
        h('span', { html: icon('file', 12) }),
        h('span', {}, log.path),
        h('button', {
          class: 'chip-close',
          title: '清除文件过滤',
          html: icon('x', 11),
          onclick: () => { log.path = null; ctx.loadLog(); },
        }))
      : null,
    h('div', { class: 'spacer' }),
    h('span', { class: 'toolbar-meta' }, log.loading ? '正在加载…' : `${log.commits.length} 个提交`),
    h('button', {
      class: 'icon-btn',
      title: '刷新日志 (F5)',
      html: icon('refresh', 15),
      onclick: () => ctx.refreshAll({ log: true }),
    }),
  );
  root.append(toolbar);

  const main = h('div', { class: 'log-main' });
  const width = detailsWidth();
  main.style.gridTemplateColumns = `minmax(0, 1fr) 5px ${width}px`;

  const pane = h('div', { class: 'commit-pane' });
  const rowHeight = state.settings.graphCompact ? 24 : 28;
  const flatGraph = Boolean(log.path || log.grep);
  const graphW = flatGraph ? 34 : (log.commits.length ? graphWidth(log.commits) : MIN_GRAPH_WIDTH);
  pane.style.setProperty('--row-height', `${rowHeight}px`);
  pane.style.setProperty('--graph-width', `${graphW}px`);
  const head = h('div', { class: 'commit-table-head' },
    h('div', { class: 'th subject' }, '提交'),
    h('div', { class: 'th author' }, '作者'),
    h('div', { class: 'th date' }, '日期'),
    h('div', { class: 'th hash' }, '哈希'));
  pane.append(head);

  const scroll = h('div', { class: 'commit-scroll', 'data-scroll': 'log', tabindex: '0' });
  const rows = h('div', { class: 'commit-rows' });

  if (log.loading && !log.commits.length) {
    rows.append(loadingState('正在读取提交历史…'));
  } else if (!log.commits.length) {
    rows.append(emptyState({
      iconName: 'history',
      title: log.grep || log.path ? '没有匹配的提交' : '还没有提交',
      description: log.grep || log.path
        ? '尝试调整搜索条件或清除文件过滤。'
        : '在「本地变更」中创建第一个提交。',
      actions: log.grep || log.path
        ? [h('button', {
          class: 'btn',
          onclick: () => {
            log.grep = '';
            log.path = null;
            ctx.loadLog();
          },
        }, '清除过滤')]
        : [h('button', { class: 'btn', onclick: () => ctx.setView('changes') }, '查看本地变更')],
    }));
  } else {
    rows.style.setProperty('--graph-width', `${graphW}px`);
    const selectedIndex = log.commits.findIndex((c) => c.hash === log.selectedSha);
    const canvas = h('canvas', { class: 'graph-canvas' });
    rows.append(canvas);
    log.commits.forEach((commit) => {
      rows.append(commitRow(ctx, commit, commit.hash === log.selectedSha, graphW));
    });
    if (log.truncated) {
      rows.append(h('div', { class: 'load-more-row' },
        h('button', {
          class: 'btn',
          html: `${icon('plus', 14)}<span>加载更多提交</span>`,
          onclick: () => { log.limit += 250; ctx.loadLog(); },
        })));
    }
    requestAnimationFrame(() => {
      if (!canvas.isConnected) return;
      drawGraph(canvas, log.commits, {
        rowHeight,
        selectedIndex,
        theme: state.settings.theme,
        width: graphW,
        flat: flatGraph,
      });
    });
  }
  pane.append(scroll);
  scroll.append(rows);
  main.append(pane);

  const splitter = h('div', { class: 'splitter-col', title: '拖动调整详情宽度' });
  splitter.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    splitter.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startDetails = detailsPane.getBoundingClientRect().width;
    const maxWidth = Math.min(820, window.innerWidth - 420);
    const onMove = (ev) => {
      const next = Math.max(340, Math.min(maxWidth, startDetails + (startX - ev.clientX)));
      main.style.gridTemplateColumns = `minmax(0, 1fr) 5px ${next}px`;
    };
    const onUp = () => {
      splitter.removeEventListener('pointermove', onMove);
      splitter.removeEventListener('pointerup', onUp);
      const current = parseInt(main.style.gridTemplateColumns.match(/(\d+)px$/)?.[1] || `${width}`, 10);
      localStorage.setItem('gitviewer.detailsWidth', String(current));
    };
    splitter.addEventListener('pointermove', onMove);
    splitter.addEventListener('pointerup', onUp);
  });
  main.append(splitter);

  const detailsPane = h('aside', { class: 'details-pane' });
  detailsPane.append(renderCommitDetails(ctx, {
    details: state.details,
    loading: state.detailsLoading,
    selectedSha: log.selectedSha,
  }));
  main.append(detailsPane);
  root.append(main);
  return root;
}
