# AI Task Flow MCP 工具使用指南

> 本看板自带的 MCP server（stdio），供 Claude Code 拉取任务、回写结果、写入知识库。
> 挂载配置见「一、挂载到 Claude Code」；前端「设置 → MCP 挂载」Tab 有相同说明。

---

## 一、挂载到 Claude Code（stdio）

本项目 MCP server 是 **stdio** 传输，入口 `backend/dist/interfaces/mcp/server.js`（需先 `npm run build:backend`），提供 5 个工具：`list_pending_tasks` / `get_task` / `record_result` / `add_note_to_task` / `save_to_knowledge`。

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

## 二、可用工具（5 个）

### 🔍 list_pending_tasks — 列出待办任务
- 参数：`status`（可选，`"todo"` | `"all"`，默认 `"todo"`）
- 返回 Markdown 表格（ID / 标题 / 优先级 / 状态 / 项目）。

### 📋 get_task — 获取任务详情
- 参数：`taskId`（必需，如 `"WS-001"`）
- 返回含描述、任务步骤（带 ☑/☐ 勾选状态）、相关文件、执行结果的 Markdown。

### ✅ record_result — 记录执行结果
- 参数：
  - `taskId`（必需）
  - `status`（必需）：`"done"` | `"partial"` | `"blocked"`
  - `changedFiles`（必需）：变更文件列表
  - `notes`（必需）：执行备注
  - `reviewPoints`（可选）：审核要点
  - `blockedReason`（可选，`status=blocked` 时）
- 会话化后 **`TODO` 状态可直接回写**，无需先派发。

### 📝 add_note_to_task — 添加备注
- 参数：`taskId`（必需）、`note`（必需）
- 追加到任务描述末尾。

### 💾 save_to_knowledge — 写入知识库
- 参数：`title`（必需）、`content`（必需，Markdown 正文）、`tags`（可选）、`dir`（可选，相对 `knowledge-base/` 的子目录）
- 文件名由服务端按命名规则生成，调用方无法干预物理文件名。

---

## 三、完整工作流（会话化）

```
1. list_pending_tasks()        # 看有哪些待办
2. get_task(taskId: "WS-001")  # 读详情(含步骤、相关文件)
3. 在 Claude Code 里改代码、验证
4. record_result(taskId, status:"done", changedFiles:[...], notes:"...")  # 回写结果
5. （可选）save_to_knowledge(...)  # 沉淀结论到知识库
```

> 会话化改造后**不再有「派发 → 审核」两段式**：任务一直是 `TODO`，打开终端不改状态，`TODO` 直接回写结果即完成。旧数据里的 `dispatched` / `review` 状态加载时自动归一为 `TODO`。

---

## 四、手动验证 / 测试

```bash
cd backend && npm run mcp:dev   # 直接跑 stdio,可配合 MCP Inspector 测试
cd backend && npm test          # 单元测试(覆盖所有 MCP 工具)
```

---

## 五、故障排查

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

---

**文档版本**：v0.2.0（2026-07-23 更新，对齐会话化改造后的 5 个工具与三态状态机）
