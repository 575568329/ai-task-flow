# 结论卡（Conclusion）设计

- 日期：2026-11-18
- 状态：设计已确认，待实施
- 关联：worklog（记录代码变更）、knowledge-base（文档库）

## 1. 背景与问题

长对话中，结论会随着新信息不断修正。对话本身不可检索、不可回看，用户需要反复向上滚动才能找回“最后到底定了什么、当时的依据是什么、还有哪些没定”。

现有两块能力都不覆盖：

| 现有能力 | 覆盖范围 | 缺口 |
|---|---|---|
| `worklog` + `record_work` | 代码改了什么（diff/文件/行号） | 不记录讨论结论、决策理由、关键数据 |
| `knowledge-base` + `save_to_knowledge` | 长文档写入 | 只能写、AI 无法查回；无项目/时间/会话结构；不适合高频碎片记录 |

结论是**演进中的主题**，不是一次性文档，也不是代码变更条目。需要独立的一层。

## 2. 目标与非目标

### 目标

1. 用户在对话中明确要求时，AI 通过 MCP 把当前结论写入工作台。
2. 同一主题的结论可以持续追加新版本，**完整保留历史**。
3. 页面默认永远展示最新结论，历史可展开查看。
4. 记录足够的溯源信息：项目、版本（可选）、对话 ID、对话名称、使用的编码工具、时间、问题域（项目/个人）。
5. 人可读优先：一张卡一页看完，不要求 AI 召回。

### 非目标（v1 明确不做）

- AI 自动捕获对话或自动判断何时记录
- 新会话自动召回/注入历史结论
- 版本间文本 diff、一键回退
- 导出 Markdown（知识库已有文档能力）
- 项目重命名/合并
- 列表分页、虚拟滚动（数据量超 1 万条再评估）
- 对话名称的页面重命名（由 AI 保存时提供）

## 3. 已确认的决策

| # | 决策 | 结论 |
|---|---|---|
| 1 | 第一消费者 | 人回看优先，AI 召回推迟 |
| 2 | 记录单位 | 一次对话一张卡（同一对话内按主题演进；跨对话默认新建卡） |
| 3 | 卡片内容 | 结论/理由、关键数据、待办/未决、代码位置，四节固定 |
| 4 | 归属 | 挂项目；另支持“个人”问题 |
| 5 | 写入触发 | 仅用户明确要求时，AI 不主动记录 |
| 6 | 历史保留 | 每版完整快照 |
| 7 | 更新定位 | 按 `cardId` 追加；同一对话内可直接追加；跨对话默认拒绝，显式 `allowCrossConversation` 才允许 |
| 8 | 页面位置 | 侧边栏独立视图 |
| 9 | 搜索范围 | keyword 覆盖标题 + 全部历史版本 |
| 10 | 领域命名 | 领域层 `Conclusion`；UI 称“结论卡” |
| 11 | 更新前读取 | `query_conclusions({cardId})` 返回最新版完整内容与演进摘要 |
| 12 | 追加语义 | 省略的字段沿用上一版；显式空值（`""` / `[]`）表示清空；服务端仍存完整快照 |
| 13 | 并发保护 | 追加可带 `expectedRev`；与当前版本不一致返回 409，要求重读 |
| 14 | 对话边界 | 追加时来源 `conversationId` 与上一版不同 → 409；人工写入无 ID 放行；显式 `allowCrossConversation=true` 才允许跨对话续写 |

## 4. 数据模型

### 4.1 共享类型（`shared/src/types/conclusion.ts`）

```ts
export type ProblemScope = 'project' | 'personal';

export interface ConclusionCodeRef {
  /** 相对仓库根的文件路径 */
  path: string;
  /** 1-based，记录时刻快照 */
  startLine?: number;
  endLine?: number;
  /** 这条引用说明什么 */
  note?: string;
}

export interface ConclusionSource {
  /** 编码工具：claude-code / zcode / cursor / manual / ... */
  tool: string;
  /** 对话 ID：优先真实会话 ID，退化时用进程指纹 */
  conversationId?: string;
  /** 对话名称：AI 保存时提供，可为空 */
  conversationName?: string;
  /** 会话启动目录 */
  cwd?: string;
  /** 编码工具版本 */
  agentVersion?: string;
}

export interface ConclusionRevision {
  /** 从 1 开始，服务端生成 */
  rev: number;
  /** 本版结论/决策 + 理由（必填，Markdown） */
  decision: string;
  /** 本版关键数据/命令结果（Markdown） */
  data?: string;
  /** 本版待办/未决问题（Markdown） */
  openItems?: string;
  codeRefs?: ConclusionCodeRef[];
  /** 这一版为什么更新（追加时必填） */
  changeNote?: string;
  source: ConclusionSource;
  /** 业务日期 YYYY-MM-DD */
  date: string;
  createdAt: number;
}

export interface Conclusion {
  /** c_xxx */
  id: string;
  scope: ProblemScope;
  /** scope=project 时必填 */
  project?: string;
  /** 仅项目问题可有，可选 */
  version?: string;
  /** 卡片归属对话：创建时确定，人工编辑不改变；一对话一卡的守卫依据 */
  conversationId?: string;
  conversationName?: string;
  title: string;
  tags?: string[];
  /** 按 rev 升序；最新 = 最后一版 */
  revisions: ConclusionRevision[];
  createdAt: number;
  updatedAt: number;
}

export interface ConclusionData {
  schemaVersion: 1;
  conclusions: Conclusion[];
}
```

### 4.2 不变量

1. `revisions` 非空，`rev` 从 1 连续递增，最后一版为最新。
2. `scope=project` → `project` 去空格后非空；`scope=personal` → 不得有 `project` 与 `version`。
3. `version` 只在 `scope=project` 时允许。
4. `decision` 每版必填；`title` 新建必填。
5. 追加时 `changeNote` 必填，且至少提交一个变化字段（内容或元信息）。
6. 追加时未提交的内容字段沿用上一版；显式空字符串/空数组表示清空该节。
7. `rev` 由服务端在写锁内生成，调用方不可指定；传入 `expectedRev` 时，必须等于当前最新版，否则 409。

### 4.3 校验限制

| 字段 | 规则 |
|---|---|
| `title` | 1–200 字符 |
| `decision` / `data` / `openItems` | 各 ≤ 100,000 字符 |
| `changeNote` | ≤ 1,000 字符 |
| `tags` | ≤ 20 个，每个非空 |
| `codeRefs` | 数组；`path` 非空 |
| `date` | `YYYY-MM-DD` 且为合法日历日期 |
| `id` | `c_` + nanoid（复用现有依赖） |

## 5. 来源元信息

来源在**写入时**解析，随每一版保存。解析属于接口层（MCP / HTTP），不进入领域与应用层。

### 5.1 解析优先级

| 字段 | 优先级 |
|---|---|
| `tool` | 显式参数 > `AI_AGENT` 前缀 > MCP `clientInfo.name` > `unknown` |
| `conversationId` | 显式参数 > `CLAUDE_CODE_SESSION_ID` > `{tool}:{pid}:{processStartEpoch}` |
| `cwd` | 显式参数 > `process.cwd()` |
| `agentVersion` | MCP `initialize` 的 `clientInfo.version` |
| `conversationName` | 显式参数；无则为空，不猜 |

- `processStartEpoch = Math.floor(Date.now() - process.uptime() * 1000)`，模块加载时计算。
- stdio MCP 每个会话一个进程，进程指纹在一次会话内稳定，足以区分对话。
- Claude Code 已实测注入 `CLAUDE_CODE_SESSION_ID`，可拿到真实会话 ID。
- HTTP 人工写入固定 `tool='manual'`，无 `conversationId`。

### 5.2 展示

- 卡片列表显示工具徽标 + 对话名称 + 对话 ID 前 8 位；短 ID 悬停可看全文、点击复制完整 ID。
- 无对话名称时显示「未命名对话」；人工创建显示「手工创建」。
- 演进时间线逐版显示工具、对话名称、对话 ID 短号、日期（默认一对话一卡；显式跨对话续写时仍按版记录来源）。

## 6. 存储与并发

- 文件：`~/.ai-task-flow/conclusions.json`，根结构 `ConclusionData`。
- 路径通过 `resolveDataDir()` 获取，禁止自行拼 home。
- 写协议复用 worklog 的成熟实现：
  1. 进程内 promise-chain mutex（`JsonRepository.withWriteLock`）
  2. proper-lockfile 跨进程文件锁
  3. 锁内重读 → 修改 → `write-file-atomic` 原子写
- **追加必须在一次 `mutate(fn)` 内完成**：读卡、算 `rev + 1`、追加、写回。禁止 `load() → push → save()`。
- 首次读取文件不存在 → 返回 `{ schemaVersion: 1, conclusions: [] }`，不创建空文件。
- 备份：`~/.ai-task-flow/conclusion-backups/`，滚动 10 份；仅在**删除**与**元信息 PATCH** 前快照；纯追加不备份。
- JSON 损坏：读取失败，不覆盖原文件；返回 500 并记录文件路径。

## 7. MCP 工具

工具总数从 10 增至 12。元数据（name/description/whenToUse/示例话术）放 `shared/src/conclusion/mcpToolCatalog.ts`，与前端引导同源。

### 7.1 `record_conclusion`

**按会话自动 upsert：** 不传 `cardId` 时，服务端用来源 `conversationId` 在当前会话内查找：

- 找到 → 追加新版（同一会话多版演进）
- 没找到 → 新建

AI **不需要先调用 `query_conclusions`**，也**禁止用 keyword 搜索**来定位/复用旧卡；写入路径完全不依赖模糊匹配。只有用户明确要求更新另一张指定卡时才传 `cardId`；显式跨对话更新需 `allowCrossConversation=true`。

**描述必须包含的四条约束：**

1. 仅当用户明确要求记录结论时调用；不要主动捕获。
2. 自动续写无需查询；显式 `cardId` 追加前按 `cardId` 读取最新版。
3. 追加时省略的字段**沿用上一版**，显式传 `""` / `[]` 表示清空；服务端仍存完整快照。
4. 追加必须提供 `changeNote`，建议同时带 `expectedRev`（读取到的版本号）；不一致时返回 409，需重读后再写。

**入参：**

```jsonc
{
  "cardId": "c_abc123",       // 可选；有 = 追加，无 = 新建
  "expectedRev": 3,            // 可选；追加时建议传，防并发覆盖
  "scope": "project",          // project | personal
  "project": "ai-task-flow",   // scope=project 必填
  "version": "v0.3",           // 可选
  "title": "结论主题",          // 新建必填；追加时可更新
  "tags": ["架构"],
  "decision": "结论/决策 + 理由",   // 新建必填；追加时省略 = 沿用
  "data": "关键数据/命令结果",      // 追加时省略 = 沿用；传 "" = 清空
  "openItems": "待办/未决问题",
  "codeRefs": [{ "path": "backend/src/x.ts", "startLine": 10, "endLine": 30, "note": "..." }],
  "date": "2026-11-18",        // 本版业务日期，默认当天
  "changeNote": "补了澳门环境返回，结论从 A 改为 B", // 追加必填
  "conversationName": "worklog 全局搜索方案"
}
```

**追加合并规则：**

| 提交情况 | 结果 |
|---|---|
| 字段未出现 | 沿用上一版值 |
| `decision: "..."` | 替换该节 |
| `data: ""` / `codeRefs: []` | 清空该节 |
| 只改了 `title` / `tags` 等元信息 | 允许，但仍需 `changeNote` |
| 来源 `conversationId` 与卡片归属不同 | 409（默认一对话一卡，归属看卡片级字段而非 latest）；显式 `allowCrossConversation=true` 才允许 |
| 没有任何变化 | 400，不产生空版本 |

**返回：**

```text
✅ 已创建结论卡 c_abc123（项目 ai-task-flow · rev 1）
后续更新请带 cardId=c_abc123
```

```text
✅ 已追加到 c_abc123 → rev 3
变更说明：补了澳门环境返回，结论从 A 改为 B
```

**与 `record_work` 的区分**（两个工具描述互相点名）：

- `record_work`：记录**代码变更**（diff、文件、行号）。
- `record_conclusion`：记录**讨论结论、决策理由、关键数据**，即使本次没有改代码。

**定位规则**：用户说“更新刚才那个结论”但上下文没有 `cardId` 时，先调 `query_conclusions` 按项目/标题查找；找不到再新建，禁止凭猜测重复建卡。

### 7.2 `query_conclusions`

**用途**：已知 `cardId` 时**直接读取当前进度**；只有不知道 ID 且用户明确要求查找/回看时才做全库搜索。**禁止在已知 `cardId` 时再用 keyword 搜索，也禁止把 keyword 当作写前自动匹配/复用旧卡的手段。** 两种模式：

| 模式 | 条件 | 返回 |
|---|---|---|
| 搜索 | 不传 `cardId` | 匹配卡的摘要列表（含 `cardId`、`rev`、最新结论摘要、`matchedRev`） |
| 详情 | 传 `cardId` | 该卡**最新版完整四节** + 演进摘要列表 |

**入参：**

```jsonc
{
  "cardId": "c_abc123",      // 可选；传 = 详情模式
  "scope": "project",
  "project": "ai-task-flow",
  "version": "v0.3",
  "keyword": "全局搜索",      // 匹配 title + 全部 revisions 的 decision/data/openItems/changeNote/codeRefs.path
  "tags": ["架构"],
  "dateFrom": "2026-11-01",  // 按最新版 date 过滤
  "dateTo": "2026-11-30",
  "limit": 20,               // 默认 20，最大 50
  "includeHistory": false    // 仅详情模式生效；true 时额外返回每版全文
}
```

**详情模式返回：**

```ts
interface ConclusionDetail {
  id: string;
  scope: ProblemScope;
  project?: string;
  version?: string;
  title: string;
  tags?: string[];
  rev: number;
  /** 最新版完整内容——AI 更新前据此判断改哪一节 */
  latest: ConclusionRevision;
  /** 演进摘要（不含各版全文） */
  revisions: Array<Pick<ConclusionRevision, 'rev' | 'date' | 'changeNote' | 'createdAt'> & {
    tool: string;
    conversationName?: string;
  }>;
  /** includeHistory=true 时才有，按 rev 升序 */
  history?: ConclusionRevision[];
  createdAt: number;
  updatedAt: number;
}
```

**搜索模式返回** `ConclusionSummary[]`：

```ts
interface ConclusionSummary {
  id: string;
  scope: ProblemScope;
  project?: string;
  version?: string;
  title: string;
  tags?: string[];
  rev: number;
  latestDate: string;
  latestDecisionExcerpt: string;   // 截断 1500 字
  source: Pick<ConclusionSource, 'tool' | 'conversationName'>;
  /** keyword 命中的历史版本号；未命中历史则为 undefined */
  matchedRev?: number;
  createdAt: number;
  updatedAt: number;
}
```

## 8. HTTP API

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/api/conclusions` | 列表摘要；支持 scope/project/version/keyword/tags/dateFrom/dateTo/limit |
| `GET` | `/api/conclusions/:id` | 单卡详情，含全部 revisions |
| `POST` | `/api/conclusions` | 新建 |
| `POST` | `/api/conclusions/:id/revisions` | 追加一版（人工编辑走这里） |
| `PATCH` | `/api/conclusions/:id` | 只改元信息（title/scope/project/version/tags） |
| `DELETE` | `/api/conclusions/:id` | 删除，先备份 |

### 8.1 请求/响应要点

- 列表按最新版 `date` 倒序，同日按 `updatedAt` 倒序；`limit` 默认 50，最大 200。
- 列表返回 `ConclusionSummary`，不做全量 revisions；`latestDecisionExcerpt` 截断 1500 字（中文下约 3–5 行，与 MCP 查询一致）。
- 详情返回完整 `Conclusion`；前端展开卡片或演进时按需拉详情。
- `tags` 过滤为“命中任一标签”。
- `dateFrom/dateTo` 按**最新版** `date` 过滤；`date` 缺省为服务端本地当天。
- `cardId` 精确查询优先于其他过滤条件，命中即返回单张。
- 人工追加：服务端强制 `source.tool='manual'`；`changeNote` 默认“人工修订”（前端填入，后端仍要求非空）。
- 追加合并语义与 MCP 一致：省略字段沿用上一版，显式空值清空；前端编辑表单加载完整最新版后提交，行为可预测。
- 追加可带 `expectedRev`；与当前最新版不一致 → 409，前端提示“已被其他操作更新，请刷新后重试”。
- 默认一对话一卡：AI 追加时若来源对话与**卡片归属**（创建时确定）不同 → 409；人工编辑（`manual`，无 conversationId）放行且不改变归属；用户确认跨对话续写时才传 `allowCrossConversation=true`，该次追加也不改变归属。
- PATCH 不允许修改 `revisions`；同样执行第 4.2 节全部不变量校验；修改标题等元信息不产生新版本，但 PATCH 前备份。
- DELETE 返回 `{ deleted: true }`；备份路径不返回，页面只提示“已自动备份”。

### 8.2 校验与错误

| 情况 | 状态 | 错误 |
|---|---|---|
| `scope=project` 但 `project` 为空 | 400 | `ConclusionValidationError` |
| `scope=personal` 却传 `project`/`version` | 400 | `ConclusionValidationError` |
| `decision` 为空 | 400 | `ConclusionValidationError` |
| 追加缺 `changeNote` | 400 | `ConclusionValidationError` |
| 追加时 `expectedRev` 与当前版本不一致 | 409 | `ConclusionConflictError` |
| 追加时来源对话与上一版不同且未显式允许 | 409 | `ConclusionConflictError` |
| `cardId` 不存在 | 404 | `ConclusionNotFoundError` |
| JSON 损坏 / 写盘失败 / 锁超时 | 500 | `ConclusionStorageError` |

复用 `DomainError` → HTTP 状态码机制，禁止字符串匹配。

### 8.3 前端接口层

- `frontend/src/api/conclusion.ts`：`list/get/create/append/patch/remove`
- 写操作成功后重新拉取列表或详情，不做乐观更新。
- 状态用视图内局部 `useState`（与 `WorklogView` 一致），不新增全局 store（遵循项目“能局部不上全局”约定）。

## 9. 前端页面

### 9.1 入口与布局

- 侧边栏新增 `conclusion`（标签「结论」，图标 `Lightbulb`）。
- 两栏布局：左侧项目/个人分组 + 搜索；右侧卡片流 + 新建按钮。
- 不做三栏，避免打断“一页读完”。

### 9.2 卡片列表项

折叠态：

- 标题、`rev N`、最新日期、工具徽标、版本、标签
- 对话行：对话名称 + 对话 ID 前 8 位（悬停看全文、点击复制完整 ID）；无名称显示「未命名对话」，人工创建显示「手工创建」
- 最新 `decision` 摘要（3 行，来自列表摘要；展开时拉详情取全文）
- 搜索命中历史版时显示“命中 rev N”

展开态：

- 宽屏两栏：左侧正文（最大 72ch，正文 15px / 行高 1.8），右侧来源、演进、操作；窄屏自动堆叠
- 结论/决策 + 理由默认展开；超过 1200 字默认折叠，提供「展开全文」
- 关键数据/命令结果、待办/未决问题、代码/文件位置默认折叠，节标题带图标；展开后限高滚动，避免卡片被长文拉成几千像素
- 代码/文件位置按「路径一行 + 说明一行 + 复制按钮」块级渲染，长路径自动换行
- 旧数据兼容：显示层把 `①②③` 转列表、`★` 转小标题、`; 2.` 拆行、补有序列表数字后的空格；不改落库内容
- 正文开头若自带「结论/决策」等同名节标题，UI 去除，避免重复
- 空节自动隐藏
- 操作放在右侧栏：编辑（追加新版）、改信息、删除

### 9.3 演进时间线

- 点「演进 (N)」在卡片内展开，最新在上；宽屏时位于右侧栏，使用 compact 模式。
- 每版显示：`rev`、日期、工具、对话名称、对话 ID 短号、`changeNote`、四节全文（可折叠）。
- 搜索命中历史版时自动展开对应版本并高亮。

### 9.4 新建/编辑

- 共用表单：scope 切换 → 项目名（datalist 提供现有项目名，防拼写裂树）→ 版本（可选）→ 标题 → 四节 Markdown → 标签。
- 编辑保存 = 追加新版（`tool=manual`，`changeNote` 默认“人工修订”，可改），不覆盖历史。
- 改信息不产生新版本。
- 删除二次确认，提示自动备份。

### 9.5 空状态

显示可复制提示词：

```text
把刚才的结论记到 ai-task-flow，项目 <项目名>：
结论/数据/待办/涉及文件
```

搜索无结果时区分“项目内无结果”和“全部无结果”，并提供清除筛选。

### 9.6 组件划分

```text
frontend/src/components/views/ConclusionView.tsx
frontend/src/components/conclusion/
  ConclusionCardItem.tsx      # 列表项（折叠/展开）
  ConclusionForm.tsx          # 新建/追加表单
  ConclusionProjectList.tsx   # 项目/个人分组
  RevisionTimeline.tsx        # 演进时间线
frontend/src/api/conclusion.ts
```

`ConclusionView` 只做布局与数据入口，目标 ≤ 300 行。

## 10. 错误处理与恢复

- 存储失败一律“失败关门”：不覆盖旧文件、不返回成功。
- 删除前备份失败 → 中止删除。
- MCP 错误返回 `{ isError: true, content: [{ type: 'text', text: '❌ ...' }] }`。
- 前端写失败 toast 显示后端 message，表单内容保留。
- 恢复步骤写入页面帮助与本文档：停止后端/MCP → 用 `conclusion-backups/backup-*.json` 覆盖 `conclusions.json` → 重启。

## 11. 安全

- 结论卡可能包含接口返回、URL、内部数据；工具描述明确要求**禁止记录密钥、令牌、个人敏感信息**。
- 服务无鉴权，维持仅监听 `127.0.0.1`。
- 数据仅本地存储，不提供外部分享/导出。

## 12. 测试策略

| 层 | 用例 |
|---|---|
| domain | 新建不变量；追加 rev 单调；latest 取最后一版；非法字段拒绝 |
| application | 创建/追加/查询；keyword 覆盖全部历史并返回 `matchedRev`；日期边界；搜索模式摘要截断；详情模式返回最新版完整内容；省略字段沿用/空值清空；`expectedRev` 冲突；人工追加来源为 manual |
| repository | 原子写；两进程并发追加不丢版本；损坏 JSON 不被覆盖；备份滚动 10 份 |
| HTTP | 6 端点正常/异常；400/404/500 映射；过滤组合 |
| MCP | 工具清单 12 个；创建/追加；缺 `changeNote` 拒绝；来源解析优先级；`query_conclusions` 搜索定位与详情读取；省略字段合并；`expectedRev` 409 |
| frontend | 项目/个人分组；历史命中高亮；空节隐藏；演进展开；表单校验；编辑=追加 |
| E2E curl | `tests/curl/test_conclusion_crud.sh`：创建 → 详情读取 → 部分字段追加（验证沿用/清空）→ 查询命中历史 → `expectedRev` 冲突 → PATCH → 删除 |
| 并发冒烟 | HTTP 与 MCP 同时追加同一张卡，`rev` 不重复、无丢更新 |
| 手工 | Claude Code / ZCode 各说一次“记一下”，页面可见且来源字段正确 |

## 13. 实施顺序（TDD）

| 步 | 内容 | 验收 |
|---|---|---|
| 1 | `shared`：类型、catalog、常量与校验规则 | `tsc` 通过 |
| 2 | `domain/conclusion`：`Conclusion` 聚合、错误、仓储接口 | 领域单测全绿 |
| 3 | `infrastructure`：`JsonConclusionRepository`（锁/原子写/备份） | 仓储单测 + 并发测试 |
| 4 | `application`：`ConclusionService`（create/append/patch/delete/query） | 服务单测 |
| 5 | `interfaces`：来源解析器 | 优先级单测 |
| 6 | `interfaces/http`：6 个路由 + `startApp` 装配 | 路由单测 + curl |
| 7 | `interfaces/mcp`：2 个工具 + 注册 | 工具单测 + stdio 冒烟 |
| 8 | `frontend`：api/store/view/组件 + 侧边栏 | 组件单测 + 页面冒烟 |
| 9 | 收尾：E2E、全量测试、文档更新 | 全绿 |

### 文档与红线同步（第 9 步）

- `README.md`：功能模块表新增“结论卡”；测试数量更新。
- `.claude/CLAUDE.md`：模块清单、MCP 工具数 10 → 12、数据文件列表新增 `conclusions.json`。
- `docs/mcp-registration.md`：工具清单、当前版本回写。
- `tests/run_all.sh` 自动纳入新 curl 脚本（无需改脚本，命名匹配 `test_*.sh`）。

## 14. 风险与应对

| 风险 | 应对 |
|---|---|
| AI 把结论写进 worklog / 把 diff 写进结论卡 | 两个工具描述互相点名；实施后实测 Claude Code 与 ZCode |
| 用户忘记触发记录 | 空状态提示词；侧边栏入口；工具描述给出示例话术 |
| 单 JSON 文件增长 | v1 可接受；超过 1 万张卡或 50MB 再拆文件/分页 |
| 进程指纹不直观 | 主视觉只显示工具 + 对话名；ID 收进 tooltip |
| AI 基于过期内容追加，覆盖他处更新 | 工具描述强制先读；`expectedRev` 提供乐观锁，不匹配 409 |
| AI 漏传某节导致信息丢失 | 省略=沿用上一版；只有显式空值才清空 |
| 历史版本过多导致卡片过长 | 演进默认折叠；详情只渲染最新版 |
| 误删 | 删除前备份 + 二次确认 + 恢复步骤文档化 |

## 15. 未来扩展（不在本 spec）

- 逐版 diff、回退、单版删除
- AI 自动召回：新会话按项目/关键词注入相关结论
- 导出 Markdown / 与知识库互链
- 项目重命名合并、分页与虚拟滚动
