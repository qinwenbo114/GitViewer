# AGENTS.md

GitViewer 是一个本地 Git 图形客户端：Node.js 本地服务（`server/`）+ 无构建的原生 Web 前端（`public/`），界面跑在 Chrome/Edge 的应用窗口里，所有 Git 操作最终都由系统 `git` 命令完成。

本文件面向在这个仓库里改代码的 agent，只写“动手前必须知道的约束”。产品说明、使用流程、截图在 `README.md`；不要在这里重复。

## 运行与验证

| 目的 | 命令 |
| --- | --- |
| 启动（服务 + 应用窗口） | `node launch.mjs` |
| 只启动服务（调试用） | `node launch.mjs --no-open` |
| 后端集成测试 | `node --test test/api.test.mjs`（等价 `npm test`） |
| 重建示例仓库 | `node scripts/make-demo.mjs` |

- **没有任何 npm 依赖，也没有构建步骤**（`package.json` 里没有 `dependencies`）。前端是浏览器直接加载的 ES Modules，改完刷新页面即生效。不要引入打包器、TypeScript 或框架。
- **改过 `server/` 必须跑测试，全绿再交付**。测试通过真实 HTTP RPC 驱动真实 `git`，不 mock。
- 前端改动没有自动化测试覆盖：至少用 `--no-open` 起服务，在浏览器里点一遍改动路径，并确认 DevTools 控制台无报错。
- 测试在 `tmp/api-test-<pid>` 建临时仓库并在结束时清理，`GITVIEWER_DATA` 指向临时目录，不会污染 `data/settings.json`。
- 端口默认 `47110`，被占用会顺延到 47134；实际地址看 `data/launch.log` / `data/runtime.json`。

## 目录职责

| 路径 | 职责 |
| --- | --- |
| `server/git.mjs` | 唯一的 git 执行器：临时文件承载 stdio、超时、环境变量、trace |
| `server/repo.mjs` | 只读查询：状态、日志、提交图、Diff、Blame、冲突三方内容 |
| `server/actions.mjs` | 写操作：暂存、提交、分支、标签、贮藏、网络、文件对话框、冲突保存 |
| `server/index.mjs` | HTTP 服务、`/api/rpc` 分发、静态文件 |
| `server/store.mjs` | `data/settings.json` 与最近仓库 |
| `server/util.mjs` | 路径校验、编码解码、numstat 解析、错误类型 |
| `public/js/app.js` | 控制器：路由、刷新、操作流程、`ctx` 表面 |
| `public/js/shell.js` | 顶栏、侧栏、状态栏、设置 |
| `public/js/state.js` | 单一状态树 + 控制台 trace 缓冲 |
| `public/js/api.js` | `rpc()` 客户端 |
| `public/js/components/` | 可复用渲染片段（提交图、Diff、详情、冲突、Blame、对话框） |
| `public/js/views/` | 六个视图的 `renderXxxView(ctx)` |
| `public/styles.css` | 全部样式（Darcula 深色 + 浅色两套变量） |

## 一次 RPC 的完整路径

```
视图 (views/*)  →  ctx.doXxx()  (app.js)
               →  rpc('x.y', params)  (api.js)
               →  methods['x.y']  (server/index.mjs 的方法表)
               →  actions.mjs / repo.mjs
               →  git()  (server/git.mjs)
               →  trace  →  addTrace()  →  「控制台」视图
```

**新增一个操作时四处都要动**，漏一处就会“接口存在但界面点不到”：

1. `server/actions.mjs` 里导出函数，入口就做参数校验；
2. `server/index.mjs` 的 `methods` 表注册 `'域.动作'` —— 这张表就是前端可调用面的唯一白名单；
3. `public/js/app.js` 包一层 `doXxx()`（用 `perform()` 统一忙状态、toast、刷新），再挂到 `ctx`；
4. 视图里只调 `ctx.doXxx()`，**不要**在视图里直接 `rpc()`。

## 硬性约定

**Git 调用**
- 只能通过 `git(args, opts)` / `gitOk(args, opts)`，`args` 必须是数组，永不拼接 shell 字符串，也不用 `exec`。
- stdio 走临时文件而不是管道，是刻意选择：受限 Windows 沙箱里匿名管道可能不可用，超大 Diff 走管道会死锁。不要“优化”成 `stdio: 'pipe'`。
- 长操作显式给 `timeout`：fetch / pull / push / clone 900s，merge / rebase / cherry-pick / revert 300s，默认 120s。
- 不要自己再记 trace 或打印命令，`git()` 已经写进「控制台」视图。

**错误**
- 服务端抛 `AppError` / `badRequest()`（`server/util.mjs`），`index.mjs` 会统一转成 `{ ok: false, error: { message, command, stderr, stdout, code } }`；RPC 失败也返回 **HTTP 200**。
- 给用户看的信息用 `cleanGitError(stderr)` 洗过，不要把 `hint:` 和原始 stderr 直接甩给界面。
- 前端用 `showError(err)` / `toast()` 呈现 `err.message`，不自行拼错误文案。

**路径与编码**
- 前端传来的路径一律是「仓库内相对路径 + `/` 分隔」，服务端用 `safeRepoPath()` 校验；仓库目录用 `normalizeRepoPath()`；绝对路径只在服务端内部拼。
- 分支/提交/远程名用 `assertRefLike()` / `assertShaLike()`，**不要自己写正则**。
- 读文件字节一律过 `decodeText()`（UTF-8，坏字节回退 GBK）和 `isProbablyBinary()`；中文路径 / 中文内容 / GBK 已有测试覆盖，不要绕开。

**前端**
- 用 `h(tag, attrs, ...children)` 构造 DOM；`html:` 只用于可信静态内容（图标、已转义文本）。用户数据一律作为子节点插入，不要拼字符串进 `innerHTML`。
- 状态只有一份，住在 `state.js`；改完状态调 `render()` 全量重绘，不要手工 patch DOM（需要保留焦点/草稿时，把这类交互状态也放进 `state`，例如 `state.changes.editor`）。
- 不要往 `state` 里塞 DOM 节点或闭包。
- 每个视图都是 `renderXxxView(ctx)` 的纯渲染函数；跨视图的动作放 `app.js`，别写进视图文件。
- 持久化：应用设置走 `settings.save`（落 `data/settings.json`，原子写）；纯界面尺寸等临时偏好走 `localStorage`，键名统一 `gitviewer.*`。

**风格**
- 界面文案一律中文（与现有用词保持一致：如「本地变更」「已暂存」「标记为已解决」）；标识符英文；代码注释以英文为主，同一文件内保持一致。注释解释「为什么」，不复述代码。
- 视觉只用 `styles.css` 里的 CSS 变量（`--bg-app`、`--bg-panel`、`--text-dim`、`--accent`、`--red`、`--yellow`、`--mono`…）。新增颜色先加进深色、浅色两套 `:root`，不要散落硬编码色值。
- 新图标加进 `public/js/icons.js`（24×24 stroke 路径），用 `icon(name, size)`，不要内联 `<svg>`。
- 服务端保持跨平台：Windows 专有分支（`explorer.exe`、`taskkill`）必须写在 `process.platform === 'win32'` 判断里，并提供其他平台的降级路径。

**边界**
- 服务只监听 `127.0.0.1`，不要加对外监听或远程访问。
- 不要往用户的仓库里写文件。目前只有两处会写工作区：`ignorePath()` 改 `.gitignore`，`writeWorkingFile()` 保存冲突文件——后者只接受「当前未解决冲突」的文件，写前用 `expectedHash` 做并发校验，保留 BOM 与 CRLF，内容无残留标记才自动 `git add`。要扩展写文件能力，必须沿用这套限制。
- 不要提交 `data/`、`demo/`、`tmp/`、`node_modules/`、`*.log`（已在 `.gitignore`）。

## 测试怎么写

- `node:test` + `node:assert/strict`，通过真实 HTTP 的 `rpc()` 辅助函数调用，不 mock git，不碰真实用户仓库。
- 每个行为一个 `test()`，名字写成一句可读的断言（例如 “edits a conflicted file and marks it resolved”）。
- 只改前端时也要保证 `node --test test/api.test.mjs` 仍然全绿。
- 涉及编码、换行、路径、并发校验的改动，要加具体断言（BOM 字节、CRLF、`expectedHash` 失配报错等），不要只断言“没抛错”。

## 交付前自检

- [ ] `node --test test/api.test.mjs` 全绿
- [ ] 没有新增依赖、没有构建产物、没有提交 `data/` 或 `tmp/`
- [ ] 新 RPC 已在 `methods` 表、`ctx`、视图三处接通
- [ ] 界面文案中文、错误信息经过 `cleanGitError`
- [ ] 前端改动在浏览器里实际点过
- [ ] 改完功能顺手同步 `README.md` 对应章节

## 已知缺口（别假设它们已经能用）

- `settings.editorCommand` 只有默认值，没有接线到任何界面或逻辑。
- 不支持逐行 / 逐 Hunk 暂存；不支持交互式 rebase；不支持子模块与 LFS 专用界面。
- 冲突编辑器只支持文本冲突：普通文件不能在线编辑，二进制冲突只能选择保留某一方。
