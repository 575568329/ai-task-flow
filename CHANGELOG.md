# 更新日志 (CHANGELOG)

本项目所有重要变更均记录在此文件中。

格式遵循 [Keep a Changelog 1.1.0](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。
参考实例：[Vue core](https://github.com/vuejs/core/blob/main/CHANGELOG.md)、[Vite](https://github.com/vitejs/vite/blob/main/CHANGELOG.md)。

> 分类约定：`🟢 新增(Added)` / `🔵 变更(Changed)` / `🟠 修复(Fixed)` / `🔴 移除(Removed)` / `🔒 安全(Security)`
> 版本由旧到新自上而下阅读；最新版本在最上方。

---

## [Unreleased]

_待发布内容。开发中的变更先记在这里，发版时改为正式版本号。_

---

## [0.2.0] - 2026-06-16

> 提交：`3e23ac6` · 关键词：存储健康、局域网可用性、LLM 多协议、连接可观测性

### 🟢 新增 (Added)

- **存储健康监控与自主清理**
  - 新增 `StorageService`：扫描数据目录 6 类（tasks / chats / events / uploads / taskDocs / logs），统计大小
  - 告警阈值：单项 **50MB**、总计 **100MB**；超阈值前端「设置」按钮显示红点徽标
  - 接口 `GET /api/system/storage`（查询）、`POST /api/system/storage/clear`（按类别清理）
  - 可清理类别：`events` / `uploads` / `taskDocs` / `logs`；业务数据（`tasks` / `chats`）仅显示大小，**不可整体清理**
  - 前端 `StorageManager` 组件：分类列表 + 每行清理按钮 + `ConfirmDialog` 二次确认
  - 设计原则：**不硬限制**——只监控 + 提示，由用户自主清理，清理前明确说明会清除哪些数据
- **LLM Anthropic 协议支持**
  - 新增 `AnthropicProvider`：走 `/v1/messages`，解析 SSE `content_block_delta`
  - 适配智谱 Coding Plan（glm-5.2）、Claude 官方等 Anthropic 协议端点
- **测试连接**：`POST /api/llm-config/test`，填完地址/Key/模型后一键验证，返回 `success / message / latencyMs / protocol`，错误透传（404 / 429 / 401）
- **协议实时显示**：设置页「API 地址」下方实时展示命中的协议（Anthropic / OpenAI 兼容）
- **页面可见性控制**：`/health` 返回 `localAccess` 字段（基于请求来源 IP 判定本机）

### 🔵 变更 (Changed)

- **LLM Provider 自动选协议**：`LlmConfigService.createProvider` 按 baseURL 正则 `/\/anthropic(\/|$)/i` 自动选择 Anthropic vs OpenAI 兼容协议
- **设置弹窗双 Tab**：新增「存储管理」Tab，与「LLM 配置」并列；存储告警时该 Tab 亦带红点
- **非本机页面屏蔽**：前端依据 `localAccess` 隐藏「设置」入口（公司内部项目定位：保持 `0.0.0.0` 局域网可用，但不向同事暴露敏感页；**不做鉴权**）
- **数据目录统一解析**：`JsonChatRepository` 改走 `resolveDataDir()`（原直接拼 `process.env.HOME`，导致 `--data-dir` 改目录时路径不一致、存储监控漏扫 `chats.json`）
- **发布三包版本** `0.1.3` → `0.2.0`（`shared` / `backend` / `cli`）

### 🟠 修复 (Fixed)

- **Anthropic 协议端点对话失败**：原 `.../api/anthropic` 被按 OpenAI 拼接 `/chat/completions` → 智谱 404，`streamText` 收 0 chunk，笼统报「模型没有返回内容」。改为协议自动选择 + `AnthropicProvider`
- **`currentProvider` 类型不兼容**：字段由具体类 `OpenAiCompatibleProvider` 改为接口 `LlmProvider`，否则替换为 Anthropic 实现时 TS 报「缺属性」
- **前端拿不到 shared 新类型**：`frontend/node_modules/@ai-task-flow/shared` 为陈旧物理副本（停留 v0.1.3），删除后回退到根 workspace symlink（详见底部「开发备忘」）

### 🔒 安全 (Security)

- API Key 在 GET 接口始终脱敏（如 `sk-1********4a`），明文仅存于服务端 `llm-config.json`（文件权限 `0600`）；非本机访问时设置入口被隐藏，Key 明文本就不下发

---

### ⚠️ v0.2.0 开发踩坑与关键决策

> 本次开发中遇到的真实问题，便于后续维护者避坑。

1. **前端 shared 包符号链接陷阱（最隐蔽）**
   - 现象：新增 shared 类型（`Conversation` / `ChatMessage` / `Source` / `StorageInfo`）后，前端构建报「模块无此导出」
   - 根因：`frontend/node_modules/@ai-task-flow/shared` 不是 workspace symlink，而是某次 install 留下的**陈旧物理拷贝**（停留 v0.1.3），shared 的任何变更都到不了前端
   - 修复：删除该物理目录，npm 自动回退到根 `node_modules` 的 workspace symlink
   - 教训：改 shared 类型后若前端构建报缺导出，**先检查该目录是不是 symlink**（`ls -la frontend/node_modules/@ai-task-flow`）

2. **智谱 web_search_prime 的三重 JSON 编码**
   - MCP `tools/call` 结果是 SSE 帧，`result.content[0].text` 本身又是一层 JSON 字符串，再解一次才是 `[{title,link,content}]`；实测层数为 3
   - `GlmWebSearchClient` 用循环解包兼容 2/3 层；部分 URL 双重编码（`%25` 是 `%` 的编码），由 `fixDoubleEncodedUrl` 还原，解码失败回退原值不抛错

3. **MCP 必须先握手**
   - 智谱 MCP 端点要求先 `initialize` 拿 `Mcp-Session-Id`，再带 session id 调 `tools/call`，否则鉴权随机 401

4. **Coding Plan Key：chat 余额 ≠ 搜索权限**
   - paas/v4 的 glm-4-plus chat 接口对 Coding Plan key 返回 429（余额/权限），但 `web_search_prime` MCP 工具仍可正常调用（实测「Vue 3.0 发布」返回 5 条来源）。两者计费/权限独立，勿因 chat 429 误判搜索不可用

5. **Windows 下 curl 中文 body 的 Content-Length 错误**
   - curl 在 Windows 计算含中文 body 的 `Content-Length` 偶发错误 → 改用 node fetch 发请求（正确按字节计算）

6. **Git Bash 传 PowerShell 脚本的变量吞没**
   - `powershell -Command "...$_..."` 用双引号包裹时，`$_` / `$ids` 会被 bash 当变量替换吃掉
   - 解决：用**单引号**包裹整个 PowerShell 脚本，让 `$_` 透传给 PowerShell

---

## [0.1.x] - 早期版本（2026-06 初 ~ 06-15）

> 早期版本未单独维护 CHANGELOG，以下为 git 历史概要；详细设计见 `docs/` 下各文档。

- **0.1.3 及相邻**：左侧导航统一、任务文档中心（含项目文件树）、删除二次确认、LLM 配置中心化（`llm-config.json` 热更新）、资料调研聊天体验升级、多项 Windows/交互修复
- **0.1.0（MVP 首版）**：任务看板（DDD 四层 domain/application/infrastructure/interfaces + EventBus）、MCP Server 5 工具（`list_pending_tasks` / `get_task` / `record_result` / `get_task_diff` / `add_note_to_task`）、git worktree 隔离、SSE 实时同步、JSON 文件存储

---

## 📌 跨版本注意事项 / 开发备忘（长期维护）

> 以下约束与坑跨越多个版本，新增功能或重构时务必遵守。

### 存储

- **对话存储**：`~/.ai-task-flow/chats.json` 文件存储（**非纯内存**），`JsonChatRepository` 每次「读全文 → 改 → 写全文」，**无内存缓存**
  - 重启不丢失；但对话量增大后单次写 I/O 变重，多请求并发存在「后者覆盖前者」窗口（MVP 单人场景可接受）
  - 优化方向（暂未实施）：内存缓存 + 写回；或每会话独立 `.jsonl` 增量追加
- **数据目录解析优先级**：CLI `--data-dir` > 环境变量 `AI_TASK_FLOW_DATA_DIR` > 默认 `~/.ai-task-flow`。所有持久化路径**必须**走 `backend/src/config/dataDir.ts`，禁止散落 `os.homedir()`

### LLM 协议

- **协议自动选择规则**：baseURL 含 `/anthropic`（路径段）→ Anthropic 协议（`/v1/messages`）；其余 → OpenAI 兼容（`/chat/completions`）
- 新增协议（如 Gemini 原生）需在 `createProvider` 扩展匹配规则 + 实现 `LlmProvider` 接口
- `currentProvider` 字段类型必须声明为接口 `LlmProvider`，**不可**写死为某个具体实现类

### 资料检索（Chat）

- **搜索源**：
  - GLM Web Search（`web_search_prime` MCP，端点 `open.bigmodel.cn/api/mcp/web_search_prime/mcp`）—— 每次必搜，复用 bigmodel apiKey
  - arXiv（`export.arxiv.org/api/query`，3 req/s 限速）—— 仅当分类器判定 `academicSearch` 时触发
- **编排**（`SearchOrchestrator`，借鉴 Perplexica）：分类器改写 ≤3 条检索词 → 并行检索 → URL 去重合并 → 上限 6 源 → RAG 带 `[n]` 引用

### 安全

- API Key 明文存于 `llm-config.json`（`0600`），GET 接口脱敏，**永不下发明文**
- `0.0.0.0` 监听 = 局域网可访问；敏感入口靠 `localAccess`（`request.ip`）屏蔽，**非鉴权**。公网暴露务必自行加鉴权并改监听地址

---

<!-- 版本对比链接（需先在 GitHub 打对应 tag，未打 tag 时链接可能 404，但不影响阅读） -->
[Unreleased]: https://github.com/575568329/ai-task-flow/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/575568329/ai-task-flow/releases/tag/v0.2.0
