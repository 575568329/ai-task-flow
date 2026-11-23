# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目定位与现状

个人 AI 工作记录中枢 + 个人工具集。核心闭环：终端里的 AI 改完代码 → 通过 MCP `record_work` 记录为「项目 → 版本 → 功能点」（含 git diff 与文件行号）→ 在 Web 工作记录页按项目/版本/关键字回溯，支持人工增删改。

**2026-11 转型**：任务编排看板、AI 聊天、任务文档、用量统计已整体砍除（代码在 git 历史，旧数据保留在 `~/.ai-task-flow/`）。不要再按「看板 / 派发 / worktree / Task 聚合根 / 四态机」理解本项目；`.claude/2026-06-05-*` 与 `docs/plans/` 里的旧任务文档只是历史归档。当前形态以 `README.md` 为准。

## 常用命令

统一使用 **npm**（禁 pnpm / cnpm / yarn）。仓库根为 monorepo，workspaces = `shared` / `backend` / `frontend` / `cli` / `extension`。

```bash
npm install
npm run dev          # concurrently: shared build:watch → backend → frontend
npm run dev:windows  # PowerShell 版(scripts/dev.ps1)
npm run build        # shared → backend → frontend(必有产物 backend/public)
npm start            # CLI 单端口托管前端(cli/bin/ai-task-flow.js，默认 47821，自动开浏览器；需先 build)
```

- 前端 dev 固定 **5678**，后端从 **47821** 起（被占自动顺延）；实际端口写入 `.logs/backend-port.txt`，vite 每次请求动态读取。
- dev 有严格顺序：shared 先构建 → backend → frontend。**不要单独起 frontend**（shared 未构建会找不到 `@ai-task-flow/shared`）。

测试（backend/frontend/extension 均为 vitest，测试就近放 `__tests__/`）：

```bash
cd backend && npx vitest run                              # 全量
cd backend && npx vitest run src/application/worklog       # 单目录/单文件
cd frontend && npm test                                   # vitest run
cd frontend && npx vitest run src/components/worklog/__tests__/worklogComponents.test.tsx
cd extension && npm test
BASE_URL=http://127.0.0.1:47821 bash tests/run_all.sh     # curl E2E，需后端已启动
```

MCP 产物与发布：

```bash
cd backend && npm run build   # 重建 dist 后，ZCode/Claude 全局注册立即指向新产物(下一会话生效)
bash scripts/publish.sh --dry-run   # 发布预演；正式发布按 shared → backend → cli 顺序
cd desktop && npm start             # Electron 壳(独立依赖，不在 workspaces；读 backend/dist + backend/public，需先 build)
```

## 仓库布局与依赖方向

```
shared/      前后端共享类型 + worklog MCP 工具目录(catalog)单一来源
backend/     Fastify HTTP + MCP stdio；DDD 四层；tsc 产物 dist/
frontend/    React SPA(Vite)
cli/         npm 全局 CLI 入口(bin/ai-task-flow.js → @ai-task-flow/cli)
extension/   MV3 网页剪藏扩展
desktop/     Electron 壳(不在 workspaces，独立 node_modules)
tools/ spike/  实验性代码，勿当产品代码修改
tests/       curl E2E 脚本
knowledge-base/  MCP save_to_knowledge 的写入产物
```

依赖方向单向：`shared → backend / frontend / extension`。改 `shared/` 后必须 `npm run build:shared`（dev 下保持 watch），否则其他 workspace 的 `tsc` 找不到 `.d.ts`。

## 后端架构

- 入口 `backend/src/http-server.ts` 的 `startApp()`：手工 `new` 仓储/服务并注入（**无 DI 容器**），随后启动 HTTP。新增模块的装配点就在这里。
- 四层：`domain/`（实体、值对象、仓储接口）→ `application/`（用例服务）→ `infrastructure/`（JSON 持久化、LLM、外部客户端）→ `interfaces/`（http routes + mcp tools）。
- 业务模块：worklog（核心）、conclusion、knowledge、mindmap、webclip、claude-profile、llm-config、system。
- ESM + Node16 解析：TS 源码里的相对 import **必须带 `.js` 后缀**。
- HTTP 路由注册集中在 `interfaces/http/server.ts`；新增模块顺序：repository → service → routes → `startApp` 装配 → 可选 MCP 工具。
- 前后端日志落 `.logs/`；跨上下文链路必须保证日志能在后端可查。

## 持久化与数据目录

- 所有路径走 `backend/src/config/dataDir.ts` 的 `resolveDataDir()`，优先级：显式参数 > `AI_TASK_FLOW_DATA_DIR` > WSL 自探测 Windows home > `~/.ai-task-flow`。**禁止散用 `os.homedir()` / `~` / `$HOME`**。
- 主要数据文件：`worklog.json`、`conclusions.json`、`mindmaps.json`、`knowledge/`、`llm-config.json`、`claude-profiles.json`、`uploads/`；破坏性操作前快照到 `worklog-backups/`（滚动保留 10 份）、`conclusion-backups/`（改信息/删除前快照，滚动保留 10 份）。
- **项目路径身份字段**：项目有稳定 `id` 与 `paths`（本地绝对路径，可多个，页面绑定）；工作记录条目有 `sourcePath`（MCP 取 `process.cwd()`，按最长前缀归属项目）；工作记录与结论卡用 `relatedProjectIds` 存关联项目稳定引用、`relatedProjects` 存名称快照（改名后靠 id 映射显示新名称）。旧数据由 HTTP 启动时一次性迁移补 `id` 并按名称绑定结论卡（幂等）。
- worklog 写协议：进程内 promise-chain mutex + proper-lockfile 跨进程锁 + write-file-atomic。HTTP 与 MCP 是两个进程并发写，新增持久化写入必须沿用此模式，勿直接 `fs.writeFile`。
- 前端靠文件轮询刷新，不是实时推送；MCP 回写后等几秒再看页面。

## MCP Server

- stdio transport，入口 `backend/src/interfaces/mcp/server.ts`，产物 `backend/dist/interfaces/mcp/server.js`。
- 12 个工具：`record_work` / `query_work` / `list_projects` / `update_work` / `delete_work` / `delete_version` / `delete_project` / `rename_version` / `rename_project` / `record_conclusion` / `query_conclusions` / `save_to_knowledge`。
- **worklog 工具**的描述与 detail 写作模板**单一来源**是 `shared/src/worklog/mcpToolCatalog.ts`（MCP 注册、前端 AI 指南、工具描述三端同源），改文案只改这里；conclusion 两个工具的定义就近在 `backend/src/interfaces/mcp/tools/conclusion/`。
- 注册点：ZCode `~/.zcode/cli/config.json`、Claude Code `~/.claude.json`（均全局）+ 仓库 `.mcp.json`（相对路径，随仓库分发），全部指向同一份 dist。
- 改完 MCP 代码必须 `cd backend && npm run build`；已打开的会话需重启。之后回写 `docs/mcp-registration.md` 的「当前版本」（commit + 构建时间）。

### 阶段标签（唯一单值）

- `record_work` / `record_conclusion` 的 `stage` 是唯一单值：`req` 获取需求 / `design` 设计文档与实施计划 / `dev` 开发 / `self-test` 自测 / `review` 代码评审 / `coverage` 覆盖度测试 / `release` 上线 / `retro` 复盘。
- **缺陷修改不占 stage**，用 `tags` 里的 `fix` 表示工作类型。
- 枚举与 harness 0–5 映射在 `shared/src/types/stage.ts`；旧记录可为空（页面显示未标注）。
- 结论卡的 stage 存在每个 revision 上；工作记录存在条目上。

## 前端

- React 19 + Vite + TypeScript + Zustand + shadcn/ui（Radix）+ Tailwind v4；路径别名 `@/` → `frontend/src/`。
- **无 router**：`App.tsx` 用 `hidden` 做 keep-alive 视图切换（worklog 默认、conclusion、knowledge、mindmap），视图不卸载以保留分栏等状态。不要引入路由或改成条件卸载。
- 全局状态按领域拆 store（`stores/*Store.ts`）；只服务于单个视图的状态用局部 `useState`（如 conclusion 的详情/展开态，没有 conclusionStore）。HTTP 统一走 `api/http.ts` 封装。
- 组件按领域放在 `components/views`、`components/worklog|conclusion|knowledge|mindmap|ui`。
- 已知坑：图片预览用 YARL（不要手写蒙版）；TTS 统一用 `lib/speech.ts` 封装。

## 红线（每一条都有踩坑代价）

- 端口：前端固定 5678。`/api` 全 404 先查 5678 是否被其他服务占用，以及 `.logs/backend-port.txt` 是否残留旧端口。
- 非内网环境安装前删 `package-lock.json`（含内网源，公网会 ENOTFOUND 并报误导性的 `Exit handler never called!`）。
- 跨 workspace 共享的构建/类型依赖（vite、typescript 等）版本范围必须有交集，否则 npm 装两份 → `PluginOption` 类型冲突。排查：`npm ls vite --workspaces`。
- `LlmConfigService` 返回值**含密钥**：禁止透传前端或写日志，展示用 `getMaskedConfig()`。
- 勿提交运行时产物（已 gitignore）：`*hook-events.jsonl`、`backend/public/`、`backend/uploads/`。
- WSL ↔ Windows 混合环境：后端常跑 Windows、MCP 常跑 WSL，两边 home 是不同物理目录，统一靠 `resolveDataDir()` 自探测；`appendWindowsPath=false` 时用绝对路径调 `cmd.exe` / `powershell.exe`；WSL 下不要跑 `vite build`（node_modules 是 Windows 侧的），只做 `tsc` 类型检查。
- 启动子终端必须传 `buildCleanEnv()`（剥离 `ANTHROPIC_*` / `CLAUDE_*`），否则子进程继承后端启动时的 Claude 配置。
- **路径绑定仅页面操作**：项目的 `paths` 只通过页面（`PUT/DELETE /api/worklog/projects/:name/paths`）绑定/解绑，MCP 工具不提供绑定入口、`sourcePath` 也不暴露给 AI（由 handler 自动填 `cwd`）。排查归属问题时让用户在页面操作，不要让 AI 改绑定。
- 详细原因与排障：`docs/20260723130001_项目避坑与约定.md`、`docs/20260723130000_依赖安装排坑记录.md`。

## 文档地图

| 文档 | 内容 |
|---|---|
| `README.md` | 产品现状、快速启动、模块表（**权威**） |
| `AGENTS.md` | 完整协作 / 编码 / TDD 规范（与全局 CLAUDE.md 同源） |
| `docs/mcp-registration.md` | MCP 注册清单、当前版本、更新 SOP |
| `docs/plans/2026-11-17-worklog-slim-design.md` | 当前形态的设计 v3 |
| `docs/plans/2026-11-17-worklog-slim-implementation-plan.md` | 转型实施计划（已落地） |
| `docs/YYYYMMDDHHMMSS_*.md` | 各阶段设计与踩坑归档；只记录当时决策，现状以 README 为准 |
| `scripts/publish.sh` | npm 发布流程（本文件旧版引用的 `.claude/npm-publishing-guide.md` 已不存在） |
