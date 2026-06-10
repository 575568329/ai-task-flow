# AI Task Flow - 设计文档 v2

**项目名称**: ai-task-flow
**版本**: v2.0 Design (基于业界调研重写)
**日期**: 2026-06-05
**远程仓库**: git@github.com:575568329/ai-task-flow.git
**分支**: main
**架构风格**: Domain-Driven Design (DDD) + Clean Architecture

> v1 文档已归档至同目录 `2026-06-05-ai-task-flow-design.v1-archived.md`,作为历史记录保留。本文档基于三轮外部调研(竞品/技术机制/官方 SDK 能力)推翻并修正了 v1 的关键假设,详见第二章"v1→v2 关键修正"。

---

## 一、项目定位与边界

### 1.1 一句话定位

> 个人 AI 工作台。在网页看板上录入工作任务,点一下让 Claude 在隔离的 git worktree 里执行,你能实时看 Claude 干活、随时插话纠偏、关键操作前审批,执行完通过结构化工具回写到看板,最后审 diff 决定合并还是丢弃。

### 1.2 与 v1 的核心差异

v1 把工具定位为"AI 输入预处理器"——你在工具里准备好任务,然后**自己**到终端跑 Claude Code 执行。

v2 把工具升级为"AI 执行平台"——工具**内嵌**一个聊天窗,通过 Claude Agent SDK 直接驱动 Claude,你在工具里就完成全流程,不需要切终端。

这个定位变化来自两个调研发现:
1. Vibe Kanban 的源码已经实证了"实时看 + 插话 + 审批"完全可行
2. Claude Agent SDK (TypeScript) 把这套能力封装得比 stream-json CLI 协议更易用

### 1.3 价值主张

- **看板视角**: 散落的工作集中管理,看清楚每个任务在哪个状态
- **AI 协作视角**: 不是"扔给 AI 然后等结果",而是"边看边聊边纠偏"的真正人机协作
- **隔离视角**: 每个任务独立 worktree,失败可丢弃,主分支永远干净

### 1.4 MVP 边界 (YAGNI)

**MVP 包含**:
- 任务 CRUD (Kanban 看板 + 卡片详情)
- 模板系统 (Markdown 模块化拼装)
- 多项目过滤 (一个看板看全部项目,可按项目过滤)
- 截图管理 (粘贴/拖拽 + 本地存储)
- 任务派发 (创建 worktree + 启动 Agent SDK session)
- **嵌入式聊天窗** (流式查看 Claude 执行,支持插话/中断/审批)
- **结构化回写** (Claude 通过自定义工具回写任务状态,token 级 schema 保证)
- Diff 审查 (在工具内查看 worktree 的 git diff,决定合并或丢弃)
- DDD 四层架构 + 5 Bounded Context 预留

**MVP 暂不做** (后续版本):
- ❌ Agent 多人格 (一个任务 = 一个默认人格)
- ❌ Skills / MCP 安装管理
- ❌ 邮件收取分发
- ❌ 数据统计看板
- ❌ 多任务并发执行 (MVP 单任务串行,worktree 已为并发预留)
- ❌ 团队协作 / 云同步

### 1.5 5 个 Bounded Context (前瞻)

| Bounded Context | 职责 | 状态 |
|----------------|------|------|
| **Workflow** | 任务录入、派发、回写、审查、归档 | ✅ MVP 实现 |
| **Agent** | Agent SDK session 管理、对话、人格、工具审批 | ✅ MVP 实现 (基础) |
| **Analytics** | 统计看板、AI 执行成功率、时序报表 | 🔜 v0.3 |
| **Plugin** | Skills/MCP 安装与管理 | 🔜 v0.4 |
| **Messaging** | 邮件收取、Slack/飞书集成 | 🔜 v0.4 |

注意 v2 与 v1 的差异: v1 把 Agent 完全推到未来版本,v2 因为 Agent SDK 已是 MVP 的核心机制,Agent Context 必须随 MVP 一起实现基础能力。

---

## 二、v1 → v2 关键修正

基于三轮调研(竞品现状/AI 交互机制/Agent SDK 能力),v1 设计有以下关键假设被推翻或修正:

| # | v1 假设 | v2 实情 | 修正 |
|---|---------|---------|------|
| 1 | 这是新想法,产品定位独特 | Vibe Kanban、Backlog.md、spec-kitty、agetor 等 6+ 个直接竞品已存在;Vibe Kanban 已关停(商业模式问题,非技术失败) | 自建合理但要明确差异化(个人极简+截图富输入+未来扩展);抄 Vibe Kanban 思路用 Node/TS 替代 Rust |
| 2 | 全自动派发不可行,Claude Code 需人工权限确认 | **完全可行**: Agent SDK 提供 `canUseTool` 回调、`permissionMode`、`allowed_tools` 白名单、Hooks 机制 | 派发改为"工具内嵌聊天窗+实时驱动 Claude",不再"生成命令让用户去终端粘贴" |
| 3 | AI 用 YAML+HTML 注释回写,工具用正则解析 | **业界明确反模式**(Snyk:"fails regularly"); structured output / 工具调用 token 级 schema 保证才是正解 | 改为 Claude 调用自定义工具回写,canUseTool 拦截拿到 schema 化结构数据 |
| 4 | 工具直接写项目目录,任务之间无隔离 | 所有严肃竞品都用 git worktree(每任务独立分支+工作目录),失败可丢弃、可 reset、多任务可并发不冲突 | **必须补 git worktree 隔离**,这是基础设施层 |
| 5 | 文件监听 (chokidar) + YAML 解析做状态同步 | Agent SDK 直接给消息事件,毫秒级,无文件竞态/原子写问题 | 状态同步改走 Agent SDK 事件流,文件监听仅保留兜底场景 |
| 6 | SSE 单向推送即可 | 需要"插话"(用户→Agent)和"审批"(Agent→用户),双向通信 | 改用 WebSocket 替代 SSE |
| 7 | 半自动 + 全自动两套并行(混合) | Agent SDK 让全自动稳定可靠,两套割裂反而复杂 | 单一路径: SDK 驱动 + 人工审批工具调用,审批粒度由用户配置 |

**未变的部分**:
- DDD 四层架构与 5 Bounded Context 战略设计 ✅
- Vue 3 + TS + Element Plus 前端栈 ✅
- 双层存储(源数据 + 项目目录产物) ✅ (产物从 task.md/result.md 改为 worktree 内的实际代码改动 + 元数据 JSON)
- 看板 + 卡片详情 + 抽屉的交互形态 ✅

---

## 三、产品形态与核心交互

### 3.1 整体使用流程

```
1. 录入: 看板新建任务,填写标题/描述/截图/关联文件/验收标准
2. 派发: 点"派发" → 后端在目标项目创建 git worktree + 新分支
                   → 启动 Agent SDK session,绑定到该 worktree
                   → 前端打开聊天窗
3. 执行: Claude 在聊天窗里流式输出思考/工具调用/文本
        → 用户实时观察,可随时插话纠偏("等等,先看看 a.ts")
        → 高风险工具(Edit/Bash)弹审批,用户点确认或修改参数
        → Claude 调用 record_task_result 工具,带 schema 化结果
4. 审查: 任务进入"审核中",看板显示 worktree 的 git diff
        → 用户审 diff,决定通过或打回
5. 归档:
   通过: 合并 worktree 到主分支(可选 PR/直接合并),清理 worktree
   打回: 丢弃 worktree,任务回到"待办",附打回理由
```

### 3.2 嵌入式聊天窗 (核心创新点)

这是 v2 与 v1 最大的产品形态差异。聊天窗具备:

- **流式输出**: Claude 的 thinking 块、tool_use、tool_result、text 逐条实时显示
- **插话能力**: 用户可在 Claude 执行任意时刻发新消息,Claude 在下一个 turn 处理
- **中断能力**: "停一下"按钮 → 调 `q.interrupt()` 优雅停止 / "强制取消"按钮 → 调 `abortController.abort()`
- **工具审批**: Claude 要执行 Edit/Bash 等关键工具时,聊天窗弹审批气泡,用户可批准/拒绝/修改参数
- **会话恢复**: 每个任务对应一个 session_id,关闭浏览器/重启工具后,可用 `resume: sessionId` 续接对话

### 3.3 三种风险等级的派发模式

不再是 v1 的"半自动 vs 全自动"二选一,而是按任务的 `riskLevel` 字段自动决定 `canUseTool` 的策略:

| Risk Level | canUseTool 策略 | 适用场景 |
|-----------|----------------|---------|
| **low** | 全部 allow,只在 Bash 删除类命令时 deny | 改样式/文案、加注释、重命名变量 |
| **medium** | Edit/Bash 弹审批,Read/Glob/Grep 自动 allow | 改业务逻辑、新增小功能 |
| **high** | 所有工具调用都弹审批 | 改核心模块、动数据库 schema、生产配置 |

用户在新建任务时选 risk level(默认 medium),也可在卡片详情里随时调整。

### 3.4 双层存储模型 (修订)

| 层 | 位置 | 存什么 | 谁读写 |
|----|------|-------|--------|
| **源数据层** | `~/.ai-task-flow/` | tasks.json / templates.json / projects.json / images/ / sessions/ | 工具独占 |
| **产物层** | 每个项目的 `.ai-workspaces/<task-id>/` worktree | 实际代码改动(由 git 管理) + meta.json (任务元数据快照) | 工具创建,Claude 在 worktree 里改代码,工具读 git diff |

v1 的 task.md / result.md 文件在 v2 中**不再需要**——任务描述通过 Agent SDK 直接传给 Claude,执行结果通过 canUseTool 拦截结构化工具调用拿到。

## 四、战略设计 (Strategic Design)

### 4.1 Bounded Context 地图

```
┌─────────────────────────────────────────────────────────────┐
│                     Shared Kernel                            │
│  (跨域共享: EventBus, UserId, ProjectId, TaskId, SessionId)  │
└─────────────────────────────────────────────────────────────┘
        ↓                ↓              ↓            ↓
┌──────────────┐  ┌──────────────┐  ┌────────┐  ┌──────────┐
│   Workflow   │  │    Agent     │  │ Plugin │  │ Messaging│
│   Context    │  │   Context    │  │Context │  │ Context  │
├──────────────┤  ├──────────────┤  ├────────┤  ├──────────┤
│ Task         │  │ AgentSession │  │ Skill  │  │ Email    │
│ Template     │  │ Conversation │  │ MCP    │  │ Slack    │
│ Worktree     │  │ Persona      │  │ Plugin │  │ Feishu   │
│ ReviewResult │  │ Approval     │  │        │  │          │
└──────────────┘  └──────────────┘  └────────┘  └──────────┘
   ↑    ↓             ↑    ↓                        ↑   ↓
   依赖 Agent Context  Workflow 域订阅 Agent 事件
        ↓                ↓                           ↓
┌─────────────────────────────────────────────────────────────┐
│                   Analytics Context                          │
│  (Read Model: 聚合所有域的事件构建统计视图)                    │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Workflow ↔ Agent 双向协作 (新增)

v2 引入了 Workflow 与 Agent Context 的紧密协作。两者通过领域事件通信,不直接 import:

```
Workflow Context                       Agent Context
─────────────────                      ─────────────────
DispatchTaskUseCase
  → 创建 Worktree
  → 发布 TaskDispatched 事件 ─────→ OnTaskDispatchedHandler
                                       → 启动 AgentSession (Agent SDK)
                                       → 绑定 worktree 路径
                                       → 发布 SessionStarted 事件
OnSessionStartedHandler ←──────────
  → 任务状态: dispatched → running

                                     SessionMessageReceived 事件
OnSessionMessageHandler  ←──────────  (Agent 流式输出每条消息)
  → 通过 WebSocket 推前端聊天窗

                                     ToolApprovalRequested 事件
OnToolApprovalHandler  ←─────────────  (canUseTool 触发,等用户审批)
  → 推前端弹审批气泡
  → 收到审批结果
  → 发回 Agent Context
                                       → 继续执行或拒绝

                                     TaskResultRecorded 事件
OnTaskResultRecordedHandler  ←──────  (Claude 调用 record_task_result)
  → 任务状态: running → review
  → 触发 git diff 计算
```

### 4.3 跨域协作未来扩展示例

未来加入 Messaging 与 Analytics 时的事件流:

```
邮件 → 任务 → Agent → 统计

Messaging.EmailReceived
  → Workflow.OnEmailReceivedHandler 创建 Task
  → Workflow.TaskCreated
  → Workflow.OnTaskCreated 自动派发(可配置)
  → Workflow.TaskDispatched
  → Agent.OnTaskDispatched 启动 session
  → ... (执行流) ...
  → Workflow.TaskCompleted
  → Analytics.OnTaskCompleted 更新统计指标
```

新增任何域 = 订阅已有事件 + 发布新事件,**不改任何老代码**。

---

## 五、整体技术架构

```
┌─────────────────────────────────────────────────────────────┐
│  浏览器前端 (Vue 3 + TS + Vite + Element Plus)                │
│  ┌──────────┐ ┌──────────┐ ┌─────────────┐ ┌──────────────┐ │
│  │ 看板视图 │ │ 卡片详情 │ │ 嵌入式聊天窗 │ │ Diff 审查视图 │ │
│  └──────────┘ └──────────┘ └─────────────┘ └──────────────┘ │
│         │ HTTP (CRUD)         │ WebSocket (双向流式 + 审批)  │
└─────────┼─────────────────────┼─────────────────────────────┘
          ▼                      ▲
┌─────────────────────────────────────────────────────────────┐
│  本地 Node 服务 (Fastify + ws)                                 │
│  ┌────────────┐ ┌────────────┐ ┌─────────────────────────┐   │
│  │ REST API   │ │ WebSocket  │ │ Agent SDK Orchestrator  │   │
│  │ (任务CRUD) │ │ Hub        │ │ (query/canUseTool/...)  │   │
│  └────────────┘ └────────────┘ └─────────────────────────┘   │
│  ┌─────────────────┐ ┌─────────────────┐ ┌───────────────┐   │
│  │ Worktree Manager│ │ Diff Calculator │ │ EventBus      │   │
│  │ (git worktree)  │ │ (simple-git)    │ │ (in-memory)   │   │
│  └─────────────────┘ └─────────────────┘ └───────────────┘   │
└──────────┬───────────────────────────────────┬───────────────┘
           ▼ 读写源数据                          ▼ 操作 git
┌──────────────────────┐         ┌──────────────────────────────┐
│ ~/.ai-task-flow/      │         │ 各项目根目录                   │
│  ├── tasks.json       │         │ rpp-web/                       │
│  ├── templates.json   │         │  ├── (主分支代码)              │
│  ├── projects.json    │         │  └── .ai-workspaces/           │
│  ├── sessions/        │         │       └── <task-id>/           │
│  │   └── <id>.json    │         │           ├── (worktree代码)    │
│  ├── images/          │         │           └── meta.json        │
│  └── event-store.jsonl│         │ crowdsourced-new-web/...       │
└──────────────────────┘         └──────────────────────────────┘
```

**关键依赖说明**:
- `@anthropic-ai/claude-agent-sdk` (Node) — Claude 编程驱动核心
- `simple-git` — git worktree 管理与 diff 计算
- `ws` — WebSocket 服务端
- `fastify` — HTTP 框架,轻量、TS 友好
- `tsyringe` — DI 容器,支持 DDD Repository/Service 替换
## 六、Agent SDK 集成详解 (核心机制)

### 6.1 一次任务执行的完整调用骨架

```ts
// backend/src/infrastructure/agent/AgentSdkRunner.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// 用户消息流(支持插话)
async function* createUserMessageStream(initialPrompt: string, ws: WebSocket) {
  yield initialPrompt;

  // 监听前端 WebSocket 推来的"插话"消息
  for await (const message of ws.messages()) {
    if (message.type === "user_interject") {
      yield message.content;
    }
  }
}

// 任务结果回写工具的 schema (Zod)
const RecordResultSchema = z.object({
  status: z.enum(["done", "partial", "blocked"]),
  changedFiles: z.array(z.string()),
  notes: z.string(),
  reviewPoints: z.array(z.string()).optional(),
  blockedReason: z.string().optional(),
});

export async function runAgentSession(
  task: Task,
  worktreePath: string,
  ws: WebSocket,
  abortController: AbortController,
) {
  const messageStream = createUserMessageStream(buildInitialPrompt(task), ws);

  const q = query({
    prompt: messageStream,
    options: {
      cwd: worktreePath,
      includePartialMessages: true,
      abortController,

      // 自定义工具: Claude 用来回写结构化结果
      tools: [{
        name: "record_task_result",
        description: "在完成任务后调用此工具,记录执行结果",
        inputSchema: RecordResultSchema,
      }],

      // 工具调用前的人工审批
      canUseTool: async (toolName, input, { suggestions }) => {
        // 低风险任务: 直接放行常规工具
        if (task.riskLevel === "low" && !isDangerousBash(toolName, input)) {
          return { behavior: "allow" };
        }

        // record_task_result 不需审批,直接放行
        if (toolName === "record_task_result") {
          return { behavior: "allow" };
        }

        // 推审批请求到前端,等用户决定
        const decision = await ws.requestApproval({
          toolName,
          input,
          suggestions,
        });

        return decision; // { behavior: "allow" | "deny", updatedInput?, message? }
      },

      // 系统提示词,告诉 Claude 任务规则
      systemPrompt: `你是一个代码任务执行助手。
- 完成任务后必须调用 record_task_result 工具记录结果
- 如果遇到无法继续的阻塞,status 设为 blocked 并填 blockedReason
- 改文件前先 Read 确认
- 完成后简要说明改动`,

      permissionMode: task.riskLevel === "high" ? "ask" : "acceptEdits",
    },
  });

  // 流式转发每条消息到前端
  let recordedResult: z.infer<typeof RecordResultSchema> | null = null;

  for await (const msg of q) {
    // 转发给前端聊天窗渲染
    ws.send({ type: "agent_message", payload: msg });

    // 拦截 Claude 调用 record_task_result 的输入
    if (msg.type === "assistant" && msg.message.content) {
      for (const block of msg.message.content) {
        if (block.type === "tool_use" && block.name === "record_task_result") {
          recordedResult = RecordResultSchema.parse(block.input);
        }
      }
    }
  }

  return recordedResult;
}
```

### 6.2 关键 API 速查

| 能力 | API/参数 | 用途 |
|------|---------|------|
| 流式输出 | `query({...}).then(for await)` 返回 AsyncGenerator | 逐条拿 Claude 的每个 message |
| 显示思考块 | `forwardSubagentText: true` | 让 thinking 内容也流出来 |
| 文本流增量 | `includePartialMessages: true` | 不等整段完成就开始显示 |
| 多轮插话 | `prompt: AsyncIterable<string>` | streaming input mode |
| 优雅中断 | `q.interrupt()` | 当前 turn 完成后停止 |
| 强制取消 | `abortController.abort()` | 立即终止进程 |
| 工具审批 | `canUseTool` 回调 | 返回 allow/deny/updatedInput |
| 工具白名单 | `allowedTools: string[]` | 只允许指定工具 |
| 权限模式 | `permissionMode: 'default'\|'acceptEdits'\|'bypassPermissions'\|'ask'` | 整体策略 |
| 自定义工具 | `tools: [{ name, description, inputSchema }]` | 让 Claude 调用回写状态 |
| Session 恢复 | `resume: sessionId` 或 `continue: true` | 关闭后续接 |
| 工作目录 | `cwd: worktreePath` | Claude 在哪里执行 |
| 系统提示 | `systemPrompt: string` | 任务规则、人格 |

### 6.3 已知约束与 Workaround

| 约束 | 说明 | Workaround |
|------|------|-----------|
| 插话不能打断当前工具执行 | Claude 在当前 turn 完成后才处理新消息 | 想立即打断: 先 `interrupt()` 再推消息 |
| 工具参数改写后立即执行 | `updatedInput` 改完直接执行,无二次预览 | `permissionMode: 'ask'` 让用户先编辑参数再确认 |
| 长任务超时风险 | Agent 可能跑很久 | 设 abortController 超时上限 + 关键 step hook |
| Windows 上 chokidar issue | `awaitWriteFinish` 在 Windows 有 bug | v2 主路径不依赖文件监听,影响小 |

---

## 七、AI 回写协议 (修订: 从 YAML 文件到结构化工具)

### 7.1 不再使用文件回写

v1 的方案: AI 在 task.md 末尾填 YAML → 工具 chokidar 监听 → 正则解析。

v2 的方案: AI 调用 `record_task_result` 工具 → canUseTool 拦截 input → 工具直接拿到 schema 化的 JSON 对象。

### 7.2 工具 Schema 定义 (Zod)

```ts
const RecordResultSchema = z.object({
  status: z.enum(["done", "partial", "blocked"])
    .describe("任务完成状态"),
  changedFiles: z.array(z.string())
    .describe("改动的文件列表(相对项目根的路径)"),
  notes: z.string()
    .describe("改动说明: what & why"),
  reviewPoints: z.array(z.string()).optional()
    .describe("需要人工复查的点"),
  blockedReason: z.string().optional()
    .describe("阻塞原因(status=blocked 时必填)"),
});
```

### 7.3 为什么这样更好

1. **格式 100% 保证**: Claude 调用工具时,SDK 强制 input 满足 schema(Zod 校验),不会再有"YAML 缩进错乱""枚举值写错"这类反模式失败。
2. **零解析代码**: 不需要正则、不需要兜底降级。直接 `RecordResultSchema.parse(block.input)`。
3. **实时性**: 工具调用是同步事件,毫秒级拿到。不需要监听文件、防抖、awaitWriteFinish。
4. **可追溯**: 工具调用记录天然存在 session 历史里,事后回放方便。

## 八、Git Worktree 隔离机制 (v1 漏掉的关键基础设施)

### 8.1 为什么必须有

调研发现所有严肃竞品(Vibe Kanban、agetor、spec-kitty)都用 git worktree。它解决的核心问题:

- **改坏可丢弃**: AI 改炸了,删 worktree 即可,主分支零污染
- **多任务并发**: 未来 v0.2 同时跑多个任务时,各 worktree 独立,不会互相覆盖文件
- **干净 diff**: review 时只看本任务的改动,不掺其他工作中的修改
- **可 reset**: Vibe Kanban 会快照 `before_head_commit`,失败可一键回到执行前

### 8.2 Worktree 生命周期

```
创建 (派发任务时)
  - 在项目根目录的 .ai-workspaces/<task-id>/ 创建 worktree
  - 基于 main 分支,创建新分支 ai-task/<task-id>-<slug>
  - 写 meta.json 记录任务元数据
  - 快照 main 分支 HEAD commit (失败可 reset)

执行 (Agent SDK session 进行中)
  - Claude 在 worktree 里改代码
  - 文件改动天然隔离,不影响主分支

审查 (Claude 调用 record_task_result 后)
  - 工具计算 git diff main..ai-task/<task-id>
  - 前端展示 diff,用户审查

归档 - 通过
  - 选项 A: 直接 merge ai-task/<task-id> → main, 删 worktree
  - 选项 B: 保留分支等用户自己 PR, 只删 worktree
  - 选项 C: 不合并仅保留分支(用户自己手动处理)

归档 - 打回
  - 删 worktree, 删分支
  - 任务回到 todo, 附打回理由

清理过期
  - 已完成 > 7 天的 worktree 自动清理
  - 启动时扫一遍, 检测孤儿 worktree (无对应 task)
```

### 8.3 WorktreeManager 关键能力

```ts
class WorktreeManager {
  async create(projectPath: string, taskId: string, slug: string): Promise<WorktreePath>;
  async getDiff(worktreePath: string, baseBranch: string): Promise<DiffResult>;
  async mergeIntoMain(worktreePath: string, branch: string): Promise<void>;
  async destroy(worktreePath: string, branch: string): Promise<void>;
  async listAll(projectPath: string): Promise<Worktree[]>;
  async cleanupOrphans(projectPath: string, knownTaskIds: string[]): Promise<void>;
}
```

实现细节(借鉴 Vibe Kanban 经验):
- 用 `simple-git` 包封装 `git worktree add/remove/list`
- 创建/销毁时加路径锁(同一项目并发创建可能冲突)
- 销毁前检查 worktree 内是否有未提交改动,有则警告(防误删)
- 跨平台路径处理(Windows/Linux 差异)

### 8.4 .ai-workspaces 目录约定

```
<项目根>/
├── (项目原代码)
├── .gitignore (需追加 .ai-workspaces/)
└── .ai-workspaces/
    ├── ws-001/
    │   ├── (该任务的 worktree 检出代码)
    │   └── .ai-meta.json (任务 ID/标题/创建时间/risk level)
    ├── ws-002/
    └── ...
```

`.ai-workspaces/` 必须加进项目 `.gitignore`,工具首次接入时自动追加。

---

## 九、战术设计 (Tactical Design)

### 9.1 Workflow Context 领域模型

#### Task 聚合根

```ts
class Task {
  private id: TaskId;
  private title: string;
  private description: string;
  private status: TaskStatus;
  private priority: Priority;
  private riskLevel: RiskLevel;       // v2 新增: low/medium/high
  private projects: Project[];
  private images: ImageRef[];
  private relatedFiles: FilePath[];
  private acceptanceCriteria: string[];
  private worktree?: WorktreeRef;     // v2 新增: 派发后绑定 worktree
  private session?: SessionRef;       // v2 新增: 派发后绑定 Agent session
  private executionResult?: ExecutionResult;
  private reviewDecision?: ReviewDecision; // v2 新增: 通过/打回 + 理由

  dispatch(worktree: WorktreeRef, session: SessionRef): TaskDispatchedEvent {
    if (this.status !== TaskStatus.TODO) throw new Error('只有待办任务可派发');
    this.worktree = worktree;
    this.session = session;
    this.status = TaskStatus.RUNNING;  // v2: dispatched 改名 running 更准确
    return new TaskDispatchedEvent(this.id, worktree, session);
  }

  recordResult(result: ExecutionResult): TaskResultRecordedEvent {
    if (this.status !== TaskStatus.RUNNING) throw new Error('只有执行中任务可记录结果');
    this.executionResult = result;
    this.status = TaskStatus.REVIEW;
    return new TaskResultRecordedEvent(this.id, result);
  }

  approve(mergeStrategy: 'merge' | 'keep_branch' | 'manual'): TaskApprovedEvent {
    if (this.status !== TaskStatus.REVIEW) throw new Error('只有审核中任务可通过');
    this.reviewDecision = ReviewDecision.approved(mergeStrategy);
    this.status = TaskStatus.DONE;
    return new TaskApprovedEvent(this.id, mergeStrategy);
  }

  reject(reason: string): TaskRejectedEvent {
    if (this.status !== TaskStatus.REVIEW) throw new Error('只有审核中任务可打回');
    this.reviewDecision = ReviewDecision.rejected(reason);
    this.status = TaskStatus.TODO;
    this.executionResult = undefined;
    this.worktree = undefined;
    this.session = undefined;
    return new TaskRejectedEvent(this.id, reason);
  }
}
```

#### TaskStatus 状态机 (v2 修订)

```ts
enum TaskStatus {
  PLANNING = 'planning',     // 待规划
  TODO = 'todo',             // 待办
  RUNNING = 'running',       // 执行中 (v1: dispatched/doing 合并)
  REVIEW = 'review',         // 审核中
  DONE = 'done',             // 已完成
  BLOCKED = 'blocked',       // 已阻塞
}

enum RiskLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}
```

状态流转:

| 起点 | 终点 | 触发 |
|------|------|------|
| planning | todo | "标记待办" / 拖拽 |
| todo | running | "派发"按钮 (创建 worktree + Agent session) |
| running | review | Claude 调用 record_task_result 工具 |
| running | blocked | record_task_result 中 status=blocked |
| review | done | "通过" + 选合并策略 |
| review | todo | "打回" + 理由 (清空 worktree/session/result) |
| 任意 | blocked | "标记阻塞" + 原因 |
| blocked | todo | 拖拽回 |

### 9.2 Agent Context 领域模型

#### AgentSession 聚合根

```ts
class AgentSession {
  private id: SessionId;
  private taskId: TaskId;             // 关联的工作流任务
  private worktreePath: string;
  private persona: Persona;           // MVP 阶段使用默认 persona
  private status: SessionStatus;      // starting/running/paused/completed/aborted
  private conversation: Conversation; // 完整对话历史
  private pendingApprovals: ToolApproval[];

  start(): SessionStartedEvent { ... }
  receiveMessage(msg: AgentMessage): MessageReceivedEvent { ... }
  requestToolApproval(req: ToolApprovalRequest): ToolApprovalRequestedEvent { ... }
  resolveApproval(approvalId: string, decision: ApprovalDecision): void { ... }
  interrupt(): SessionInterruptedEvent { ... }
  abort(): SessionAbortedEvent { ... }
  recordResult(result: ExecutionResult): SessionCompletedEvent { ... }
}
```

#### 领域服务

## 十、目录结构 (v2 前瞻完整版)

```
ai-task-flow/
├── frontend/                       # Vue 3 + TS + Vite
│   ├── src/
│   │   ├── modules/                # 按 Bounded Context 组织
│   │   │   ├── workflow/           # ✅ MVP 核心
│   │   │   │   ├── views/          # KanbanBoard, ReviewView (Diff 审查)
│   │   │   │   ├── components/     # TaskCard, TaskDetailDrawer, DiffViewer
│   │   │   │   ├── stores/         # Pinia: tasks, projects, templates
│   │   │   │   ├── api/            # HTTP 调用 + WebSocket 客户端
│   │   │   │   └── types/
│   │   │   ├── agent/              # ✅ MVP 嵌入式聊天窗
│   │   │   │   ├── views/          # ChatView (任务详情内嵌)
│   │   │   │   ├── components/     # ChatStream, MessageBubble, ToolApprovalDialog
│   │   │   │   ├── stores/         # 当前 session 状态
│   │   │   │   └── types/          # AgentMessage, ToolUse, Approval
│   │   │   ├── analytics/          # 🔜 v0.3 数据看板
│   │   │   ├── plugins/            # 🔜 v0.4 Skills/MCP
│   │   │   ├── messaging/          # 🔜 v0.4 邮件集成
│   │   │   └── _shared/            # AppLayout, Sidebar, EventBus 客户端
│   │   ├── router/
│   │   └── App.vue
│   └── package.json
│
├── backend/                        # Node.js + Fastify + ws
│   ├── src/
│   │   ├── domain/                 # 领域层 (按 Context 拆, 无外部依赖)
│   │   │   ├── workflow/           # ✅ MVP
│   │   │   │   ├── entities/       # Task (聚合根), Template, ReviewDecision
│   │   │   │   ├── value-objects/  # TaskStatus, Priority, RiskLevel,
│   │   │   │   │                   # WorktreeRef, SessionRef, ExecutionResult
│   │   │   │   ├── services/       # MarkdownRenderer (拼任务初始 prompt)
│   │   │   │   └── events/         # TaskCreated, TaskDispatched,
│   │   │   │                       # TaskResultRecorded, TaskApproved...
│   │   │   ├── agent/              # ✅ MVP 基础
│   │   │   │   ├── entities/       # AgentSession (聚合根), Conversation, Persona
│   │   │   │   ├── value-objects/  # SessionStatus, ToolApproval, AgentMessage
│   │   │   │   ├── services/       # ApprovalCoordinator, ConversationFormatter
│   │   │   │   └── events/         # SessionStarted, MessageReceived,
│   │   │   │                       # ToolApprovalRequested, SessionCompleted
│   │   │   ├── plugin/             # 🔜
│   │   │   ├── messaging/          # 🔜
│   │   │   └── _shared/            # Shared Kernel: DomainEvent, EventBus 抽象
│   │   │
│   │   ├── application/            # 应用层 (用例编排)
│   │   │   ├── workflow/
│   │   │   │   ├── CreateTaskUseCase.ts
│   │   │   │   ├── DispatchTaskUseCase.ts          # 创建 worktree + 启 session
│   │   │   │   ├── ReviewTaskUseCase.ts            # 审核通过/打回
│   │   │   │   ├── ComputeDiffUseCase.ts
│   │   │   │   └── event-handlers/                 # 监听 Agent 域事件
│   │   │   │       ├── OnSessionStarted.ts
│   │   │   │       ├── OnTaskResultRecorded.ts
│   │   │   │       └── OnSessionAborted.ts
│   │   │   ├── agent/
│   │   │   │   ├── StartSessionUseCase.ts
│   │   │   │   ├── SendUserMessageUseCase.ts        # 用户插话
│   │   │   │   ├── ResolveApprovalUseCase.ts        # 用户审批结果
│   │   │   │   ├── InterruptSessionUseCase.ts
│   │   │   │   └── event-handlers/
│   │   │   │       └── OnTaskDispatched.ts          # 监听 Workflow.TaskDispatched
│   │   │   └── analytics/
│   │   │       └── projections/    # 🔜
│   │   │
│   │   ├── infrastructure/
│   │   │   ├── persistence/
│   │   │   │   ├── workflow/       # TaskRepository (JSON 文件)
│   │   │   │   ├── agent/          # SessionRepository
│   │   │   │   └── _shared/
│   │   │   │       ├── FileStore.ts
│   │   │   │       └── EventStore.ts (event-store.jsonl)
│   │   │   ├── agent-sdk/                          # ✅ Agent SDK 封装
│   │   │   │   ├── AgentSdkRunner.ts               # 调 query(), 处理流
│   │   │   │   ├── CanUseToolHandler.ts            # 桥接 ApprovalCoordinator
│   │   │   │   └── ResultRecordingTool.ts          # 自定义工具定义
│   │   │   ├── git/                                # ✅ Worktree 管理
│   │   │   │   ├── WorktreeManager.ts              # simple-git 封装
│   │   │   │   └── DiffCalculator.ts
│   │   │   ├── pubsub/             # InMemoryEventBus
│   │   │   └── messaging/          # 🔜 ImapAdapter
│   │   │
│   │   ├── interfaces/             # 接口层
│   │   │   ├── http/
│   │   │   │   ├── routes/
│   │   │   │   │   ├── workflow.routes.ts
│   │   │   │   │   ├── agent.routes.ts
│   │   │   │   │   └── git.routes.ts
│   │   │   │   └── controllers/
│   │   │   ├── websocket/                          # ✅ WebSocket Hub
│   │   │   │   ├── WsHub.ts                        # 连接管理
│   │   │   │   ├── AgentChannel.ts                 # 转发 agent 流
│   │   │   │   └── ApprovalChannel.ts              # 工具审批往返
│   │   │   └── cli/                # 预留
│   │   │
│   │   └── server.ts
│   └── package.json
│
├── shared/                         # 前后端共享 TS 类型
│   └── types/
│
├── ~/.ai-task-flow/                # 用户家目录数据
│   ├── tasks.json
│   ├── templates.json
│   ├── projects.json
│   ├── sessions/<id>.json          # 每个 session 历史快照
│   ├── images/
│   └── event-store.jsonl
│
├── 各项目/.ai-workspaces/<task-id>/  # worktree 与 meta
│
└── docs/plans/
    └── 2026-06-05-ai-task-flow-design.md
```

依赖方向铁律: `interfaces → application → domain ← infrastructure`。
domain 层无任何外部依赖,infrastructure 实现 domain 定义的接口。

---

## 十一、接口层设计

### 11.1 REST API

| 方法 | 路径 | 用例 |
|------|------|------|
| GET | `/api/tasks` | 任务列表 (project 过滤) |
| POST | `/api/tasks` | 新建任务 |
| GET | `/api/tasks/:id` | 任务详情 |
| PUT | `/api/tasks/:id` | 更新字段 |
| POST | `/api/tasks/:id/dispatch` | **派发: 创建 worktree + 启 session** |
| POST | `/api/tasks/:id/approve` | 审核通过 (含合并策略) |
| POST | `/api/tasks/:id/reject` | 打回 |
| GET | `/api/tasks/:id/diff` | 获取该任务 worktree 的 git diff |
| DELETE | `/api/tasks/:id` | 删除任务 |
| POST | `/api/images/upload` | 上传截图 |
| GET/POST/PUT | `/api/templates` | 模板 CRUD |
| GET/POST | `/api/projects` | 项目 CRUD |
| GET | `/api/sessions/:id/messages` | session 历史消息 (恢复对话用) |

### 11.2 WebSocket 协议 (替代 v1 的 SSE)

**Server → Client (Agent 事件)**:

```ts
type ServerMessage =
  | { type: 'agent_message'; sessionId: string; message: SDKMessage }
  | { type: 'tool_approval_request'; approvalId: string; toolName: string; input: any }
  | { type: 'session_status'; sessionId: string; status: SessionStatus }
  | { type: 'task_status_changed'; taskId: string; status: TaskStatus };
```

**Client → Server (用户操作)**:

```ts
type ClientMessage =
  | { type: 'user_interject'; sessionId: string; content: string }
  | { type: 'tool_approval_response'; approvalId: string; decision: ApprovalDecision }
  | { type: 'interrupt'; sessionId: string }
  | { type: 'abort'; sessionId: string };
```

WebSocket 在 `/ws/agent/:sessionId` 路径建连。

---

## 十二、前端组件设计

### 12.1 主布局

```
┌────────────────────────────────────────────────────────────┐
│ 顶栏: Logo + 项目过滤器 + 通知 + 设置                          │
├──────┬─────────────────────────────────────────────────────┤
│ 侧边 │  工作流管理 (当前)                                    │
│ 导航 │  ┌──────────────────────────────────────────┐       │
│      │  │  6 列看板: 待规划|待办|执行中|审核中|完成|阻塞 │       │
│ 📋  │  │  [卡片] [卡片] [卡片+▶] [卡片+diff] [卡片] │       │
│ 工作流│  └──────────────────────────────────────────┘       │
│      │                                                      │
│ [预留]│   [点击执行中卡片 → 右侧抽屉打开聊天窗+审批+控制]      │
└──────┴─────────────────────────────────────────────────────┘
```

### 12.2 关键组件 (新增/修订标 ⭐)

| 组件 | 作用 |
|------|------|
| `AppLayout` | 顶栏+侧边栏+主区域 |
| `Sidebar` | 左侧导航,预留扩展槽 |
| `KanbanBoard` | 6 列看板,拖拽 |
| `TaskCard` | 任务卡片,显示编号/标题/标签/优先级/risk |
| ⭐ `RunningTaskCard` | 执行中卡片,显示当前 Claude 状态(思考中/调用工具/等审批) |
| ⭐ `ReviewTaskCard` | 审核中卡片,显示 changedFiles 数量,点开看 diff |
| `TaskDetailDrawer` | 卡片详情抽屉 |
| ⭐ `ChatPanel` | 嵌入式聊天窗,流式渲染 agent 消息 |
| ⭐ `MessageBubble` | 单条消息渲染(thinking/text/tool_use/tool_result 不同样式) |
| ⭐ `ToolApprovalDialog` | 工具审批气泡(显示工具名+input,允许编辑参数) |
| ⭐ `ChatInputBox` | 用户插话输入框,带"中断""强制取消"按钮 |
| ⭐ `DiffViewer` | git diff 渲染(用 diff2html 或 monaco-editor) |
| `QuickCreateModal` | 新建任务弹窗 (含 risk level 选项) |
| `ProjectFilter` | 项目多选下拉 |
| `ImageUploader` | 截图上传 (粘贴/拖拽/选择) |
| `TemplateManager` | 模板管理页 |
| `SettingsPage` | 配置: 项目路径、合并策略默认值、审批粒度 |

## 十三、跨域协作机制 (EventBus)

```ts
// domain/_shared/EventBus.ts
interface DomainEvent {
  eventId: string;
  occurredAt: Date;
  aggregateId: string;
  eventType: string;
}

class EventBus {
  private handlers = new Map<string, Array<(e: DomainEvent) => Promise<void>>>();

  subscribe(type: string, handler: (e: DomainEvent) => Promise<void>) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type)!.push(handler);
  }

  async publish(event: DomainEvent) {
    // 持久化到 EventStore (event-store.jsonl)
    await this.eventStore.append(event);
    // 同步触发所有 handler
    const hs = this.handlers.get(event.eventType) || [];
    await Promise.all(hs.map(h => h(event)));
  }
}
```

### 13.1 MVP 阶段的跨域订阅

```ts
// application/agent/event-handlers/OnTaskDispatched.ts
class OnTaskDispatchedHandler {
  constructor(
    private startSession: StartSessionUseCase,
    private eventBus: EventBus,
  ) {
    eventBus.subscribe('TaskDispatched', this.handle.bind(this));
  }

  async handle(event: TaskDispatchedEvent) {
    // Workflow 域派发任务后, Agent 域接管启动 session
    await this.startSession.execute({
      taskId: event.taskId,
      worktreePath: event.worktreePath,
      riskLevel: event.riskLevel,
    });
  }
}

// application/workflow/event-handlers/OnTaskResultRecorded.ts
class OnTaskResultRecordedHandler {
  async handle(event: TaskResultRecordedEvent) {
    // Agent 域记录结果后, Workflow 域更新任务状态
    await this.taskRepo.findById(event.taskId).then(task => {
      task.recordResult(event.result);
      this.taskRepo.save(task);
    });
  }
}
```

### 13.2 EventStore 持久化

所有领域事件追加到 `~/.ai-task-flow/event-store.jsonl`,一行一事件:

```
{"eventId":"...","eventType":"TaskCreated","occurredAt":"...","aggregateId":"ws-001",...}
{"eventId":"...","eventType":"TaskDispatched",...}
{"eventId":"...","eventType":"SessionStarted",...}
```

好处:
- 工具崩溃重启可重放事件恢复状态
- Analytics Context 未来可从 event-store 构建任意 read model
- 调试: 看一条任务的完整生命周期就翻 event log

---

## 十四、技术选型汇总

| 层 | 技术 | 理由 |
|----|------|------|
| 前端框架 | Vue 3 + TS + Vite | 与现有技术栈同源 |
| 前端 UI | Element Plus | zxment 同源,上手快 |
| 后端框架 | Fastify | 轻量、高性能、TS 友好 |
| WebSocket | `ws` | Node 标准选择 |
| **AI 集成** | **`@anthropic-ai/claude-agent-sdk`** | **v2 核心,流式+插话+审批+恢复** |
| **Git 操作** | **`simple-git`** | **worktree 管理与 diff 计算** |
| 依赖注入 | tsyringe | DDD 必备 |
| 数据校验 | Zod | 工具 input schema + 运行时校验 |
| 文件监听 | chokidar | 兜底场景 (Windows 注意 issue) |
| 数据持久化 | JSON 文件 (FileStore) + JSONL EventStore | MVP 够用,后期可换 SQLite |
| Diff 渲染 | diff2html-vue3 | 看板内 diff 审查 |
| Markdown | markdown-it + highlight.js | 描述/聊天渲染 |
| 测试 | Vitest | 70% 单元 / 20% 集成 / 10% E2E |

---

## 十五、迭代路线图

### MVP (约 3-4 周, 比 v1 多 1-2 周因为 Agent SDK 集成)

**Week 1**: 基础架构
- 项目初始化 (frontend/backend/shared)
- DDD 骨架 + EventBus + EventStore
- WorktreeManager + simple-git 集成 (有单测覆盖)
- 任务 CRUD (Workflow 域基础)

**Week 2**: Agent SDK 集成
- AgentSdkRunner + canUseTool 桥接
- 自定义 record_task_result 工具
- WebSocket Hub + AgentChannel
- 工具审批往返链路

**Week 3**: 前端核心
- 看板 + 卡片 + 详情抽屉 (Element Plus)
- ChatPanel + MessageBubble + ToolApprovalDialog
- DiffViewer + 审查通过/打回流程

**Week 4**: 收尾与可用性
- 截图上传 + 模板管理
- 项目过滤 + 配置页
- E2E 跑通: 录入 → 派发 → 看 Claude 干活 → 审批 → diff 审查 → 合并/打回
- Bug 修复 + 文档

### v0.2 (约 1 周): 多任务并发
- 多个任务可同时跑 (各 worktree 独立)
- 看板"执行中"列支持多卡片
- 资源监控: CPU/内存阈值,超出时阻塞新派发

### v0.3 (约 1 周): 数据分析域
- 从 event-store 构建 TaskStatsProjection
- 看板顶部加统计 chart (完成率 / 平均执行时长 / 审批拒绝率)

### v0.4+: 按需扩展
- 多人格 Agent (per-task 的 Persona 配置)
- Skills/MCP 安装管理
- 邮件收取分发 (Messaging Context)
- 团队协作 (云同步可选)

---

## 十六、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Agent SDK API 变更 | 核心机制变化 | 把 Agent SDK 调用全部封装在 `infrastructure/agent-sdk/` 一处,SDK 升级只改这一处 |
| Claude API 不可用/限速 | 派发失败 | UI 友好降级 + 重试 + session 持久化让用户重启续接 |
| Git worktree 跨平台兼容 | Windows 路径/权限问题 | 早期手动测过 Win/Mac/Linux,加 CI |
| Worktree 残留累积 | 磁盘膨胀 | 启动时 cleanupOrphans + 定期清理已完成 > 7 天的 worktree |
| 长任务超时 | 用户等不到结果 | abortController 超时 + 进度上报 hook |
| Claude 偶尔不调 record_task_result | status 卡在 running | 兜底: session 结束时若无结果,提示用户手动标记;同时强化 systemPrompt 规则 |
| 工具审批 UX 烦扰 | 用户疲劳 | risk level 三档 + "记住此次决定"选项 + 白名单常用工具 |
| 数据量增大后 JSON 文件性能 | 慢 | MVP 任务量级在 1000 以内 OK;v0.2 起评估迁移 SQLite |
| 单点故障(本地服务挂) | 工具不可用 | 系统服务化 (Windows: nssm / Linux: systemd) 自动重启 |

---

## 十七、设计验证结论

本 v2 设计基于三轮外部调研验证:

**调研 1: 竞品现状** — 6+ 个直接竞品已存在,Vibe Kanban 已关停(商业问题非技术);自建合理,差异化清楚。

**调研 2: AI 交互机制** — 文件传递+正则解析的 v1 方案是业界明确反模式;structured output / 工具调用是正解;chokidar 文件监听有竞态/原子写坑。

**调研 3: Agent SDK 能力** — TypeScript SDK 完全支持流式查看/插话/中断/工具审批/session 恢复;"看板里点任务,实时看 Claude 干活+插话纠偏+结构化回写"完全可行。

**符合 2024-2025 最佳实践**:
- ✅ DDD 四层 + Bounded Context (业界主流)
- ✅ 聚合根状态变更走方法 + 值对象 + 领域事件
- ✅ 依赖倒置: domain 无外部依赖, infrastructure 实现接口
- ✅ Repository 一对一映射聚合根
- ✅ EventBus + EventStore 解耦跨域协作
- ✅ git worktree 隔离 (Vibe Kanban / agetor / spec-kitty 一致)
- ✅ Structured Output / 工具调用替代正则解析
- ✅ WebSocket 双向 (插话+审批必需)
- ✅ Agent SDK 替代裸 CLI (官方推荐路径)

**已知局限**:
- 单机本地优先,未来云端协作需大改
- Agent SDK 是 Anthropic 专属,切换其他 LLM 需抽象适配层
- Windows 上 git worktree 路径较长可能触发 260 字符限制,需注意

---

## 十八、附录

### 18.1 术语表

| 术语 | 含义 |
|------|------|
| Bounded Context | 限界上下文,一个领域的边界 |
| Aggregate Root | 聚合根,一致性边界的入口 |
| Value Object | 值对象,不可变、基于值相等 |
| Domain Event | 领域事件,跨域协作的载体 |
| Shared Kernel | 共享内核,多 Context 共用基础概念 |
| Read Model | 读模型,从事件流投影出的查询视图 |
| Worktree | git 的"独立工作目录",一个仓库可有多个,各自独立分支 |
| Agent Session | 一次完整的 Claude 对话,有唯一 sessionId |
| canUseTool | Agent SDK 的工具调用拦截回调 |
| structured output | LLM 输出 JSON Schema 约束的结构化数据 |
| risk level | 任务风险等级,决定工具审批粒度 |
| record_task_result | 自定义工具,Claude 完成任务后调用以回写状态 |

### 18.2 参考资料

**业界产品**:
- [Backlog.md](https://github.com/MrLesk/Backlog.md) — markdown 任务管理 + 看板 + AI MCP
- [Vibe Kanban](https://github.com/BloopAI/vibe-kanban) — Rust 实现的 agent 编排看板 (已关停, 代码可参考)
- [agetor](https://github.com/alamops/agetor) — 本地 harness 编排 + tmux 持久 session
- [spec-kitty](https://github.com/Priivacy-ai/spec-kitty) — spec-driven 开发 + 实时看板

**官方文档**:
- [Claude Agent SDK TypeScript](https://code.claude.com/docs/en/agent-sdk/typescript)
- [Stream vs Single Mode](https://docs.claude.com/en/api/agent-sdk/streaming-vs-single-mode)
- [Configure permissions](https://code.claude.com/docs/en/permissions)
- [Hooks Guide](https://code.claude.com/docs/en/hooks-guide)

**架构与最佳实践**:
- [Clean Architecture and DDD in Practice 2025](https://wojciechowski.app/en/articles/clean-architecture-domain-driven-design-2025)
- [Khalil Stemmler - DDD Intro](https://khalilstemmler.com/articles/domain-driven-design-intro)
- [Building Safer AI Agents with Structured Outputs](http://www.snyk.io/jp/articles/building-safer-ai-agents-structured-outputs/)
- [Markdown Files as State Machines](https://understandingdata.com/posts/markdown-files-as-state-machines/)

### 18.3 v1 → v2 文档对照

| v1 章节 | v2 章节 | 变化 |
|---------|---------|------|
| 项目定位 | 一、项目定位 | 重写: AI 输入预处理器 → AI 工作台 |
| 关键决策 ADR | 二、v1→v2 关键修正 | 全面更新 |
| 战略设计 | 四、战略设计 | 增加 Workflow↔Agent 双向协作 |
| AI 回写协议 | 七、AI 回写协议 | 重写: YAML+正则 → 工具调用+Zod |
| 战术设计 | 九、战术设计 | 增加 Agent Context 模型 |
| 目录结构 | 十、目录结构 | Agent 域提到 MVP 实现 |
| 接口层 | 十一、接口层 | SSE → WebSocket |
| 前端组件 | 十二、前端组件 | 增加 ChatPanel/ToolApprovalDialog/DiffViewer |
| 跨域协作 | 十三、跨域协作 | 持久化到 EventStore |
| 技术选型 | 十四、技术选型 | 增加 Agent SDK + simple-git |
| 路线图 | 十五、迭代路线图 | MVP 3-4 周(原 2 周) |
| 验证结论 | 十七、设计验证 | 基于三轮调研 |
| 新增 | 五、整体技术架构 | 新增架构图 |
| 新增 | 六、Agent SDK 集成详解 | 新增, 核心机制 |
| 新增 | 八、Git Worktree 隔离 | 新增, v1 漏掉 |
| 新增 | 三、产品形态与核心交互 | 新增, 嵌入式聊天窗 |
| 新增 | 十六、风险与缓解 | 新增 |

---

**文档结束。下一步: 待用户审阅通过后, 移交 writing-plans 技能生成详细实施计划。**
