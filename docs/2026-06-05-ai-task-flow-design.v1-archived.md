# AI Task Flow - 设计文档

**项目名称**: ai-task-flow  
**版本**: v1.0 Design  
**日期**: 2026-06-05  
**设计者**: Claude Opus 4.8  
**架构风格**: Domain-Driven Design (DDD) + Clean Architecture  
**远程仓库**: git@github.com:575568329/ai-task-flow.git  
**分支**: main

---

## 一、项目定位与愿景

### 1.1 一句话定位

> 个人 AI 任务编排器。把脑里散落的工作整理成结构化看板，一键导出成 AI 友好的工作计划写入项目目录，AI 执行后回写结果，形成"录入 → 派发 → 复查 → 归档"的闭环。

### 1.2 核心价值主张

**不是任务管理工具**，而是 **AI 输入预处理器 + 执行结果聚合器**。

解决的核心痛点：
- 想法散落在飞书表格、截图、脑子里，难以统一整理
- 描述模糊导致 AI 理解偏差，反复拉锯浪费时间
- AI 执行后的结果散落在各项目目录，复查困难
- 缺少闭环机制，任务状态无法追踪

### 1.3 设计前瞻性

当前 MVP 只实现**工作流管理**模块，但架构按 **5 个 Bounded Context** 前瞻设计：

| Bounded Context | 职责 | 状态 |
|----------------|------|------|
| **工作流管理** (Workflow) | 任务录入、派发、回写、复查 | ✅ MVP 实现 |
| **Agent 管理** (Agent) | Agent 对话、远程控制、CLI 操作、多人格 | 🔜 预留 |
| **数据分析** (Analytics) | 统计看板、AI 执行成功率、时序报表 | 🔜 预留 |
| **插件生态** (Plugin) | Skills/MCP 安装与管理 | 🔜 预留 |
| **消息集成** (Messaging) | 邮件收取分发、Slack/飞书集成 | 🔜 预留 |

### 1.4 MVP 边界 (YAGNI)

**MVP 包含**:
- 任务 CRUD（看板 + 卡片详情）
- 模块化模板系统（拼装 Markdown）
- 多项目过滤
- 截图管理（粘贴/拖拽 + 本地存储）
- 一键派发到指定项目目录（生成 task.md + 命令）
- 文件监听 → AI 回写自动同步状态（YAML 协议）
- 完整 DDD 四层 + EventBus 跨域协作机制

**MVP 暂不做**（后续迭代）:
- ❌ 截图反向生成任务描述（需接 LLM）
- ❌ 任务依赖图/DAG（先用优先级排序代替）
- ❌ 多人协作 / 云同步
- ❌ 全自动 Agent 派发（违背"人在回路"，详见 §5.3）
- ❌ Agent/Analytics/Plugin/Messaging 域的具体实现（仅预留架构）

---

## 二、关键决策记录 (ADR)

| # | 决策点 | 选择 | 理由 |
|---|--------|------|------|
| 1 | 交付方式 | 本地 Node 服务直写项目目录 | 支持文件监听自动同步 AI 回写，扩展空间大 |
| 2 | 使用强度 | 日级高频 | 需状态追踪、模板复用、跨会话不丢数据 |
| 3 | 主界面形态 | Kanban + 卡片详情（参考 Multica） | 状态分明、信息密度合适 |
| 4 | 多项目策略 | 统一看板 + 项目标签 + 过滤器 | 既能跨项目鸟瞰，也能聚焦单项目 |
| 5 | AI 回写机制 | AI 写 result.md，工具扫描解析（路径 A） | AI 写文件是母语能力，零学习成本，服务挂了不影响 AI 工作 |
| 6 | 回写数据格式 | YAML frontmatter + HTML 注释标记 | AI 写 YAML 准确率高，解析器可容错降级 |
| 7 | 派发自动化程度 | 半自动（方案 B） | 全自动需绕过 Claude Code 权限系统，违背人在回路 |
| 8 | 架构风格 | 完整 DDD 四层 + 5 Bounded Context | 未来 5 个领域 + 跨域协作，必须清晰边界防重构 |

---

## 三、战略设计 (Strategic Design)

### 3.1 Bounded Context 地图

```
┌─────────────────────────────────────────────────────────────┐
│                     Shared Kernel                            │
│  (跨域共享: EventBus, UserId, ProjectId, TaskId)             │
└─────────────────────────────────────────────────────────────┘
        ↓                ↓              ↓            ↓
┌──────────────┐  ┌──────────────┐  ┌────────┐  ┌──────────┐
│   Workflow   │  │ Agent Mgmt   │  │ Plugin │  │ Messaging│
│   Context    │  │   Context    │  │Context │  │ Context  │
├──────────────┤  ├──────────────┤  ├────────┤  ├──────────┤
│ Task         │  │ AgentSession │  │ Skill  │  │ Email    │
│ Template     │  │ Conversation │  │ MCP    │  │ Slack    │
│ Execution    │  │ RemoteCtrl   │  │ Plugin │  │ Feishu   │
└──────────────┘  └──────────────┘  └────────┘  └──────────┘
        ↓                ↓                           ↓
┌─────────────────────────────────────────────────────────────┐
│                   Analytics Context                          │
│  (Read Model: 时序数据聚合、看板、报表)                        │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 跨域协作链路（领域事件驱动）

模块之间**禁止直接 import**，全部通过领域事件协作。典型链路：

```
Messaging Context 收到邮件
  → 发布 EmailReceived 事件
  → Workflow Context 监听，自动创建 Task
  → 发布 TaskCreated 事件
  → Agent Context 监听，分配给空闲 Agent 执行
  → 发布 TaskExecuted 事件
  → Analytics Context 监听，更新统计看板
```

这套机制保证：**新增一个域 = 订阅已有事件 + 发布新事件，不改任何老代码。**

### 3.3 整体技术架构

```
┌─────────────────────────────────────────────────────────┐
│  浏览器前端 (Vue 3 + TS + Vite)                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                │
│  │ 看板视图  │  │ 卡片详情  │  │ 模板管理  │                │
│  └──────────┘  └──────────┘  └──────────┘                │
│         │ HTTP (CRUD)        │ SSE (实时推送 AI 回写)       │
└─────────┼────────────────────┼───────────────────────────┘
          ▼                     ▲
┌─────────────────────────────────────────────────────────┐
│  本地 Node 服务 (Fastify)                                  │
│  ┌────────────┐ ┌────────────┐ ┌─────────────────────┐   │
│  │ REST API   │ │ 文件监听器  │ │ MD 渲染/解析引擎     │   │
│  │ (任务CRUD) │ │ (chokidar) │ │ (模板拼装 + 回写解析) │   │
│  └────────────┘ └────────────┘ └─────────────────────┘   │
└─────────┬─────────────────────────────┬───────────────────┘
          ▼ 读写                          ▼ 监听/读写
┌──────────────────────┐      ┌──────────────────────────────┐
│ 工具自身数据 (源)      │      │ 各项目的 .ai-workspace/ (产物) │
│ ~/.ai-task-flow/      │      │ rpp-web/.ai-workspace/        │
│  ├── tasks.json       │      │  ├── tasks/WS-001/            │
│  ├── templates.json   │      │  │   ├── task.md   (派发给AI) │
│  ├── projects.json    │      │  │   └── result.md (AI回写)   │
│  └── images/          │      │  └── crowdsourced.../...      │
└──────────────────────┘      └──────────────────────────────┘
```

### 3.4 双层存储模型（核心机制）

| 层 | 位置 | 角色 | 谁读写 |
|---|---|---|---|
| **源数据层** | `~/.ai-task-flow/` | 唯一真相源（结构化 JSON + 截图） | 工具独占 |
| **产物层** | `<项目>/.ai-workspace/` | 派发给 AI 的 MD + AI 回写的 result | 工具写 task.md，AI 写 result.md |

**设计要点**：源数据用 JSON 存（结构化、好查询、好过滤），MD 只是"渲染产物"。看板上编辑的是源数据，派发时才拼装成 MD。AI 回写的 result.md 被工具解析后**反向更新源数据**，看板状态自动刷新。

### 3.5 任务生命周期（数据流）

```
1. 录入   看板新建卡片 → 写入 tasks.json (status: todo)
2. 派发   点"派发" → MD引擎拼装 task.md → 写入项目 .ai-workspace/
                                          → status: dispatched
3. 执行   对 Claude Code 说"读 task.md 执行" → AI 干活 → 写 result.md
4. 感知   chokidar 监听 result.md → 解析 YAML
                                  → 反向更新 tasks.json (status: review)
                                  → SSE 推前端 → 卡片移到"审核中"列
5. 复查   看执行摘要 → 点"通过"(→done) 或 "打回"(→todo, 附理由)
6. 归档   done 任务可折叠/归档
```

## 四、AI 回写协议 (核心契约)

### 4.1 派发的 task.md 末尾自动追加回写模板

````markdown
<!-- =========================================== -->
<!-- 以下区域请由 AI 在执行完成后填写,工具会扫描该区域更新任务状态 -->
<!-- 请保留两条标记线,中间用 YAML 格式填写 -->
<!-- =========================================== -->

## 🤖 执行结果

<!-- AI_RESULT_START -->
```yaml
status: done          # done / partial / blocked
changed_files:        # 改动的文件列表(相对项目根)
  - 
notes: |              # 改动说明,what & why
  
review_points:        # 需要人工复查的点
  - 
blocked_reason:       # status=blocked 时填写阻塞原因
  
```
<!-- AI_RESULT_END -->
````

### 4.2 解析器逻辑（容错降级）

```js
function parseResult(mdContent) {
  const match = mdContent.match(
    /<!-- AI_RESULT_START -->[\s\S]*?```yaml\n([\s\S]*?)```[\s\S]*?<!-- AI_RESULT_END -->/
  );
  if (!match) return { ok: false, reason: 'no_result_block' };
  try {
    const data = yaml.parse(match[1]);
    return { ok: true, data };
  } catch (e) {
    // 降级: 正则扫关键字段,再不行标记"格式异常"让人工看
    return { ok: false, reason: 'yaml_parse_error', error: e.message };
  }
}
```

**为什么选 YAML 而非纯 Markdown**：AI 写 YAML 的准确率远高于维护固定 Markdown 格式（emoji、标题层级容易写歪）。HTML 注释标记作为锚点稳定，解析器能精确定位。

---

## 五、战术设计 (Tactical Design)

### 5.1 Task 聚合根

```ts
// domain/workflow/entities/Task.ts
// 聚合根 = 一致性边界,所有状态变更通过方法,内嵌业务规则
class Task {
  private id: TaskId;
  private title: string;
  private description: string;
  private status: TaskStatus;
  private priority: Priority;
  private projects: Project[];          // 多对多,一个任务可关联多个项目
  private images: ImageRef[];
  private relatedFiles: FilePath[];
  private executionResult?: ExecutionResult;
  private createdAt: Date;
  private updatedAt: Date;

  dispatch(projectPath: string): TaskDispatchedEvent {
    if (this.status !== TaskStatus.TODO) {
      throw new Error('只有待办任务可派发');
    }
    this.status = TaskStatus.DISPATCHED;
    this.updatedAt = new Date();
    return new TaskDispatchedEvent(this.id, projectPath);
  }

  receiveResult(yamlData: any): ResultReceivedEvent {
    if (![TaskStatus.DISPATCHED, TaskStatus.DOING].includes(this.status)) {
      throw new Error('只有已派发/进行中任务可接收回写');
    }
    this.executionResult = ExecutionResult.fromYaml(yamlData);
    this.status = TaskStatus.REVIEW;
    this.updatedAt = new Date();
    return new ResultReceivedEvent(this.id);
  }

  approve(): void {
    if (this.status !== TaskStatus.REVIEW) throw new Error('只有审核中任务可通过');
    this.status = TaskStatus.DONE;
  }

  reject(reason: string): void {
    if (this.status !== TaskStatus.REVIEW) throw new Error('只有审核中任务可打回');
    this.status = TaskStatus.TODO;
    this.executionResult = undefined;
  }
}
```

### 5.2 TaskStatus 值对象与状态机

```ts
enum TaskStatus {
  PLANNING = 'planning',     // 待规划
  TODO = 'todo',             // 待办
  DISPATCHED = 'dispatched', // 已派发
  DOING = 'doing',           // 进行中(可选,手动标记)
  REVIEW = 'review',         // 审核中(AI 回写触发)
  DONE = 'done',             // 已完成
  BLOCKED = 'blocked',       // 已阻塞
}
```

**状态流转规则**：

| 起点 | 终点 | 触发方式 | 副作用 |
|------|------|----------|--------|
| 待规划 | 待办 | 拖拽 / "标记待办" | 无 |
| 待办 | 已派发 | "派发"按钮 | 生成 task.md + 命令 |
| 已派发 | 进行中 | 手动(可选) | 无 |
| 已派发/进行中 | 审核中 | **AI 回写 result.md(自动,不可手动)** | 解析 YAML 填充结果 |
| 审核中 | 已完成 | "通过" | 归档 |
| 审核中 | 待办 | "打回" | 清空执行结果 |
| 任意 | 已阻塞 | 拖拽 / "标记阻塞" | 弹窗填阻塞原因 |
| 已阻塞 | 待办 | 拖拽回 | 记录解除时间 |

### 5.3 领域服务

- **MarkdownRenderer**: 把 Task + Template 拼装成 task.md。**注意**：模板由 Application 层预先加载传入，领域服务只做纯拼装，不直接读文件（遵守"领域层不依赖基础设施"原则）。
- **ResultParser**: 解析 result.md 的 YAML 区块为 ExecutionResult 值对象，带容错降级。
- **TaskDispatcher**: 协调派发逻辑（生成路径、命令）。

### 5.4 派发半自动化方案（ADR-7）

**全自动不可行的原因**：Claude Code 是交互式 REPL，执行时需人工确认权限。强行全自动需 `--auto-approve`（危险）或 OS 级 UI 自动化（hack），违背"人在回路"设计哲学。

**半自动方案**：点"派发" → 生成 task.md + 弹窗显示命令 + 一键打开终端到项目目录 → 用户粘贴执行。

```bash
# 自动生成的命令
cd D:\xunfei\zyjg\rpp-web
claude "读 .ai-workspace/tasks/WS-001/task.md 并执行"
```

## 六、目录结构 (前瞻完整版)

```
ai-task-flow/
├── frontend/                       # Vue 3 + TS + Vite
│   ├── src/
│   │   ├── modules/                # 按 Bounded Context 组织
│   │   │   ├── workflow/           # 工作流模块(MVP 实现)
│   │   │   │   ├── views/          # KanbanBoard, TemplateManager
│   │   │   │   ├── components/      # TaskCard, TaskDetailDrawer...
│   │   │   │   ├── stores/         # Pinia store
│   │   │   │   ├── api/            # HTTP 调用层
│   │   │   │   └── types/
│   │   │   ├── agent-mgmt/         # Agent 管理(预留)
│   │   │   ├── analytics/          # 数据看板(预留)
│   │   │   ├── plugins/            # Skills/MCP(预留)
│   │   │   ├── messaging/          # 邮件集成(预留)
│   │   │   └── _shared/            # 布局、Sidebar、EventBus 客户端
│   │   └── router/
│   └── package.json
│
├── backend/                        # Node.js + Fastify
│   ├── src/
│   │   ├── domain/                 # 领域层(按 Context 拆,无外部依赖)
│   │   │   ├── workflow/           # ✅ MVP 实现
│   │   │   │   ├── entities/       # Task(聚合根), Template
│   │   │   │   ├── value-objects/  # TaskStatus, Priority, ExecutionResult
│   │   │   │   ├── services/       # MarkdownRenderer, ResultParser
│   │   │   │   └── events/         # TaskCreated, TaskDispatched...
│   │   │   ├── agent/              # 🔜 AgentSession, Conversation, Persona
│   │   │   ├── plugin/             # 🔜 Skill, MCPServer
│   │   │   ├── messaging/          # 🔜 EmailAccount, InboxRule
│   │   │   └── _shared/            # Shared Kernel: DomainEvent, EventBus
│   │   │
│   │   ├── application/            # 应用层(用例编排)
│   │   │   ├── workflow/
│   │   │   │   ├── CreateTaskUseCase.ts
│   │   │   │   ├── DispatchTaskUseCase.ts
│   │   │   │   ├── SyncResultUseCase.ts
│   │   │   │   └── event-handlers/ # 监听其他域事件(如 OnEmailReceived)
│   │   │   ├── agent/  plugin/  messaging/
│   │   │   └── analytics/
│   │   │       └── projections/    # Read Model: TaskStatsProjection
│   │   │
│   │   ├── infrastructure/         # 基础设施层(实现接口)
│   │   │   ├── persistence/        # TaskRepository, FileStore, EventStore
│   │   │   ├── watcher/            # ResultWatcher (chokidar)
│   │   │   ├── terminal/           # TerminalLauncher
│   │   │   ├── process/            # 🔜 ClaudeCodeRunner, ProcessPool
│   │   │   ├── messaging/          # 🔜 ImapAdapter
│   │   │   └── pubsub/             # InMemoryEventBus
│   │   │
│   │   ├── interfaces/             # 接口层
│   │   │   ├── http/routes/        # workflow.routes.ts...
│   │   │   ├── http/sse/           # EventStream (SSE 推送)
│   │   │   ├── websocket/          # 🔜 AgentControlWS
│   │   │   └── cli/                # 预留 CLI 接口
│   │   │
│   │   └── server.ts
│   └── package.json
│
├── shared/                         # 前后端共享类型
│   └── types/                      # Task.types.ts, API.types.ts
│
├── ~/.ai-task-flow/                # 工具数据目录(用户家目录)
│   ├── tasks.json  templates.json  projects.json
│   └── images/
│
└── docs/plans/
    ├── 2026-06-05-ai-task-flow-design.md   # 本文档
    └── bounded-contexts.md                  # Context Map
```

**依赖方向铁律**: `interfaces → application → domain ← infrastructure`。domain 层无任何外部依赖，infrastructure 实现 domain/application 定义的接口（依赖倒置）。

---

## 七、接口层设计

### 7.1 REST API

| 方法 | 路径 | 用例 | 描述 |
|------|------|------|------|
| GET | `/api/tasks` | ListTasks | 任务列表(支持项目过滤) |
| POST | `/api/tasks` | CreateTask | 新建任务 |
| GET | `/api/tasks/:id` | GetTaskDetail | 任务详情 |
| PUT | `/api/tasks/:id` | UpdateTask | 更新字段 |
| POST | `/api/tasks/:id/dispatch` | DispatchTask | 派发 → 生成 task.md |
| POST | `/api/tasks/:id/approve` | ApproveTask | 通过审核 |
| POST | `/api/tasks/:id/reject` | RejectTask | 打回任务 |
| DELETE | `/api/tasks/:id` | DeleteTask | 删除 |
| POST | `/api/images/upload` | UploadImage | 上传截图 |
| GET/POST | `/api/templates` | Templates | 模板 CRUD |
| GET | `/api/projects` | ListProjects | 项目列表 |
| POST | `/api/terminal/open` | OpenTerminal | 打开终端到指定目录 |
| GET | `/api/events` | (SSE) | 实时事件流 |

### 7.2 SSE 实时推送

后端 `EventStream` 维护客户端连接集合，`ResultWatcher` 检测到 result.md 变化后广播事件：

```ts
// 前端监听
const es = new EventSource('http://localhost:3001/api/events');
es.onmessage = (e) => {
  const event = JSON.parse(e.data);
  if (event.type === 'task_updated') store.refreshTask(event.taskId);
};
```

---

## 八、前端组件设计

### 8.1 主布局

```
┌────────────────────────────────────────────────────────────┐
│  顶栏: Logo + 全局搜索 + 通知 + 用户头像                      │
├───────┬────────────────────────────────────────────────────┤
│ 侧边  │  工作流管理(当前激活)                                │
│ 导航  │  项目过滤器 [rpp-web ✓] [crowdsourced ✓]            │
│       │  Tab: 全部任务 / 我的任务 / 已归档                   │
│ 📋工作流│ ┌────────────────────────────────────────────┐    │
│ (当前) │ │  看板(6列): 待规划|待办|已派发|审核中|完成|阻塞 │    │
│ [预留] │ │  [卡片] [卡片] [卡片+复制命令] [卡片] ...     │    │
│ 扩展槽 │ └────────────────────────────────────────────┘    │
└───────┴────────────────────────────────────────────────────┘
```

侧边栏预留扩展槽：数据看板、知识库、Agent 配置、系统设置。

### 8.2 核心组件清单

| 组件 | 作用 | 关键交互 |
|------|------|----------|
| `AppLayout` | 顶栏+侧边栏+主区域 | 路由切换、折叠 |
| `Sidebar` | 左侧导航 | 当前只有"工作流"入口，预留扩展 |
| `KanbanBoard` | 6 列看板 | 拖拽排序、过滤 |
| `TaskCard` | 任务卡片 | 点击开详情、拖拽改状态 |
| `DispatchedCard` | 已派发列专用卡片 | "复制命令"+"开终端"按钮 |
| `TaskDetailDrawer` | 右侧抽屉详情 | 编辑所有字段、查看执行结果 |
| `QuickCreateModal` | 新建任务弹窗 | 表单 + 模板选择 |
| `ProjectFilter` | 项目多选下拉 | 过滤看板 |
| `ExportButton` | 批量导出 | 按项目分组生成 task.md |
| `ImageUploader` | 截图上传 | 拖拽/粘贴(Ctrl+V)/选择 |
| `MarkdownEditor` | MD 编辑+预览 | 描述/验收标准字段 |
| `ExecutionResult` | AI 回写结果区 | 显示 YAML 解析后数据，通过/打回按钮 |

### 8.3 技术选型（前端）

- 框架: Vue 3 + TypeScript + Vite
- UI 库: Element Plus（Element UI 的 Vue 3 版，与你熟悉的 zxment 同源）
- 拖拽: vue-draggable-plus
- Markdown 编辑器: v-md-editor
- 状态管理: Pinia
- 路由: Vue Router 4
- HTTP: axios
- 实时推送: 原生 EventSource (SSE)
- UI 组件生成: spark-design 技能

---

## 九、跨域协作机制 (EventBus)

```ts
// domain/_shared/EventBus.ts
interface DomainEvent {
  eventId: string; occurredAt: Date; aggregateId: string; eventType: string;
}

class EventBus {
  private handlers = new Map<string, Array<(e: DomainEvent) => Promise<void>>>();
  subscribe(type: string, handler: (e: DomainEvent) => Promise<void>) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type)!.push(handler);
  }
  async publish(event: DomainEvent) {
    const hs = this.handlers.get(event.eventType) || [];
    await Promise.all(hs.map(h => h(event)));
  }
}
```

**未来扩展示例**（邮件 → 任务 → Agent）：
- `OnEmailReceivedHandler` 订阅 `EmailReceived` → 调 CreateTaskUseCase → 发布 `TaskCreated`
- `OnTaskCreatedHandler` 订阅 `TaskCreated` → 找空闲 Agent → 调 AssignTaskToAgentUseCase

**新增域零侵入**：只需订阅已有事件 + 发布新事件，不改任何老代码。

---

## 十、技术选型汇总

| 层 | 技术 | 理由 |
|----|------|------|
| 前端框架 | Vue 3 + TS + Vite | 与现有技术栈同源，快 |
| 前端 UI | Element Plus | zxment 同源，上手快 |
| 后端框架 | Fastify | 轻量、性能好、TS 友好 |
| 依赖注入 | tsyringe | DDD 必备，Repository 切换/单测 mock |
| 数据校验 | Zod | 运行时类型校验 |
| 文件监听 | chokidar | 跨平台稳定 |
| YAML 解析 | yaml | 解析 AI 回写区块 |
| 数据持久化 | JSON 文件(FileStore) | MVP 阶段够用，未来可换 SQLite |
| 实时通信 | SSE (EventSource) | 单向推送够用，比 WebSocket 简单 |
| 测试 | Vitest | 70% 单元 / 20% 集成 / 10% E2E |

---

## 十一、迭代路线图

### MVP (约 2 周) — 工作流域
- Task CRUD + 看板 + 卡片详情
- 模板系统 + 派发（生成 task.md + 命令 + 开终端）
- ResultWatcher + YAML 解析 + 状态自动同步
- 完整 DDD 四层 + EventBus + EventStore

### v0.2 (约 1 周) — Agent 管理域骨架
- AgentSession 聚合根 + ProcessManager
- 工作流域监听 AgentStarted 事件

### v0.3 (约 1 周) — 数据分析域
- Read Model 投影 TaskStatsProjection
- 统计看板（任务完成率、AI 执行成功率）

### v0.4+ — 按需扩展
- 插件域（Skills/MCP 安装）
- 消息域（邮件收取分发）
- 多人格 Agent、远程控制

---

## 十二、设计验证结论

本设计经过 2024-2025 权威资料对照验证（Clean Architecture & DDD 2025 完整指南、Khalil Stemmler DDD 系列、真实 Node.js DDD 开源项目）：

**符合最佳实践**：
- ✅ 四层结构（domain/application/infrastructure/interfaces）符合主流标准
- ✅ 聚合根状态变更走方法、值对象、领域服务、领域事件，全部正确
- ✅ Repository 一对一映射聚合根
- ✅ shared/types 前后端类型共享

**已修正的问题**：
- ✅ 补充 tsyringe 依赖注入（DDD 硬要求）
- ✅ MarkdownRenderer 改为纯拼装，模板由 Application 层预加载（避免领域层依赖基础设施）
- ✅ 因未来 5 个 Bounded Context + 跨域协作，确认采用完整 DDD（而非简化方案）

**关键权衡**：
- 完整 DDD 前期成本较高，但鉴于项目会持续演进为"AI 工作台"（5 个领域），清晰边界能避免反复重构，长期收益 > 前期成本。

---

## 附录：术语表

| 术语 | 含义 |
|------|------|
| Bounded Context | 限界上下文，一个领域的边界 |
| Aggregate Root | 聚合根，一致性边界的入口对象 |
| Value Object | 值对象，不可变、基于值相等 |
| Domain Event | 领域事件，领域内发生的事实，用于跨域协作 |
| Shared Kernel | 共享内核，多个 Context 共用的基础概念 |
| Read Model | 读模型，CQRS 中专用于查询的投影 |
| `.ai-workspace/` | 各项目下存放 task.md/result.md 的目录 |

---

**文档结束。下一步：移交 writing-plans 技能生成详细实施计划。**

---

