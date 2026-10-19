export const state = {
  booted: false,
  view: 'log',
  repo: null,
  snapshot: null,
  settings: {
    theme: 'dark',
    diffMode: 'split',
    pullMode: 'merge',
    confirmDestructive: true,
    fetchOnOpen: false,
    graphCompact: false,
    commitSignoff: false,
  },
  recent: [],
  demo: null,
  log: {
    commits: [],
    limit: 250,
    rev: 'HEAD',
    grep: '',
    path: null,
    loading: false,
    truncated: false,
    scrollTop: 0,
    selectedSha: null,
    error: null,
  },
  details: null,
  detailsLoading: false,
  changes: {
    selectedKey: null,
    diff: null,
    diffLoading: false,
    diffError: null,
    conflict: null,
    conflictMode: 'working',
    message: '',
    amend: false,
    includeUntracked: false,
    checked: new Set(),
    collapsed: new Set(),
    scrollTop: 0,
    diffMode: null,
  },
  branches: { query: '', tab: 'all' },
  stashes: { selectedRef: null, diff: null, loading: false },
  tags: { query: '' },
  console: { items: [], filter: '', expanded: new Set() },
  repoLoading: false,
  viewError: null,
};

let traceSeq = 0;

export function addTrace(entries) {
  if (!Array.isArray(entries)) return;
  for (const entry of entries) {
    state.console.items.push({
      ...entry,
      id: ++traceSeq,
      at: Date.now(),
    });
  }
  if (state.console.items.length > 400) {
    state.console.items.splice(0, state.console.items.length - 400);
  }
}

export function repoPath() {
  return state.repo?.path || null;
}

export function currentBranch() {
  return state.snapshot?.head?.branch || null;
}

export function isDirty() {
  return (state.snapshot?.status?.counts?.total || 0) > 0;
}

export function resetLog(keepFilter = false) {
  state.log.commits = [];
  state.log.selectedSha = null;
  state.details = null;
  state.log.scrollTop = 0;
  state.log.limit = 250;
  if (!keepFilter) {
    state.log.rev = 'HEAD';
    state.log.grep = '';
    state.log.path = null;
  }
}

export function resetRepoState() {
  state.repo = null;
  state.snapshot = null;
  state.log.commits = [];
  state.log.selectedSha = null;
  state.details = null;
  state.changes.selectedKey = null;
  state.changes.diff = null;
  state.changes.diffError = null;
  state.changes.conflict = null;
  state.changes.message = '';
  state.changes.checked = new Set();
  state.stashes = { selectedRef: null, diff: null, loading: false };
  state.branches.query = '';
  state.tags.query = '';
  state.repoLoading = false;
}
