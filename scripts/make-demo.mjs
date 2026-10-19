import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../server/git.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DEMO = path.join(ROOT, 'demo');
const AUTHOR = { name: '林小满', email: 'xiaoman@example.com' };

async function run(args, { cwd = DEMO, env = {}, allowFail = false } = {}) {
  const res = await git(args, {
    cwd,
    env: {
      GIT_AUTHOR_NAME: AUTHOR.name,
      GIT_AUTHOR_EMAIL: AUTHOR.email,
      GIT_COMMITTER_NAME: AUTHOR.name,
      GIT_COMMITTER_EMAIL: AUTHOR.email,
      ...env,
    },
  });
  if (res.code !== 0 && !allowFail) {
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr || res.stdout}`);
  }
  return res;
}

function write(rel, content) {
  const full = path.join(DEMO, ...rel.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function remove(rel) {
  fs.rmSync(path.join(DEMO, ...rel.split('/')), { force: true });
}

const DAY = 86_400_000;
const START = Date.now() - 42 * DAY;
let seq = 0;
function stamp(days, hours = 0) {
  seq++;
  const d = new Date(START + days * DAY + hours * 3_600_000 + seq * 60_000);
  return d.toISOString();
}

async function commit(message, date, files) {
  if (files) {
    for (const [rel, content] of Object.entries(files)) {
      if (content === null) remove(rel);
      else write(rel, content);
    }
  }
  await run(['add', '-A']);
  await run(['commit', '-m', message], {
    env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
}

async function main() {
  if (fs.existsSync(DEMO)) fs.rmSync(DEMO, { recursive: true, force: true });
  fs.mkdirSync(DEMO, { recursive: true });
  await run(['init', '-b', 'main']);
  await run(['config', 'user.name', AUTHOR.name]);
  await run(['config', 'user.email', AUTHOR.email]);
  await run(['config', 'core.autocrlf', 'false']);
  await run(['config', 'core.quotepath', 'false']);

  // ---------------------------------------------------------------- commit 1
  await commit('chore: 初始化 Aurora Notes 项目', stamp(0, 9), {
    '.gitignore': 'node_modules/\ndist/\n.DS_Store\n*.log\n',
    'README.md': `# Aurora Notes

一个专注于写作体验的本地 Markdown 笔记本。

## 特性

- 纯本地存储，笔记不会离开你的电脑
- 实时 Markdown 预览
- 全文搜索与标签
- 支持浅色 / 深色主题

## 开发

\`\`\`bash
npm install
npm run dev
\`\`\`

## 文档

- [架构说明](docs/ARCHITECTURE.md)
- [贡献指南](docs/CONTRIBUTING.md)
`,
    'package.json': JSON.stringify({
      name: 'aurora-notes',
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'vite build',
        test: 'vitest run',
        lint: 'eslint src',
      },
      devDependencies: {
        vite: '^5.4.0',
        vitest: '^2.0.0',
        eslint: '^9.0.0',
      },
    }, null, 2) + '\n',
    'docs/old-notes.md': `# 旧版笔记

早期版本的临时设计记录，后续内容已经迁移到 ARCHITECTURE.md。

- 编辑器采用 contenteditable
- 自动保存间隔 5 秒
- 没有实现撤销栈
`,
  });

  // ---------------------------------------------------------------- commit 2
  await commit('feat: 搭建应用外壳与侧边栏', stamp(3, 10), {
    'src/main.js': `import { createSidebar } from './ui/sidebar.js';
import { createEditor } from './ui/editor.js';
import { NotesStore } from './store/notes.js';

const store = new NotesStore();

export function bootstrap(root) {
  const layout = document.createElement('div');
  layout.className = 'app-shell';

  const sidebar = createSidebar({
    notes: store.list(),
    onSelect: (id) => openNote(id),
    onCreate: () => createNote(),
  });

  const editor = createEditor({ onChange: (note) => store.save(note) });

  layout.append(sidebar.el, editor.el);
  root.replaceChildren(layout);

  function openNote(id) {
    const note = store.get(id);
    if (!note) return;
    sidebar.setActive(id);
    editor.load(note);
  }

  function createNote() {
    const note = store.create({ title: '未命名笔记', body: '' });
    sidebar.refresh(store.list());
    openNote(note.id);
    editor.focus();
  }

  const first = store.list()[0];
  if (first) openNote(first.id);
  return { store, sidebar, editor };
}
`,
    'src/ui/sidebar.js': `export function createSidebar({ notes, onSelect, onCreate }) {
  const el = document.createElement('aside');
  el.className = 'sidebar';

  const header = document.createElement('header');
  header.className = 'sidebar-header';
  header.innerHTML = '<h1>Aurora Notes</h1>';

  const newButton = document.createElement('button');
  newButton.className = 'primary-button';
  newButton.textContent = '新建笔记';
  newButton.addEventListener('click', onCreate);
  header.append(newButton);

  const list = document.createElement('ul');
  list.className = 'note-list';

  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = '搜索笔记…';
  search.className = 'sidebar-search';

  el.append(header, search, list);

  let activeId = null;
  let collapsed = false;

  function render(items) {
    list.replaceChildren();
    for (const note of items) {
      const item = document.createElement('li');
      item.className = 'note-item' + (note.id === activeId ? ' active' : '');
      item.dataset.id = note.id;

      const title = document.createElement('span');
      title.className = 'note-title';
      title.textContent = note.title || '未命名笔记';

      const meta = document.createElement('span');
      meta.className = 'note-meta';
      meta.textContent = new Date(note.updatedAt).toLocaleDateString();

      item.append(title, meta);
      item.addEventListener('click', () => onSelect(note.id));
      list.append(item);
    }
  }

  function setActive(id) {
    activeId = id;
    for (const item of list.children) {
      item.classList.toggle('active', item.dataset.id === id);
    }
  }

  function refresh(items) {
    render(items);
  }

  function toggleCollapse() {
    collapsed = !collapsed;
    el.classList.toggle('collapsed', collapsed);
  }

  render(notes);

  return { el, refresh, setActive, toggleCollapse, search, get collapsed() { return collapsed; } };
}
`,
    'src/styles/theme.css': `:root {
  --bg: #f6f4ef;
  --surface: #ffffff;
  --text: #26231f;
  --muted: #7a746b;
  --accent: #db7c52;
  --border: #e6e1d8;
  --radius: 10px;
  --shadow: 0 8px 24px rgba(38, 35, 31, 0.08);
}

[data-theme='dark'] {
  --bg: #1b1a18;
  --surface: #24221f;
  --text: #ece8e1;
  --muted: #9a9389;
  --accent: #e08a5f;
  --border: #35322d;
  --shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
  background: var(--bg);
  color: var(--text);
}

.app-shell {
  display: grid;
  grid-template-columns: 280px 1fr;
  height: 100vh;
}
`,
  });

  // ---------------------------------------------------------------- commit 3
  await commit('feat: 添加 Markdown 编辑器', stamp(6, 14), {
    'src/ui/editor.js': `export function createEditor({ onChange }) {
  const el = document.createElement('main');
  el.className = 'editor';

  const title = document.createElement('input');
  title.className = 'editor-title';
  title.placeholder = '标题';

  const toolbar = document.createElement('div');
  toolbar.className = 'editor-toolbar';
  toolbar.innerHTML = \`
    <button data-command="bold" title="加粗">B</button>
    <button data-command="italic" title="斜体">I</button>
    <button data-command="code" title="行内代码">&lt;/&gt;</button>
    <span class="spacer"></span>
    <span class="save-state">已保存</span>
  \`;

  const body = document.createElement('textarea');
  body.className = 'editor-body';
  body.placeholder = '开始写作…';

  const preview = document.createElement('article');
  preview.className = 'editor-preview';

  el.append(title, toolbar, body, preview);

  let current = null;
  let timer = null;

  function scheduleSave() {
    clearTimeout(timer);
    const state = toolbar.querySelector('.save-state');
    state.textContent = '编辑中…';
    timer = setTimeout(() => {
      if (!current) return;
      current.title = title.value;
      current.body = body.value;
      current.updatedAt = Date.now();
      onChange({ ...current });
      state.textContent = '已保存';
    }, 500);
  }

  title.addEventListener('input', scheduleSave);
  body.addEventListener('input', scheduleSave);

  el.addEventListener('click', (event) => {
    const button = event.target.closest('[data-command]');
    if (!button) return;
    wrapSelection(body, button.dataset.command);
  });

  function load(note) {
    current = note;
    title.value = note.title || '';
    body.value = note.body || '';
  }

  function focus() {
    body.focus();
  }

  return { el, load, focus, get current() { return current; } };
}

function wrapSelection(textarea, command) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  const selected = value.slice(start, end);
  const markers = command === 'bold' ? ['**', '**'] : command === 'italic' ? ['_', '_'] : ['\`', '\`'];
  textarea.value = value.slice(0, start) + markers[0] + selected + markers[1] + value.slice(end);
  textarea.selectionStart = start + markers[0].length;
  textarea.selectionEnd = end + markers[0].length;
  textarea.focus();
}
`,
    'src/main.js': `import { createSidebar } from './ui/sidebar.js';
import { createEditor } from './ui/editor.js';
import { NotesStore } from './store/notes.js';

const store = new NotesStore();

export function bootstrap(root) {
  const layout = document.createElement('div');
  layout.className = 'app-shell';

  const sidebar = createSidebar({
    notes: store.list(),
    onSelect: (id) => openNote(id),
    onCreate: () => createNote(),
  });

  const editor = createEditor({
    onChange: (note) => {
      store.save(note);
      sidebar.refresh(store.list());
    },
  });

  layout.append(sidebar.el, editor.el);
  root.replaceChildren(layout);

  function openNote(id) {
    const note = store.get(id);
    if (!note) return;
    sidebar.setActive(id);
    editor.load(note);
  }

  function createNote() {
    const note = store.create({ title: '未命名笔记', body: '' });
    sidebar.refresh(store.list());
    openNote(note.id);
    editor.focus();
  }

  const first = store.list()[0];
  if (first) openNote(first.id);
  return { store, sidebar, editor };
}
`,
    'src/store/notes.js': `const STORAGE_KEY = 'aurora.notes.v1';

export class NotesStore {
  constructor() {
    this.notes = new Map();
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      for (const note of raw) this.notes.set(note.id, note);
    } catch {
      this.notes.clear();
    }
  }

  persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.notes.values()]));
  }

  list() {
    return [...this.notes.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id) {
    return this.notes.get(id) || null;
  }

  create(fields = {}) {
    const note = {
      id: crypto.randomUUID(),
      title: fields.title || '未命名笔记',
      body: fields.body || '',
      tags: fields.tags || [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.notes.set(note.id, note);
    this.persist();
    return note;
  }

  save(note) {
    this.notes.set(note.id, { ...note, updatedAt: Date.now() });
    this.persist();
  }

  remove(id) {
    this.notes.delete(id);
    this.persist();
  }
}
`,
  });

  // ---------------------------------------------------------------- commit 4
  await commit('fix: 修正侧边栏折叠状态丢失', stamp(9, 11), {
    'src/ui/sidebar.js': `export function createSidebar({ notes, onSelect, onCreate }) {
  const el = document.createElement('aside');
  el.className = 'sidebar';

  const header = document.createElement('header');
  header.className = 'sidebar-header';
  header.innerHTML = '<h1>Aurora Notes</h1>';

  const newButton = document.createElement('button');
  newButton.className = 'primary-button';
  newButton.textContent = '新建笔记';
  newButton.addEventListener('click', onCreate);
  header.append(newButton);

  const collapseButton = document.createElement('button');
  collapseButton.className = 'icon-button';
  collapseButton.title = '折叠侧边栏';
  collapseButton.textContent = '‹';
  collapseButton.addEventListener('click', toggleCollapse);
  header.append(collapseButton);

  const list = document.createElement('ul');
  list.className = 'note-list';

  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = '搜索笔记…';
  search.className = 'sidebar-search';

  el.append(header, search, list);

  let activeId = null;
  let collapsed = localStorage.getItem('aurora.sidebar.collapsed') === '1';

  function render(items) {
    list.replaceChildren();
    for (const note of items) {
      const item = document.createElement('li');
      item.className = 'note-item' + (note.id === activeId ? ' active' : '');
      item.dataset.id = note.id;

      const title = document.createElement('span');
      title.className = 'note-title';
      title.textContent = note.title || '未命名笔记';

      const meta = document.createElement('span');
      meta.className = 'note-meta';
      meta.textContent = new Date(note.updatedAt).toLocaleDateString();

      item.append(title, meta);
      item.addEventListener('click', () => onSelect(note.id));
      list.append(item);
    }
  }

  function setActive(id) {
    activeId = id;
    for (const item of list.children) {
      item.classList.toggle('active', item.dataset.id === id);
    }
  }

  function refresh(items) {
    render(items);
  }

  function toggleCollapse() {
    collapsed = !collapsed;
    el.classList.toggle('collapsed', collapsed);
    localStorage.setItem('aurora.sidebar.collapsed', collapsed ? '1' : '0');
  }

  el.classList.toggle('collapsed', collapsed);
  render(notes);

  return { el, refresh, setActive, toggleCollapse, search, get collapsed() { return collapsed; } };
}
`,
  });

  // --------------------------------------------------------- feature/search
  await run(['checkout', '-b', 'feature/search']);
  await commit('feat(search): 添加笔记全文搜索', stamp(12, 9), {
    'src/search/index.js': `/**
 * 轻量全文搜索：将笔记切成 2-gram 词元，按命中次数排序。
 */
const STOP_WORDS = new Set(['的', '了', '和', '是', '在', '我', '有']);

export function buildIndex(notes) {
  return notes.map((note) => ({
    id: note.id,
    title: note.title,
    haystack: (note.title + '\\n' + note.body).toLowerCase(),
  }));
}

export function tokenize(query) {
  return query
    .toLowerCase()
    .split(/\\s+/)
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token));
}

export function search(index, query, limit = 20) {
  const tokens = tokenize(query);
  if (!tokens.length) return [];

  const scored = [];
  for (const entry of index) {
    let score = 0;
    for (const token of tokens) {
      let from = 0;
      while (true) {
        const at = entry.haystack.indexOf(token, from);
        if (at === -1) break;
        score += 1;
        from = at + token.length;
      }
    }
    if (score > 0) scored.push({ id: entry.id, title: entry.title, score });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
`,
    'src/ui/sidebar.js': `import { buildIndex, search } from '../search/index.js';

export function createSidebar({ notes, onSelect, onCreate }) {
  const el = document.createElement('aside');
  el.className = 'sidebar';

  const header = document.createElement('header');
  header.className = 'sidebar-header';
  header.innerHTML = '<h1>Aurora Notes</h1>';

  const newButton = document.createElement('button');
  newButton.className = 'primary-button';
  newButton.textContent = '新建笔记';
  newButton.addEventListener('click', onCreate);
  header.append(newButton);

  const collapseButton = document.createElement('button');
  collapseButton.className = 'icon-button';
  collapseButton.title = '折叠侧边栏';
  collapseButton.textContent = '‹';
  collapseButton.addEventListener('click', toggleCollapse);
  header.append(collapseButton);

  const list = document.createElement('ul');
  list.className = 'note-list';

  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = '搜索笔记…';
  search.className = 'sidebar-search';

  el.append(header, search, list);

  let activeId = null;
  let collapsed = localStorage.getItem('aurora.sidebar.collapsed') === '1';
  let index = buildIndex(notes);

  function render(items) {
    list.replaceChildren();
    for (const note of items) {
      const item = document.createElement('li');
      item.className = 'note-item' + (note.id === activeId ? ' active' : '');
      item.dataset.id = note.id;

      const title = document.createElement('span');
      title.className = 'note-title';
      title.textContent = note.title || '未命名笔记';

      const meta = document.createElement('span');
      meta.className = 'note-meta';
      meta.textContent = new Date(note.updatedAt).toLocaleDateString();

      item.append(title, meta);
      item.addEventListener('click', () => onSelect(note.id));
      list.append(item);
    }
  }

  search.addEventListener('input', () => {
    const query = search.value.trim();
    if (!query) {
      render(notes);
      return;
    }
    const ids = new Set(search(index, query).map((hit) => hit.id));
    render(notes.filter((note) => ids.has(note.id)));
  });

  function setActive(id) {
    activeId = id;
    for (const item of list.children) {
      item.classList.toggle('active', item.dataset.id === id);
    }
  }

  function refresh(items) {
    notes = items;
    index = buildIndex(items);
    render(items);
  }

  function toggleCollapse() {
    collapsed = !collapsed;
    el.classList.toggle('collapsed', collapsed);
    localStorage.setItem('aurora.sidebar.collapsed', collapsed ? '1' : '0');
  }

  el.classList.toggle('collapsed', collapsed);
  render(notes);

  return { el, refresh, setActive, toggleCollapse, search, get collapsed() { return collapsed; } };
}
`,
  });
  await commit('test(search): 补充搜索索引单元测试', stamp(13, 15), {
    'tests/search.test.js': `import { describe, expect, it } from 'vitest';
import { buildIndex, search, tokenize } from '../src/search/index.js';

const notes = [
  { id: 'a', title: 'Markdown 语法', body: '标题、列表与代码块' },
  { id: 'b', title: '月度总结', body: '这个月完成了搜索功能' },
];

describe('search', () => {
  it('忽略常见停用词', () => {
    expect(tokenize('这个月的搜索')).toEqual(['这个月', '搜索']);
  });

  it('按命中次数排序', () => {
    const hits = search(buildIndex(notes), '搜索');
    expect(hits[0].id).toBe('b');
  });

  it('空查询返回空数组', () => {
    expect(search(buildIndex(notes), '   ')).toEqual([]);
  });
});
`,
  });

  // ------------------------------------------------------------ back to main
  await run(['checkout', 'main']);
  await commit('refactor: 抽取笔记存储层', stamp(16, 10), {
    'src/store/notes.js': `const STORAGE_KEY = 'aurora.notes.v1';

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

export class NotesStore {
  constructor() {
    this.notes = new Map();
    this.load();
  }

  load() {
    for (const note of readAll()) this.notes.set(note.id, note);
  }

  persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.notes.values()]));
  }

  list() {
    return [...this.notes.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id) {
    return this.notes.get(id) || null;
  }

  create(fields = {}) {
    const now = Date.now();
    const note = {
      id: crypto.randomUUID(),
      title: fields.title || '未命名笔记',
      body: fields.body || '',
      tags: fields.tags || [],
      createdAt: now,
      updatedAt: now,
    };
    this.notes.set(note.id, note);
    this.persist();
    return note;
  }

  save(note) {
    this.notes.set(note.id, { ...note, updatedAt: Date.now() });
    this.persist();
  }

  remove(id) {
    this.notes.delete(id);
    this.persist();
  }
}
`,
    'src/main.js': `import { createSidebar } from './ui/sidebar.js';
import { createEditor } from './ui/editor.js';
import { NotesStore } from './store/notes.js';

const store = new NotesStore();

export function bootstrap(root) {
  const layout = document.createElement('div');
  layout.className = 'app-shell';

  const sidebar = createSidebar({
    notes: store.list(),
    onSelect: (id) => openNote(id),
    onCreate: () => createNote(),
  });

  const editor = createEditor({
    onChange: (note) => {
      store.save(note);
      sidebar.refresh(store.list());
    },
  });

  layout.append(sidebar.el, editor.el);
  root.replaceChildren(layout);
  sidebar.el.classList.toggle('collapsed', store.getPreference('sidebarCollapsed'));

  function openNote(id) {
    const note = store.get(id);
    if (!note) return;
    sidebar.setActive(id);
    editor.load(note);
  }

  function createNote() {
    const note = store.create({ title: '未命名笔记', body: '' });
    sidebar.refresh(store.list());
    openNote(note.id);
    editor.focus();
  }

  const first = store.list()[0];
  if (first) openNote(first.id);
  return { store, sidebar, editor };
}
`,
  });

  // -------------------------------------------------------------- merge search
  await run(['merge', '--no-ff', '--no-edit', 'feature/search'], {
    env: {
      GIT_AUTHOR_DATE: stamp(18, 16),
      GIT_COMMITTER_DATE: stamp(18, 16),
    },
  });

  await commit('docs: 补充架构说明与贡献指南', stamp(20, 10), {
    'docs/ARCHITECTURE.md': `# 架构说明

Aurora Notes 由三层组成：

1. **存储层** \`src/store/notes.js\`
   使用 localStorage 持久化，提供笔记的增删改查。
2. **界面层** \`src/ui/\`
   侧边栏负责导航与搜索，编辑器负责 Markdown 输入。
3. **搜索层** \`src/search/\`
   启动时构建 2-gram 索引，查询时按命中次数排序。

## 数据流

\`\`\`
用户输入 -> Editor -> Store.save() -> localStorage
                    \\-> Sidebar.refresh()
\`\`\`

## 后续计划

- 增量同步（见 \`feature/sync\` 分支）
- 导出 PDF
- 标签自动补全
`,
    'docs/CONTRIBUTING.md': `# 贡献指南

感谢你对 Aurora Notes 的关注！

## 提交前

- 运行 \`npm test\`
- 运行 \`npm run lint\`
- 确保 UI 在浅色和深色主题下都正常

## 提交信息

采用 [Conventional Commits](https://www.conventionalcommits.org/)：

- \`feat:\` 新功能
- \`fix:\` 缺陷修复
- \`docs:\` 文档
- \`refactor:\` 重构
- \`test:\` 测试

## 分支策略

- \`main\` 始终保持可发布
- 功能分支从 \`main\` 切出，通过 Pull Request 合并
`,
    'README.md': `# Aurora Notes

一个专注于写作体验的本地 Markdown 笔记本。

## 特性

- 纯本地存储，笔记不会离开你的电脑
- 实时 Markdown 预览
- 全文搜索与标签
- 支持浅色 / 深色主题

## 开发

\`\`\`bash
npm install
npm run dev
\`\`\`

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| Ctrl + N | 新建笔记 |
| Ctrl + F | 搜索 |
| Ctrl + S | 立即保存 |

## 文档

- [架构说明](docs/ARCHITECTURE.md)
- [贡献指南](docs/CONTRIBUTING.md)
`,
  });

  await run(['tag', '-a', 'v1.0.0', '-m', 'Aurora Notes 1.0.0'], {
    env: {
      GIT_AUTHOR_DATE: stamp(21, 9),
      GIT_COMMITTER_DATE: stamp(21, 9),
    },
  });

  // --------------------------------------------------------------- feature/sync
  await run(['checkout', '-b', 'feature/sync']);
  await commit('feat(sync): 设计增量同步协议', stamp(24, 11), {
    'src/sync/protocol.js': `/**
 * 增量同步协议 v1
 * 每个变更块包含 baseVersion 与 patch，服务端按版本号顺序合并。
 */
export const PROTOCOL_VERSION = 1;

export function encodePatch(note, baseVersion) {
  return {
    protocol: PROTOCOL_VERSION,
    noteId: note.id,
    baseVersion,
    title: note.title,
    body: note.body,
    updatedAt: note.updatedAt,
  };
}

export function needsUpload(note, remoteVersion) {
  if (!remoteVersion) return true;
  return note.updatedAt > remoteVersion.updatedAt;
}

export function mergeRemote(local, remote) {
  if (!remote) return local;
  if (!local) return remote;
  return local.updatedAt >= remote.updatedAt ? local : remote;
}
`,
    'src/sync/queue.js': `const QUEUE_KEY = 'aurora.sync.queue';

export class UploadQueue {
  constructor() {
    this.items = new Map();
    this.load();
  }

  load() {
    try {
      for (const item of JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]')) {
        this.items.set(item.noteId, item);
      }
    } catch {
      this.items.clear();
    }
  }

  persist() {
    localStorage.setItem(QUEUE_KEY, JSON.stringify([...this.items.values()]));
  }

  enqueue(patch) {
    this.items.set(patch.noteId, patch);
    this.persist();
  }

  dequeue(noteId) {
    this.items.delete(noteId);
    this.persist();
  }

  pending() {
    return [...this.items.values()];
  }
}
`,
  });
  await commit('feat(sync): 添加上传队列与重试', stamp(26, 14), {
    'src/sync/worker.js': `import { UploadQueue } from './queue.js';
import { needsUpload } from './protocol.js';

const RETRY_DELAYS = [1000, 3000, 8000, 20000];

export function startSyncWorker({ store, transport }) {
  const queue = new UploadQueue();
  let stopped = false;

  async function flush() {
    for (const patch of queue.pending()) {
      if (stopped) return;
      if (!needsUpload(store.get(patch.noteId), patch.remote)) {
        queue.dequeue(patch.noteId);
        continue;
      }
      try {
        await transport.upload(patch);
        queue.dequeue(patch.noteId);
      } catch (error) {
        const attempt = (patch.attempts || 0) + 1;
        queue.enqueue({ ...patch, attempts: attempt });
        await sleep(RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]);
      }
    }
  }

  const timer = setInterval(flush, 15000);
  flush();

  return {
    flush,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    queue,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
`,
  });

  // --------------------------------------------------------------- back to main
  await run(['checkout', 'main']);
  await commit('fix: 修复编辑器自动保存竞态', stamp(29, 15), {
    'src/ui/editor.js': `export function createEditor({ onChange }) {
  const el = document.createElement('main');
  el.className = 'editor';

  const title = document.createElement('input');
  title.className = 'editor-title';
  title.placeholder = '标题';

  const toolbar = document.createElement('div');
  toolbar.className = 'editor-toolbar';
  toolbar.innerHTML = \`
    <button data-command="bold" title="加粗">B</button>
    <button data-command="italic" title="斜体">I</button>
    <button data-command="code" title="行内代码">&lt;/&gt;</button>
    <span class="spacer"></span>
    <span class="save-state">已保存</span>
  \`;

  const body = document.createElement('textarea');
  body.className = 'editor-body';
  body.placeholder = '开始写作…';

  const preview = document.createElement('article');
  preview.className = 'editor-preview';

  el.append(title, toolbar, body, preview);

  let current = null;
  let timer = null;
  let revision = 0;

  function scheduleSave() {
    clearTimeout(timer);
    const state = toolbar.querySelector('.save-state');
    state.textContent = '编辑中…';
    const ticket = ++revision;
    timer = setTimeout(() => {
      if (!current || ticket !== revision) return;
      current.title = title.value;
      current.body = body.value;
      current.updatedAt = Date.now();
      onChange({ ...current });
      state.textContent = '已保存';
    }, 500);
  }

  title.addEventListener('input', scheduleSave);
  body.addEventListener('input', scheduleSave);

  el.addEventListener('click', (event) => {
    const button = event.target.closest('[data-command]');
    if (!button) return;
    wrapSelection(body, button.dataset.command);
  });

  function load(note) {
    current = note;
    revision++;
    title.value = note.title || '';
    body.value = note.body || '';
  }

  function focus() {
    body.focus();
  }

  return { el, load, focus, get current() { return current; } };
}

function wrapSelection(textarea, command) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  const selected = value.slice(start, end);
  const markers = command === 'bold' ? ['**', '**'] : command === 'italic' ? ['_', '_'] : ['\`', '\`'];
  textarea.value = value.slice(0, start) + markers[0] + selected + markers[1] + value.slice(end);
  textarea.selectionStart = start + markers[0].length;
  textarea.selectionEnd = end + markers[0].length;
  textarea.focus();
}
`,
    'package.json': `{
  "name": "aurora-notes",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "lint": "eslint src"
  },
  "devDependencies": {
    "vite": "^5.4.10",
    "vitest": "^2.1.4",
    "eslint": "^9.13.0"
  }
}
`,
  });

  // --------------------------------------------------------------- release/1.0
  await run(['branch', 'release/1.0', 'HEAD~1']);

  // --------------------------------------------------------------- stash
  await commit('feat: 添加搜索面板样式', stamp(31, 10), {
    'src/styles/search.css': `.search-panel {
  border-top: 1px solid var(--border);
  padding: 12px 16px;
  background: var(--surface);
}

.search-panel input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px 10px;
  background: transparent;
  color: var(--text);
}

.search-result {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 6px;
  border-radius: 6px;
  cursor: pointer;
}

.search-result:hover {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
`,
    'src/ui/sidebar.js': `import { buildIndex, search } from '../search/index.js';

export function createSidebar({ notes, onSelect, onCreate }) {
  const el = document.createElement('aside');
  el.className = 'sidebar';

  const header = document.createElement('header');
  header.className = 'sidebar-header';
  header.innerHTML = '<h1>Aurora Notes</h1>';

  const newButton = document.createElement('button');
  newButton.className = 'primary-button';
  newButton.textContent = '新建笔记';
  newButton.addEventListener('click', onCreate);
  header.append(newButton);

  const collapseButton = document.createElement('button');
  collapseButton.className = 'icon-button';
  collapseButton.title = '折叠侧边栏';
  collapseButton.textContent = '‹';
  collapseButton.addEventListener('click', toggleCollapse);
  header.append(collapseButton);

  const list = document.createElement('ul');
  list.className = 'note-list';

  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = '搜索笔记…';
  search.className = 'sidebar-search';

  const resultCount = document.createElement('p');
  resultCount.className = 'search-count';
  resultCount.hidden = true;

  el.append(header, search, resultCount, list);

  let activeId = null;
  let collapsed = localStorage.getItem('aurora.sidebar.collapsed') === '1';
  let index = buildIndex(notes);

  function render(items) {
    list.replaceChildren();
    for (const note of items) {
      const item = document.createElement('li');
      item.className = 'note-item' + (note.id === activeId ? ' active' : '');
      item.dataset.id = note.id;

      const title = document.createElement('span');
      title.className = 'note-title';
      title.textContent = note.title || '未命名笔记';

      const meta = document.createElement('span');
      meta.className = 'note-meta';
      meta.textContent = new Date(note.updatedAt).toLocaleDateString();

      item.append(title, meta);
      item.addEventListener('click', () => onSelect(note.id));
      list.append(item);
    }
  }

  search.addEventListener('input', () => {
    const query = search.value.trim();
    if (!query) {
      resultCount.hidden = true;
      render(notes);
      return;
    }
    const hits = search(index, query);
    const ids = new Set(hits.map((hit) => hit.id));
    resultCount.hidden = false;
    resultCount.textContent = \`找到 \${hits.length} 条结果\`;
    render(notes.filter((note) => ids.has(note.id)));
  });

  function setActive(id) {
    activeId = id;
    for (const item of list.children) {
      item.classList.toggle('active', item.dataset.id === id);
    }
  }

  function refresh(items) {
    notes = items;
    index = buildIndex(items);
    render(items);
  }

  function toggleCollapse() {
    collapsed = !collapsed;
    el.classList.toggle('collapsed', collapsed);
    localStorage.setItem('aurora.sidebar.collapsed', collapsed ? '1' : '0');
  }

  el.classList.toggle('collapsed', collapsed);
  render(notes);

  return { el, refresh, setActive, toggleCollapse, search, get collapsed() { return collapsed; } };
}
`,
    'README.md': `# Aurora Notes

一个专注于写作体验的本地 Markdown 笔记本。

## 特性

- 纯本地存储，笔记不会离开你的电脑
- 实时 Markdown 预览
- 全文搜索与标签
- 支持浅色 / 深色主题

## 开发

\`\`\`bash
npm install
npm run dev
\`\`\`

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| Ctrl + N | 新建笔记 |
| Ctrl + F | 搜索 |
| Ctrl + S | 立即保存 |

## 文档

- [架构说明](docs/ARCHITECTURE.md)
- [贡献指南](docs/CONTRIBUTING.md)
- [更新日志](CHANGELOG.md)
`,
  });

  write('src/styles/search.css', `.search-panel {
  border-top: 1px solid var(--border);
  padding: 12px 16px;
  background: var(--surface);
}

.search-panel input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px 10px;
  background: transparent;
  color: var(--text);
}

.search-result {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 6px;
  border-radius: 6px;
  cursor: pointer;
}

.search-result:hover {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.search-result mark {
  background: none;
  color: var(--accent);
  font-weight: 600;
}
`);
  write('src/ui/sidebar.js', `import { buildIndex, search } from '../search/index.js';

export function createSidebar({ notes, onSelect, onCreate }) {
  const el = document.createElement('aside');
  el.className = 'sidebar';

  const header = document.createElement('header');
  header.className = 'sidebar-header';
  header.innerHTML = '<h1>Aurora Notes</h1>';

  const newButton = document.createElement('button');
  newButton.className = 'primary-button';
  newButton.textContent = '新建笔记';
  newButton.addEventListener('click', onCreate);
  header.append(newButton);

  const collapseButton = document.createElement('button');
  collapseButton.className = 'icon-button';
  collapseButton.title = '折叠侧边栏';
  collapseButton.textContent = '‹';
  collapseButton.addEventListener('click', toggleCollapse);
  header.append(collapseButton);

  const list = document.createElement('ul');
  list.className = 'note-list';

  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = '搜索笔记…';
  search.className = 'sidebar-search';

  const resultCount = document.createElement('p');
  resultCount.className = 'search-count';
  resultCount.hidden = true;

  el.append(header, search, resultCount, list);

  let activeId = null;
  let collapsed = localStorage.getItem('aurora.sidebar.collapsed') === '1';
  let index = buildIndex(notes);

  function render(items) {
    list.replaceChildren();
    for (const note of items) {
      const item = document.createElement('li');
      item.className = 'note-item' + (note.id === activeId ? ' active' : '');
      item.dataset.id = note.id;

      const title = document.createElement('span');
      title.className = 'note-title';
      title.textContent = note.title || '未命名笔记';

      const meta = document.createElement('span');
      meta.className = 'note-meta';
      meta.textContent = new Date(note.updatedAt).toLocaleDateString();

      item.append(title, meta);
      item.addEventListener('click', () => onSelect(note.id));
      list.append(item);
    }
  }

  search.addEventListener('input', () => {
    const query = search.value.trim();
    if (!query) {
      resultCount.hidden = true;
      render(notes);
      return;
    }
    const hits = search(index, query);
    const ids = new Set(hits.map((hit) => hit.id));
    resultCount.hidden = false;
    resultCount.textContent = \`找到 \${hits.length} 条结果\`;
    render(notes.filter((note) => ids.has(note.id)));
  });

  function setActive(id) {
    activeId = id;
    for (const item of list.children) {
      item.classList.toggle('active', item.dataset.id === id);
    }
  }

  function refresh(items) {
    notes = items;
    index = buildIndex(items);
    render(items);
  }

  function toggleCollapse() {
    collapsed = !collapsed;
    el.classList.toggle('collapsed', collapsed);
    localStorage.setItem('aurora.sidebar.collapsed', collapsed ? '1' : '0');
  }

  el.classList.toggle('collapsed', collapsed);
  render(notes);

  return { el, refresh, setActive, toggleCollapse, search, get collapsed() { return collapsed; } };
}
`);
  write('README.md', `# Aurora Notes

一个专注于写作体验的本地 Markdown 笔记本。

## 特性

- 纯本地存储，笔记不会离开你的电脑
- 实时 Markdown 预览
- 全文搜索与标签
- 支持浅色 / 深色主题

## 开发

\`\`\`bash
npm install
npm run dev
\`\`\`

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| Ctrl + N | 新建笔记 |
| Ctrl + F | 搜索 |
| Ctrl + S | 立即保存 |

## 文档

- [架构说明](docs/ARCHITECTURE.md)
- [贡献指南](docs/CONTRIBUTING.md)
- [更新日志](CHANGELOG.md)
`);
  await run(['stash', 'push', '-m', 'WIP: 搜索面板样式微调'], {
    env: { GIT_AUTHOR_DATE: stamp(32, 9), GIT_COMMITTER_DATE: stamp(32, 9) },
  });

  // --------------------------------------------------------------- working tree
  // Staged: theme tweak.
  write('src/styles/theme.css', `:root {
  --bg: #f6f4ef;
  --surface: #ffffff;
  --text: #26231f;
  --muted: #7a746b;
  --accent: #db7c52;
  --accent-soft: #f3d7c8;
  --border: #e6e1d8;
  --radius: 10px;
  --shadow: 0 8px 24px rgba(38, 35, 31, 0.08);
}

[data-theme='dark'] {
  --bg: #1b1a18;
  --surface: #24221f;
  --text: #ece8e1;
  --muted: #9a9389;
  --accent: #e08a5f;
  --accent-soft: #45312a;
  --border: #35322d;
  --shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
  background: var(--bg);
  color: var(--text);
}

.app-shell {
  display: grid;
  grid-template-columns: 280px 1fr;
  height: 100vh;
}

::selection {
  background: var(--accent-soft);
}
`);
  await run(['add', 'src/styles/theme.css']);

  // Unstaged: main.js keyboard shortcuts.
  write('src/main.js', `import { createSidebar } from './ui/sidebar.js';
import { createEditor } from './ui/editor.js';
import { NotesStore } from './store/notes.js';

const store = new NotesStore();

export function bootstrap(root) {
  const layout = document.createElement('div');
  layout.className = 'app-shell';

  const sidebar = createSidebar({
    notes: store.list(),
    onSelect: (id) => openNote(id),
    onCreate: () => createNote(),
  });

  const editor = createEditor({
    onChange: (note) => {
      store.save(note);
      sidebar.refresh(store.list());
    },
  });

  layout.append(sidebar.el, editor.el);
  root.replaceChildren(layout);

  function openNote(id) {
    const note = store.get(id);
    if (!note) return;
    sidebar.setActive(id);
    editor.load(note);
  }

  function createNote() {
    const note = store.create({ title: '未命名笔记', body: '' });
    sidebar.refresh(store.list());
    openNote(note.id);
    editor.focus();
  }

  window.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key === 'n') {
      event.preventDefault();
      createNote();
    } else if (event.key === 'f') {
      event.preventDefault();
      sidebar.search.focus();
    }
  });

  const first = store.list()[0];
  if (first) openNote(first.id);
  return { store, sidebar, editor };
}
`);

  // Untracked notes and assets.
  write('notes/todo.md', `# 待办

- [ ] 搜索面板支持按标签过滤
- [ ] 编辑器增加撤销栈
- [ ] 同步协议补充冲突合并策略
- [ ] 导出 PDF 时保留代码块高亮
`);
  write('assets/icon-grid.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor">
  <rect x="3" y="3" width="7" height="7" rx="1.5" />
  <rect x="14" y="3" width="7" height="7" rx="1.5" />
  <rect x="3" y="14" width="7" height="7" rx="1.5" />
  <rect x="14" y="14" width="7" height="7" rx="1.5" />
</svg>
`);

  // Deleted (unstaged).
  remove('docs/old-notes.md');

  // Keep the demo repo on main with a clean-ish HEAD ref layout.
  await run(['checkout', 'main']);

  const log = await run(['log', '--graph', '--oneline', '--all', '--decorate', '-n', '20']);
  const status = await run(['status', '--short']);
  console.log(`Demo repository created at ${DEMO}`);
  console.log(log.stdout);
  console.log('--- status ---');
  console.log(status.stdout);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
