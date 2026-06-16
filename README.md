# AI Task Flow

> 个人 AI 任务编排看板 + MCP Server

在网页看板上录入任务,点「派发」自动创建 git worktree;你在终端用**原生 Claude Code** 通过 MCP 协议拉取任务、回写状态;看板经 SSE 自动同步。不嵌入、不代起 agent,你始终掌控 AI 交互。

[![tests](https://img.shields.io/badge/tests-52%20passed-brightgreen)]()
[![build](https://img.shields.io/badge/build-passing-brightgreen)]()
[![stage](https://img.shields.io/badge/stage-MVP-blue)]()
[![version](https://img.shields.io/badge/version-0.2.0-blue)]()

---

## 核心理念

| 别人怎么做 | AI Task Flow 怎么做 |
|-----------|---------------------|
| 工具**代起** agent 进程(嵌入式) | agent(你的 Claude Code)**主动拉取**任务(MCP 拉取式) |
| AI 交互被工具接管 | 你在自己的终端,用原生 Claude Code |
| 任务直接在主分支跑 | 每个任务一个 git worktree,失败可丢弃,主分支永远干净 |

> 与 Vibe Kanban / Claude Task Master / Backlog.md 的详细对比见 [`docs/20260605223500_竞品对比分析.md`](docs/20260605223500_竞品对比分析.md)。

---

## 工作流程

```
①网页录入任务  →  ②点「派发」  →  ③后端建 worktree (.ai-workspaces/<task-id>)
                                          ↓
⑥看板 SSE 自动刷新  ←  ⑤Claude 回写结果  ←  ④你在终端用 Claude Code 经 MCP 拉取任务
```

任务状态机:`planning → todo → dispatched → review → done`(可 `blocked`)。

---

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Node.js + TypeScript + Fastify + @modelcontextprotocol/sdk + simple-git + tsyringe |
| 前端 | React 18 + TypeScript + Vite + Tailwind CSS v4 + Zustand + @dnd-kit + react-diff-view |
| 架构 | DDD 四层(domain / application / infrastructure / interfaces)+ EventBus |
| 存储 | JSON 文件(`~/.ai-task-flow/tasks.json`)+ EventStore(JSONL) |
| 实时 | SSE(Server-Sent Events) |
| 隔离 | git worktree(每任务一个) |
| 共享 | `shared/` 包(前后端共享 TS 类型契约) |

---

## 快速开始

### 前置要求
- Node.js ≥ 18
- git
- Claude Code(用于通过 MCP 拉取任务)

### 1. 安装依赖
```bash
npm install
```

### 2. 启动(开发模式)
```bash
# 同时启动前端(:5173)+ 后端 HTTP(:3000)
npm run dev
```
- 后端 HTTP API:http://localhost:3000
- 前端看板:http://localhost:5173

也可分别启动:
```bash
npm run dev:backend    # 仅后端 HTTP(:3000)
npm run dev:frontend   # 仅前端(:5173)
```

### 3. 打开看板
浏览器访问 http://localhost:5173,即可录入/管理任务。

### 4. 配置 Claude Code(MCP)
```bash
# 先构建后端,生成 MCP server 入口
npm run build:backend
```
参考 [`docs/claude.json.example`](docs/claude.json.example),把 `ai-task-flow` 片段加入你的 `~/.claude.json` 的 `mcpServers`,改好绝对路径后重启 Claude Code。

---

## MCP 工具(给 Claude Code)

配置好后,在 Claude Code 里可直接调用以下 5 个工具:

| 工具 | 作用 |
|------|------|
| `list_pending_tasks` | 列出待办/已派发任务(支持 `status` 过滤) |
| `get_task` | 获取任务详情(Markdown 格式,含验收标准/相关文件/worktree) |
| `record_result` | 回写执行结果(done/partial/blocked + 变更文件 + 备注) |
| `get_task_diff` | 获取任务 worktree 相对基线分支的 git diff |
| `add_note_to_task` | 给任务追加备注 |

典型用法:在 Claude Code 里说「列出待办任务」→「拉取 WS-001」→ 完成后「回写 WS-001 的结果」。

---

## 资料调研(Chat)

看板内置一个独立的「资料调研」聊天模块,用于快速检索资料并生成带引用的回答:

- **LLM 双协议**:按 baseURL 自动选择 OpenAI 兼容(`/chat/completions`)或 Anthropic(`/v1/messages`)协议,适配智谱 paas/v4、智谱 Coding Plan(glm-5.2)、DeepSeek、Claude 官方等
- **检索增强(RAG)**:并行调用 GLM Web Search(网页,每次必搜)与 arXiv(论文,学术问题才搜),去重后取最多 6 条来源,回答内联 `[1][2]` 引用
- **配置热更新**:在「设置 → LLM 配置」填地址/Key/模型,保存即生效;支持「测试连接」验证,并实时显示命中的协议
- 对话持久化到 `~/.ai-task-flow/chats.json`(文件存储,重启不丢失)
- 详见 [资料调研设计](docs/plans/2026-06-09-research-chat-agent-design.md)

---

## HTTP API(给前端 / 脚本)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/api/tasks` | 所有任务 |
| GET | `/api/tasks/:id` | 单个任务 |
| GET | `/api/tasks/status/:status` | 按状态查询 |
| POST | `/api/tasks` | 创建任务 |
| PATCH | `/api/tasks/:id` | 更新任务(发布 `TaskUpdated` 事件,驱动 SSE) |
| DELETE | `/api/tasks/:id` | 删除任务 |
| GET | `/api/tasks/:id/diff` | 获取 worktree 的 git diff(支持 `?base=`) |
| POST | `/api/tasks/:id/approve` | 审查通过(review→done,发布 `TaskApproved`) |
| POST | `/api/tasks/:id/reject` | 审查打回(review→todo,发布 `TaskRejected`) |
| GET | `/api/events` | SSE 事件流(实时推送) |
| GET | `/api/llm-config` | LLM 配置(apiKey 脱敏) |
| PUT | `/api/llm-config` | 保存 LLM 配置(保存即热生效) |
| POST | `/api/llm-config/test` | 测试连接(验证 端点/Key/模型,不保存) |
| GET | `/api/system/storage` | 数据目录存储占用(分类统计) |
| POST | `/api/system/storage/clear` | 按类别清理存储 |

---

## 项目结构

```
ai-task-flow/
├── backend/
│   └── src/
│       ├── domain/workflow/         # 领域层:Task 聚合根、值对象、领域事件
│       ├── application/             # 应用层(预留,用例待补)
│       ├── infrastructure/
│       │   ├── git/                 # WorktreeManager(simple-git)
│       │   ├── persistence/         # JsonTaskRepository
│       │   ├── pubsub/              # EventBus + EventStore
│       │   └── di/                  # tsyringe 容器
│       └── interfaces/
│           ├── http/                # Fastify REST API + SSE
│           └── mcp/                 # MCP Server(5 工具)
├── frontend/
│   └── src/
│       ├── api/                     # HTTP 封装 + SSE 客户端
│       ├── components/              # 看板/卡片/抽屉/弹窗 + ui/(自建 Tailwind 组件)
│       ├── stores/                  # Zustand(taskStore / uiStore)
│       └── lib/                     # cn / 状态映射 / 工具
├── shared/                          # 前后端共享类型包(@ai-task-flow/shared)
├── tests/curl/                      # E2E API 测试(curl)
└── docs/                            # 设计、审查、对比文档
```

数据/隔离目录(运行时生成,根目录可用 `--data-dir` 或环境变量 `AI_TASK_FLOW_DATA_DIR` 覆盖):
- `~/.ai-task-flow/tasks.json` —— 任务数据
- `~/.ai-task-flow/events.jsonl` —— 事件流
- `~/.ai-task-flow/chats.json` —— 资料调研对话
- `~/.ai-task-flow/llm-config.json` —— LLM 配置(含明文 Key,权限 `0600`)
- `~/.ai-task-flow/{uploads,tasks,logs}` —— 上传图片/任务 Markdown 存档/运行日志
- `<你的项目>/.ai-workspaces/<task-id>/` —— 每任务的 git worktree

---

## 测试

```bash
# 后端单元 + 集成测试(vitest,52 个)
cd backend && npm test -- --run

# 后端类型检查
cd backend && npx tsc --noEmit

# E2E API 测试(需先启动后端)
cd backend && PORT=3001 npm run http      # 终端 A
BASE_URL=http://localhost:3001 bash tests/run_all.sh   # 终端 B
```

当前状态:**52 单元/集成测试 + 22 E2E 断言全部通过**,前后端均可构建。

---

## 已知限制(MVP)

本项目为 MVP,以下为有意识的权衡,详见 [`docs/20260605223000_代码审查报告.md`](docs/20260605223000_代码审查报告.md):

- **仅支持 Claude Code**(设计可扩展,暂未接其他 agent)
- **无 AI 任务拆解**(任务靠人工录入)
- **无鉴权**:默认 HTTP 监听 `0.0.0.0`(局域网可访问,便于团队共用)。敏感入口(如设置)按来源 IP 判定本机,非本机自动隐藏;但这**不是真正的鉴权**,公网暴露请自行加鉴权并改监听地址
- **JSON 文件存储**:无事务/并发控制,适合单人本地场景
- `applyUpdate`(看板拖拽改状态)不强制状态机校验,允许任意状态跳转

---

## 文档

- [更新日志 (CHANGELOG)](CHANGELOG.md)
- [设计文档](.claude/2026-06-05-ai-task-flow-design.md)
- [实施计划](.claude/2026-06-05-ai-task-flow-implementation-plan.md)
- [LLM 配置功能设计](docs/20260610233000_LLM配置功能设计.md)
- [资料调研(Chat)设计](docs/plans/2026-06-09-research-chat-agent-design.md)
- [代码审查报告](docs/20260605223000_代码审查报告.md)
- [竞品对比分析](docs/20260605223500_竞品对比分析.md)

---

## License

MIT

