# AI Task Flow MCP 工具使用指南

> 本看板自带的 MCP server（stdio），供 Claude Code 拉取任务、回写结果、写入知识库。
> 挂载配置见「一、挂载到 Claude Code」；前端「设置 → MCP 挂载」Tab 有相同说明。

---

## 一、挂载到 Claude Code（stdio）

本项目 MCP server 是 **stdio** 传输，入口 `backend/dist/interfaces/mcp/server.js`（需先 `npm run build:backend`），提供 **6 个工具**：`list_pending_tasks` / `get_task` / `record_result` / `complete_step` / `add_note_to_task` / `save_to_knowledge`。

项目根已自带 `.mcp.json`（随 git 走，团队共享）：

```json
{
  "mcpServers": {
    "ai-task-flow": {
      "command": "node",
      "args": ["backend/dist/interfaces/mcp/server.js"]
    }
  }
}
```

**启用**：在项目根打开 Claude Code → 首次弹窗「是否加载此 MCP server」→ 允许 → 会话内 `/mcp` 看到 `ai-task-flow: ✔ connected`。

**三种挂载方式**：

| 方式 | 做法 | 适用 |
|------|------|------|
| 项目级（推荐） | 自带 `.mcp.json`，相对路径 | 团队共享，随 git |
| 用户级 | `claude mcp add --scope user ai-task-flow node -- backend/dist/interfaces/mcp/server.js` | 只给自己，不入 git |
| dev 模式（改源码免 build） | `command: "npx"`, `args: ["tsx", "backend/src/interfaces/mcp/server.ts"]` | 调试 MCP 代码 |

**坑（重要）**：
- Windows 路径用正斜杠 `/`；`.mcp.json` **不支持** `${workspaceFolder}`（那是 VSCode 变量，Claude Code 不替换）。
- 项目级方式依赖 `dist`，改了 MCP 代码须重新 `npm run build:backend`（dev 模式除外）。
- 运行依赖 `~/.ai-task-flow/tasks.json`（换机器需建一个空的）和 `shared/dist`（须 `build:shared`）。
- **别用** `claude_desktop_config.json`——那是 Claude Desktop 的，不是 Claude Code。

**一键脚本**：嫌手动麻烦，在项目根跑：

```bash
npm run setup:mcp   # 检查 build → 初始化数据文件 → 写 .mcp.json → claude mcp add 注册
```

脚本（`scripts/setup-mcp.mjs`）会：检查 `backend/dist/.../server.js`（缺失自动 build）→ 确保 `~/.ai-task-flow/tasks.json` → 写项目级 `.mcp.json` → 调 `claude mcp add -s local` 注册（local scope 已被信任，可跳过首次信任弹窗）。

---

## 二、可用工具（6 个）

| 工具 | 作用 | 关键参数 |
|------|------|---------|
| 🔍 `list_pending_tasks` | 列出待办 / 进行中任务 | `status`：`todo` \| `pending` \| `all`，默认 `pending` |
| 📋 `get_task` | 任务详情（Markdown，含步骤勾选 + 截图本地双路径） | `taskId` |
| ✅ `record_result` | 回写**整任务**结果 | `taskId`、`status`、`changedFiles`、`notes` |
| ☑️ `complete_step` | 回写**单步**完成度，自动推进状态 | `taskId`、`stepNumber`（1-based）、`completed?` |
| 📝 `add_note_to_task` | 追加备注到任务描述 | `taskId`、`note` |
| 💾 `save_to_knowledge` | 沉淀结论到知识库 | `title`、`content`、`tags?`、`dir?` |

> 整任务完成用 `record_result`；单步进度用 `complete_step`。两者都驱动状态机（见第三节）。

### 🔍 list_pending_tasks — 列出待办任务

| `status` 取值 | 含义 |
|------|------|
| `todo` | 仅待办 |
| `pending`（**默认**） | 待办 + 进行中（进行中的任务 Claude 也要能继续推进） |
| `all` | 全部 |

返回 Markdown 表格（ID / 标题 / 优先级 / 状态 / 项目）。

### 📋 get_task — 获取任务详情

- 参数：`taskId`（必需，如 `"WS-001"`）
- 返回 Markdown，含：描述、**任务步骤（带 ☑/☐ 勾选状态）**、相关文件、执行结果。

**截图处理（WSL / Windows 双路径）**：任务步骤里的截图原本是 `http://localhost:5678/api/uploads/...` 链接，**WSL 侧 Claude Code 访问不到**（死链）。`get_task` 会把每张本服务上传的图替换成两种**本地路径**，按运行环境用 `Read` 读取即可，无需走 HTTP，也不占上下文 token：

```
（截图 1:按你的环境用 Read 读取本地文件）
  - WSL:     /mnt/c/Users/<user>/.ai-task-flow/uploads/xxx.png
  - Windows: C:\Users\<user>\.ai-task-flow\uploads\xxx.png
```

### ✅ record_result — 记录执行结果（整任务）

| 参数 | 必需 | 说明 |
|------|:----:|------|
| `taskId` | ✅ | |
| `status` | ✅ | `done` \| `partial` \| `blocked` |
| `changedFiles` | ✅ | 变更文件列表 |
| `notes` | ✅ | 执行备注 |
| `reviewPoints` | — | 审核要点 |
| `blockedReason` | — | `status=blocked` 时填 |

- 会话化后 **`TODO` 状态可直接回写**，无需先派发。
- `done` / `partial` → 任务转 `DONE`，并**兜底全勾所有步骤**（避免「已完成但卡片进度停在 0/N」）。
- `blocked` → 转 `BLOCKED`。

### ☑️ complete_step — 回写单步完成度

每完成一步调用一次，按步骤完成度**自动推进任务状态**。

| 参数 | 必需 | 说明 |
|------|:----:|------|
| `taskId` | ✅ | |
| `stepNumber` | ✅ | 步骤序号，**1-based**（对应 `get_task` 显示的「步骤 1/2/3」） |
| `completed` | — | `true`（默认）/ `false`（取消完成） |

- 勾某步、但未全完成 → 任务 `TODO → IN_PROGRESS`。
- 所有步骤都勾完 → 任务自动转 `DONE`。
- 返回当前进度 `N/M` 与任务状态。

### 📝 add_note_to_task — 添加备注

- 参数：`taskId`（必需）、`note`（必需）
- 追加到任务描述末尾。

### 💾 save_to_knowledge — 写入知识库

- 参数：`title`（必需）、`content`（必需，Markdown 正文）、`tags`（可选）、`dir`（可选，相对 `knowledge-base/` 的子目录）
- 文件名由服务端按命名规则生成，调用方无法干预物理文件名。

---

## 三、任务状态机（四态）

```
   complete_step 勾某步(未全完)
        TODO ───────────────────────────► IN_PROGRESS
         │                                    │
         │  complete_step 全勾 / record(done)  │  complete_step 全勾 / record(done)
         └──────────────► DONE ◄───────────────┘

   任意态 ──record_result(blocked) / 拖「已阻塞」列──► BLOCKED
   DONE ──(重开)──► TODO     （步骤勾选保留，不重置）
```

| 动作 | 流转 | 备注 |
|------|------|------|
| `complete_step` 勾某步 | `TODO → IN_PROGRESS` | 未全完成即推进 |
| 步骤全部勾完 | `* → DONE` | `setStepCompleted` 检测到全勾 |
| `record_result(done/partial)` / 拖「已完成」列 | → `DONE` | **兜底全勾步骤** |
| `record_result(blocked)` / 拖「已阻塞」列 | → `BLOCKED` | |
| 重开已完成任务 | `DONE → TODO` | 步骤勾选保留 |

> 非法流转（如 `DONE → IN_PROGRESS`）会抛错；PATCH 走 `transitionTo`，非法流转返回 400。

---

## 四、完整工作流（会话化）

```
1. list_pending_tasks()                  # 看有哪些待办 / 进行中
2. get_task(taskId: "WS-001")            # 读详情(含步骤勾选 + 截图本地路径)
3. 在 Claude Code 里改代码、验证
4. complete_step(taskId, stepNumber: 1)  # 每完成一步回写(推进到进行中,可选)
   ...
5. record_result(taskId, status:"done", changedFiles:[...], notes:"...")  # 整任务完成
6. （可选）save_to_knowledge(...)         # 沉淀结论
```

> 会话化后**没有「派发 → 审核」两段式**：打开终端不改状态，`TODO` 直接回写结果即完成。旧数据里的 `dispatched` / `review` 加载时自动归一为 `TODO`。

---

## 五、手动验证 / 测试

```bash
cd backend && npm run mcp:dev   # 直接跑 stdio,可配合 MCP Inspector 测试
cd backend && npm test          # 单元测试(覆盖所有 MCP 工具)
```

---

## 六、故障排查

**找不到任务文件** `ENOENT`：初始化数据文件
```bash
mkdir -p ~/.ai-task-flow
echo '{"tasks":[],"nextId":1}' > ~/.ai-task-flow/tasks.json
```

**Server 无法启动** `Cannot find module`：先构建
```bash
npm run build   # 含 build:shared + build:backend
```

**`/mcp` 里连不上 / 工具不出现**：
- 确认在**项目根**打开 Claude Code（相对路径才能解析）
- 确认首次弹窗点了「允许」
- `/mcp` → 选 `ai-task-flow` → 查看连接错误日志
- 新增工具（如 `complete_step`）需**重连 MCP** 才会出现在工具清单里

---

**文档版本**：v0.3.0（2026-07-24 更新，对齐四态状态机 + `complete_step` 工具 + 截图双路径）
