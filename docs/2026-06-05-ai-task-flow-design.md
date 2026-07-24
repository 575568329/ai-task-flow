# AI Task Flow - 设计文档 v3

**项目名称**: ai-task-flow
**版本**: v3.0 Design (MCP Server 形态)
**日期**: 2026-06-05
**远程仓库**: git@github.com:575568329/ai-task-flow.git
**分支**: main
**架构风格**: Domain-Driven Design (DDD) + Clean Architecture + MCP Server

> **历史版本**:
> - v1 (输入预处理器): `2026-06-05-ai-task-flow-design.v1-archived.md`
> - v2 (嵌入式 AI 工作台): `2026-06-05-ai-task-flow-design.v2-archived.md`
>
> v3 是基于"用户希望保留原生 Claude Code 体验 + 看板自动同步状态"的诉求而生的最终形态。

---

## 一、项目定位与边界

### 1.1 一句话定位

> 个人 AI 任务编排看板 + MCP Server。在网页看板上录入工作任务,点派发后工具创建 git worktree。你照常在终端用 Claude Code 工作,通过 MCP 协议主动从看板拉取任务、回写状态。看板自动同步,你完全掌控 AI 体验。

### 1.2 三种产品形态对比 (定终稿)

| 形态 | 工具角色 | 你跑 AI 的方式 | v3 选择理由 |
|------|---------|--------------|-----------|
| v1 (输入预处理器) | 准备 task.md 让你粘贴 | 终端跑 Claude | 状态回写靠 YAML+正则,业界反模式 |
| v2 (AI 工作台) | 内嵌聊天窗驱动 Claude | 在工具网页里 | 重新发明 Claude Code 已有的体验,失去原生掌控感 |
| **v3 (MCP 协作)** ✅ | **MCP server + 看板** | **终端跑 Claude(原生体验)** | **保持纯净 + 自动同步 + 跨 IDE + 官方协议** |

### 1.3 v3 的核心价值

- **保持原生 Claude Code 体验**: stream 输出、Ctrl+C 中断、权限弹窗都是 Claude Code 原生形态,工具不重新发明
- **看板自动同步状态**: Claude 调 MCP 工具回写,工具实时更新看板,你随时切回去看进度
- **跨 IDE 通用**: 任何支持 MCP 的客户端都能接入(Cursor/Cline/Continue 等),换工具不影响
- **官方协议长期稳定**: Anthropic 主推的 MCP 是 2024-2025 行业事实标准
- **结构化回写零反模式**: MCP 工具调用天然 schema 化,无需 YAML+正则解析
- **git worktree 隔离**: 任务级独立分支,失败可丢弃,主分支干净

### 1.4 与 v2 相比的减法 (大幅降复杂度)

v2 包含但 v3 砍掉的部分:

- ❌ Agent SDK 集成 (`@anthropic-ai/claude-agent-sdk`)
- ❌ 嵌入式聊天窗 (ChatPanel/MessageBubble)
- ❌ 工具审批气泡 (ToolApprovalDialog)
- ❌ canUseTool 桥接 / Approval 往返
- ❌ WebSocket 双向流式协议 (改回 SSE 单向推送即可)
- ❌ Risk Level 三档审批策略 (Claude Code 原生权限系统已胜任)

v3 保留的核心:

- ✅ DDD 四层架构 + Bounded Context 战略设计
- ✅ git worktree 隔离机制
- ✅ Kanban 看板 + 卡片详情
- ✅ 多项目过滤 + 截图富输入
- ✅ 模板系统 + 任务模型
- ✅ EventBus + EventStore (跨域协作)
- ✅ 结构化回写(MCP 工具调用替代 v1 的 YAML)

### 1.5 MVP 边界

**MVP 包含**:
- 任务 CRUD (Kanban 看板 + 卡片详情)
- 模板系统 (Markdown 拼装初始 prompt)
- 多项目过滤
- 截图管理 (粘贴/拖拽 + 本地存储)
- 任务派发 (创建 worktree + 标记可拉取)
- **MCP Server**: 暴露 `get_pending_tasks` / `get_task` / `record_result` / `update_status` 等工具
- Diff 审查 (查看 worktree 的 git diff)
- 看板状态实时更新 (SSE 推送)
- DDD 四层架构 + 5 Bounded Context 预留

**MVP 暂不做** (后续版本):
- ❌ Skills / MCP 安装管理 (v0.4)
- ❌ 邮件收取分发 (v0.4)
- ❌ 数据统计看板 (v0.3)
- ❌ 多任务并发 (v0.2)
- ❌ Agent 多人格 (worktree-level 而非 task-level)

### 1.6 5 个 Bounded Context (前瞻)

| Bounded Context | 职责 | 状态 |
|----------------|------|------|
| **Workflow** | 任务录入、派发、回写、审查、归档 | ✅ MVP 实现 |
| **MCP Server** | 暴露任务/状态接口给外部 AI 客户端 | ✅ MVP 实现 |
| **Analytics** | 统计看板、AI 执行成功率、时序报表 | 🔜 v0.3 |
| **Plugin** | Skills/MCP 客户端集成管理 | 🔜 v0.4 |
| **Messaging** | 邮件收取、Slack/飞书集成 | 🔜 v0.4 |

注意: v3 的"MCP Server"是工具自身**对外暴露**的服务,不是"调用别的 MCP";Plugin Context 才是后期"集成第三方 MCP/Skills"的功能。

---

## 二、产品形态与核心交互

### 2.1 一次任务的完整生命周期

```
[用户操作]              [工具行为]                [Claude Code 行为]
─────────────           ─────────────             ─────────────────────

1. 录入
   看板新建任务  ────►   tasks.json 写入
                        status: todo

2. 派发
   点"派发"按钮  ────►   创建 git worktree
                        分支: ai-task/<id>-<slug>
                        快照 main HEAD
                        status: dispatched

3. 拉取 (用户主动)
   终端启动 Claude Code
   "拉一下 WS-001"  ──────────────────────────►   调 MCP get_task("WS-001")
                                                   收到 { worktreePath, prompt, ... }
                                                   cd 到 worktreePath
                                                   开始干活
                        status: dispatched
                        (工具知道 Claude 已拉)

4. 执行
                                                   Read/Edit/Bash 等
                                                   修改 worktree 内代码

5. 回写
                        ◄──────────────────────  调 MCP record_result({
                                                   status: "done",
                                                   changedFiles: [...],
                                                   notes: "..."
                                                 })
                        解析入参 (Zod 校验)
                        更新 task 聚合根
                        计算 git diff
                        status: review

6. 审查
   看板"审核中"列收到推送
   点开任务看 diff
   决定: 通过 / 打回

7a. 通过
   点"通过"+合并策略  ────►  执行 git merge / 保留分支
                          清理 worktree (可选)
                          status: done

7b. 打回
   点"打回"+理由  ────►   destroy worktree
                          status: todo
```

### 2.2 用户操作流程对比

**v3 形态** (你选择的):
```
1. 网页看板录入任务
2. 点"派发" → 工具创建 worktree
3. 切到终端,启动 Claude Code
4. 对 Claude 说"拉 WS-001"
5. Claude 自动 cd 到 worktree 干活 (你看着原生 Claude Code 输出)
6. Claude 完成后自动调 MCP 回写
7. 切回看板,任务已在"审核中"
8. 看 diff,决定通过/打回
```

**关键不同**: 第 4 步不是切终端粘贴命令,是直接对 Claude 说一句中文。第 7 步看板已经自动是新状态,不需要刷新。

### 2.3 MCP Server 的角色

工具运行时同时启动两个服务:

- **HTTP API** (port 3001 默认): 给前端 Vue 看板用,REST + SSE
- **MCP Server** (stdio 或本地端口): 给 Claude Code 用,JSON-RPC 协议

两个服务共享同一个后端核心(domain/application/infrastructure),只是 interface 层不同。

```
                  ┌─────────────────────────────────────┐
                  │         Backend Core                │
                  │  domain / application / infra       │
                  └──────┬──────────────────────┬───────┘
                         │                      │
            ┌────────────▼─────────┐ ┌──────────▼────────────┐
            │  HTTP/SSE Interface  │ │  MCP Server Interface │
            │  (前端看板)            │ │  (Claude Code)        │
            └────────┬─────────────┘ └──────────┬────────────┘
                     │                          │
            ┌────────▼────────┐         ┌───────▼────────┐
            │  Vue 前端       │         │  Claude Code    │
            │  (看板/审查)    │         │  (终端/IDE)     │
            └─────────────────┘         └────────────────┘
```

### 2.4 双层存储模型

| 层 | 位置 | 存什么 | 谁读写 |
|----|------|-------|--------|
| 源数据层 | `~/.ai-task-flow/` | tasks.json / templates.json / projects.json / images/ / event-store.jsonl | 工具独占 |
| 产物层 | 各项目 `.ai-workspaces/<task-id>/` worktree | 实际代码改动(git 管理) + meta.json | 工具创建,Claude 改代码,工具读 git diff |

---

## 三、MCP Server 接口设计 (核心)

### 3.1 暴露的 MCP 工具清单

> ⚠️ **已演进**：下表为 v3 初始设计快照（含 `update_status` / `get_task_diff` 等**未实现**项）。**现状以代码为准**：共 6 个工具（`list_pending_tasks` / `get_task` / `record_result` / `complete_step` / `add_note_to_task` / `save_to_knowledge`），详见 [MCP_TOOLS_GUIDE](MCP_TOOLS_GUIDE.md)。

| 工具名 | 用途 | 调用频率 |
|-------|------|---------|
| `list_pending_tasks` | 列出当前项目待执行任务(status=dispatched) | 较少,通常用户已知 ID |
| `get_task` | 拿任务完整详情(prompt/worktreePath/relatedFiles) | 每次执行任务前必调 |
| `update_status` | 更新任务状态(可选,通常 Claude 不需要) | 很少 |
| `record_result` | 记录任务执行结果 | 每次任务完成必调 |
| `get_task_diff` | 获取当前 worktree 的 git diff | 可选,Claude 自检用 |
| `add_note_to_task` | 给任务追加运行时笔记/中间发现 | 可选,长任务用 |

### 3.2 工具 Schema 详细定义

```ts
// 1. list_pending_tasks
{
  name: "list_pending_tasks",
  description: "列出当前项目所有 status=dispatched 的待执行任务",
  inputSchema: {
    type: "object",
    properties: {
      priority: { type: "string", enum: ["P0", "P1", "P2"], description: "可选,按优先级过滤" }
    }
  }
  // 返回: [{ id, title, priority, riskLevel, createdAt }, ...]
}

// 2. get_task
{
  name: "get_task",
  description: "获取指定任务的完整执行上下文,包括描述/截图引用/关联文件/worktree 路径/initial prompt",
  inputSchema: {
    type: "object",
    properties: {
      taskId: { type: "string", description: "任务 ID, 形如 WS-001" }
    },
    required: ["taskId"]
  }
  // 返回: {
  //   id, title, description, riskLevel, priority,
  //   worktreePath: "D:\\...\\rpp-web\\.ai-workspaces\\ws-001",
  //   relatedFiles: [...],
  //   acceptanceCriteria: [...],
  //   imageRefs: [{path, description}, ...],
  //   prompt: "拼好的初始 prompt,Claude 直接照办即可"
  // }
  //
  // 副作用: 任务标记为 "Claude 已拉取",看板显示"执行中"
}

// 3. record_result
{
  name: "record_result",
  description: "任务执行完成或受阻时调用此工具回写结果。完成后必须调用",
  inputSchema: {
    type: "object",
    properties: {
      taskId: { type: "string" },
      status: { type: "string", enum: ["done", "partial", "blocked"] },
      changedFiles: {
        type: "array",
        items: { type: "string" },
        description: "改动的文件列表(相对项目根的路径)"
      },
      notes: { type: "string", description: "改动说明: what & why" },
      reviewPoints: {
        type: "array",
        items: { type: "string" },
        description: "建议人工复查的关键点(可选)"
      },
      blockedReason: {
        type: "string",
        description: "status=blocked 时必填,说明阻塞原因"
      }
    },
    required: ["taskId", "status", "notes"]
  }
  // 返回: { ok: true, message: "Result recorded. Task moved to review." }
  //
  // 副作用: 看板任务自动进入"审核中"列,触发 git diff 计算
}

// 4. get_task_diff
{
  name: "get_task_diff",
  description: "获取当前任务 worktree 相对于 main 分支的 git diff(可在自检时调用)",
  inputSchema: {
    type: "object",
    properties: {
      taskId: { type: "string" }
    },
    required: ["taskId"]
  }
  // 返回: { diff: "diff --git ...", stats: { additions, deletions, files } }
}

// 5. add_note_to_task
{
  name: "add_note_to_task",
  description: "在执行过程中给任务追加笔记/中间发现(用于长任务过程记录)",
  inputSchema: {
    type: "object",
    properties: {
      taskId: { type: "string" },
      note: { type: "string" }
    },
    required: ["taskId", "note"]
  }
}
```

### 3.3 MCP Server 启动方式

**选项 A: stdio 模式 (推荐 MVP)**

工具通过 `npx` 或本地脚本暴露 MCP server,Claude Code 通过 `~/.claude.json` 配置:

```json
{
  "mcpServers": {
    "ai-task-flow": {
      "command": "node",
      "args": ["D:/path/to/ai-task-flow/backend/dist/mcp-server.js"]
    }
  }
}
```

每次 Claude Code 启动时,自动起一个 MCP server 进程与之绑定。

**选项 B: HTTP/SSE 模式**

后期可改 HTTP 模式,作为长驻服务运行,Claude Code 通过 URL 连接:

```json
{
  "mcpServers": {
    "ai-task-flow": {
      "url": "http://localhost:3002/mcp",
      "transport": "sse"
    }
  }
}
```

MVP 用 stdio (简单 + 自动生命周期管理),v0.2 评估是否需要 HTTP。

### 3.4 MCP Server 与 HTTP 服务的关系

工具同时跑两个 server,共享同一个 domain/application/infrastructure:

- **HTTP server (Fastify)**: 看板前端 + 用户操作 (派发、审查、配置)
- **MCP server (stdio)**: Claude Code 拉任务 + 回写

它们读写同一个 `~/.ai-task-flow/tasks.json`,通过 EventBus 互通:

```
Claude 调 record_result (经 MCP)
  ↓
MCP interface → application.RecordResultUseCase
  ↓
domain.Task.recordResult() → 发布 TaskResultRecordedEvent
  ↓
EventBus 广播
  ↓
HTTP/SSE interface 监听到事件 → 推送给前端看板
  ↓
看板自动刷新
```

---

## 四、战术设计 (Tactical Design)

### 4.1 Workflow Context 领域模型

#### Task 聚合根 (v3 简化版)

```ts
class Task {
  private id: TaskId;
  private title: string;
  private description: string;
  private status: TaskStatus;
  private priority: Priority;
  private projects: Project[];
  private images: ImageRef[];
  private relatedFiles: FilePath[];
  private acceptanceCriteria: string[];
  private worktree?: WorktreeRef;  // 派发后绑定
  private executionResult?: ExecutionResult;  // MCP record_result 写入
  private reviewDecision?: ReviewDecision;

  dispatch(worktree: WorktreeRef): TaskDispatchedEvent {
    if (this.status !== TaskStatus.TODO) throw new Error('只有待办任务可派发');
    this.worktree = worktree;
    this.status = TaskStatus.DISPATCHED;
    return new TaskDispatchedEvent(this.id, worktree);
  }

  recordResult(result: ExecutionResult): TaskResultRecordedEvent {
    if (this.status !== TaskStatus.DISPATCHED) throw new Error('只有已派发任务可记录结果');
    this.executionResult = result;
    this.status = TaskStatus.REVIEW;
    return new TaskResultRecordedEvent(this.id, result);
  }

  approve(mergeStrategy: 'merge' | 'keep_branch'): TaskApprovedEvent { ... }
  reject(reason: string): TaskRejectedEvent { ... }
}
```

#### TaskStatus 状态机

```ts
enum TaskStatus {
  PLANNING = 'planning',   // 待规划
  TODO = 'todo',           // 待办
  DISPATCHED = 'dispatched', // 已派发(worktree 已创建, 等 Claude 拉取)
  REVIEW = 'review',       // 审核中(Claude 已回写)
  DONE = 'done',           // 已完成
  BLOCKED = 'blocked',     // 已阻塞
}
```

简化说明: v2 的 RUNNING 状态在 v3 不需要（v2 是 Agent SDK 启动 session 后的状态，v3 没有 session 概念）。Claude 拉取任务瞬间仍标记 DISPATCHED，直到它回写才进 REVIEW。

> ⚠️ **已演进为四态**：现状为 `TODO` / `IN_PROGRESS` / `DONE` / `BLOCKED`（已去掉 `planning` / `dispatched` / `review`，会话化不再走「派发→审核」两段式）。详见 [避坑约定第三节](20260723130001_项目避坑与约定.md) 与 [MCP_TOOLS_GUIDE](MCP_TOOLS_GUIDE.md)。

### 4.2 目录结构 (v3 精简版)

```
ai-task-flow/
├── frontend/                # Vue 3 + TS + Vite (与 v2 相同)
│   ├── src/modules/workflow/  # 看板 + 卡片 + Diff 审查
│   └── ...
│
├── backend/
│   ├── src/
│   │   ├── domain/
│   │   │   ├── workflow/      # Task, Template, WorktreeRef
│   │   │   └── _shared/       # EventBus, DomainEvent
│   │   ├── application/
│   │   │   ├── workflow/      # CreateTask, DispatchTask, RecordResult, ReviewTask
│   │   │   └── mcp/           # ✅ 新增: MCP 用例 (GetTaskUseCase, RecordResultViaM CPUseCase)
│   │   ├── infrastructure/
│   │   │   ├── persistence/   # TaskRepository (JSON)
│   │   │   ├── git/           # WorktreeManager, DiffCalculator
│   │   │   └── pubsub/        # InMemoryEventBus
│   │   ├── interfaces/
│   │   │   ├── http/          # REST API + SSE (前端)
│   │   │   └── mcp/           # ✅ MCP Server (Claude)
│   │   │       ├── server.ts  # MCP JSON-RPC 协议实现
│   │   │       └── tools/     # list_pending_tasks, get_task, record_result
│   │   └── server.ts
│   └── package.json
│
├── shared/types/
├── ~/.ai-task-flow/
└── 各项目/.ai-workspaces/<task-id>/
```

---

## 五、技术选型汇总

| 层 | 技术 | v3 变化 |
|----|------|--------|
| 前端框架 | Vue 3 + TS + Vite + Element Plus | 不变 |
| 后端框架 | Fastify | 不变 |
| **MCP 实现** | **@modelcontextprotocol/sdk** | **新增** |
| Git 操作 | simple-git | 不变 |
| 数据校验 | Zod | 不变(MCP 工具 inputSchema) |
| 数据持久化 | JSON 文件 + EventStore | 不变 |
| 实时通信 | SSE | v2 的 WebSocket 降级回 SSE (单向足够) |
| Diff 渲染 | diff2html-vue3 | 不变 |
| 依赖注入 | tsyringe | 不变 |
| **删除的依赖** | ~~Agent SDK~~ / ~~ws~~ | v2 有, v3 不需要 |

---

## 六、迭代路线图

### MVP (约 2-3 周, 比 v2 少 1 周)

**Week 1**: 基础架构
- 项目初始化 + DDD 骨架
- WorktreeManager + simple-git 集成
- 任务 CRUD (Workflow 域)

**Week 2**: MCP Server
- 学习 `@modelcontextprotocol/sdk` (官方 SDK)
- 实现 5 个 MCP 工具
- stdio 模式启动脚本
- 用 MCP Inspector 测试

**Week 3**: 前端与收尾
- 看板 + 卡片 + Diff 审查
- SSE 推送 (比 v2 简单)
- E2E 跑通: 录入 → 派发 → Claude 拉取 → 回写 → 审查
- 文档 (用户配置 ~/.claude.json)

### v0.2 (约 1 周): 多任务并发

同 v2 路线图,worktree 天然支持并发。

### v0.3+: 统计看板、Plugin 集成、邮件分发

按需扩展。

---

## 七、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| MCP SDK API 变更 | MCP 工具失效 | 封装在 interfaces/mcp/ 一处,升级时只改这层 |
| Claude 忘记调 record_result | 任务卡在 dispatched | 兜底: 提供手动"标记完成"按钮;看板上显示"已派发 X 小时,无回写" |
| stdio 进程管理复杂 | 启动失败 / 僵尸进程 | MVP 用简单的 node 启动;v0.2 可改 HTTP 长驻服务 |
| Git worktree 残留 | 磁盘膨胀 | cleanupOrphans + 定期清理已完成 > 7 天的 worktree |
| 用户忘记配置 ~/.claude.json | Claude 调不到工具 | 首次启动检测,生成配置模板,指导用户 |
| 跨项目拉错任务 | Claude 在 A 项目拉到 B 项目任务 | MCP server 只暴露当前项目任务(通过 cwd 判断) |

---

## 八、设计验证结论

v3 是基于三轮调研 + 用户明确诉求("我是否可以不使用项目的 agent,又能让他根据 md 执行完成后能够更新状态")推导出的最终形态。

**v1→v2→v3 演进逻辑**:

1. **v1**: 文件传递 + YAML+正则 → 调研证明是反模式
2. **v2**: Agent SDK 嵌入 → 调研证明可行,但用户实测后发现"失去原生 Claude Code 体验"
3. **v3**: MCP 协议协作 → 保持原生 + 自动同步 + 结构化回写,三者兼得

**符合 2024-2025 最佳实践**:
- ✅ DDD 四层 + Bounded Context
- ✅ Git worktree 隔离 (业界竞品共识)
- ✅ Structured output / 工具调用 (MCP schema)
- ✅ MCP 官方协议 (Anthropic 主推)
- ✅ 事件驱动跨域协作 (EventBus + EventStore)

**相比 v2 的优势**:
- ✅ 更轻 (少 30% 代码量: 无 Agent SDK / WebSocket / Approval 往返)
- ✅ 更稳 (不重新发明 Claude Code 已有能力)
- ✅ 更通用 (跨 IDE: Cursor/Cline 都能接)
- ✅ 更纯粹 (工具做工具该做的事: 看板 + worktree + 状态;AI 体验交给专业工具)

---

## 九、附录

### 9.1 用户配置示例

`.claude.json` (项目根或用户家目录):

```json
{
  "mcpServers": {
    "ai-task-flow": {
      "command": "node",
      "args": [
        "D:/xunfei/zyjg/ai-task-flow/backend/dist/mcp-server.js"
      ],
      "env": {
        "AI_TASK_FLOW_PROJECT": "${workspaceFolder}"
      }
    }
  }
}
```

### 9.2 Claude Code 典型对话示例

```
用户: 拉一下 WS-001

Claude: 我通过 ai-task-flow 拉取了任务 WS-001 "修复登录按钮宽度"。
        任务详情:
        - 描述: 登录按钮在长文案下文字溢出...
        - worktree: D:\xunfei\zyjg\rpp-web\.ai-workspaces\ws-001
        - 相关文件: src/views/login/Login.vue
        
        我现在切换到该 worktree 开始工作。
        
        [执行 cd, Read Login.vue, Edit, 测试...]
        
        已完成修改,正在记录结果...
        
        [调用 record_result 工具]
        
        任务已标记完成并回写到看板,请到审核页面查看 git diff。
```

### 9.3 术语表

| 术语 | 含义 |
|------|------|
| MCP | Model Context Protocol, Anthropic 推出的 AI 客户端与工具集成协议 |
| stdio 模式 | MCP server 通过标准输入输出与客户端通信,进程生命周期绑定 |
| Worktree | git 的独立工作目录,一个仓库可有多个,各自独立分支 |
| Bounded Context | DDD 的限界上下文,一个领域的边界 |
| Aggregate Root | 聚合根,一致性边界的入口 |
| Domain Event | 领域事件,跨域协作的载体 |

### 9.4 参考资料

- [MCP 官方文档](https://modelcontextprotocol.io/)
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)
- [Claude Code MCP 集成指南](https://code.claude.com/docs/en/mcp)
- [Backlog.md MCP 实现参考](https://github.com/MrLesk/Backlog.md)
- [simple-git 文档](https://github.com/steveukx/git-js)

---

**文档结束。下一步: 待用户审阅通过后, 移交 writing-plans 技能生成详细实施计划。**
