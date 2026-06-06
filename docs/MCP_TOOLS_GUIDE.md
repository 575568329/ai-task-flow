# AI Task Flow MCP 工具使用指南

## 快速开始

### 1. 配置 Claude Code

在你的 Claude Code 配置文件中添加 MCP Server：

**Windows 路径**: `C:\Users\57556\.claude\config\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ai-task-flow": {
      "command": "node",
      "args": [
        "C:/Users/57556/Desktop/ai-task-flow/backend/dist/interfaces/mcp/server.js"
      ],
      "env": {
        "AI_TASK_FLOW_PROJECT": "${workspaceFolder}"
      }
    }
  }
}
```

### 2. 启动 MCP Server

```bash
cd backend
npm run mcp:dev
```

## 可用工具（5个）

### 🔍 list_pending_tasks - 列出待办任务

**功能**: 获取所有 TODO 或 DISPATCHED 状态的任务列表

**参数**:
- `status` (可选): `"todo"` | `"dispatched"` | `"all"`，默认 `"todo"`

**示例输出**:
```markdown
# 待办任务列表

共 2 个任务

| ID | 标题 | 优先级 | 状态 | 项目 |
|----|------|--------|------|------|
| WS-001 | 测试 MCP 工具功能 | P0 | todo | ai-task-flow |
| WS-002 | 优化前端性能 | P1 | todo | ai-task-flow |
```

---

### 📋 get_task - 获取任务详情

**功能**: 获取任务的完整信息（Markdown 格式）

**参数**:
- `taskId` (必需): 任务ID，如 `"WS-001"`

**示例输出**:
```markdown
# 任务详情: WS-001

**标题**: 测试 MCP 工具功能
**优先级**: P0
**状态**: todo
**项目**: ai-task-flow
**仓库路径**: C:\Users\57556\Desktop\ai-task-flow

## 描述
验证 list_pending_tasks、get_task、record_result 等 5 个 MCP 工具是否正常工作

## 任务步骤
1. 使用 list_pending_tasks 列出所有待办任务
2. 使用 get_task 获取任务详情
3. 派发任务创建 worktree
4. 使用 record_result 记录执行结果
5. 使用 get_task_diff 查看变更

## 相关文件
- `backend/src/interfaces/mcp/server.ts`
```

---

### ✅ record_result - 记录执行结果

**功能**: 记录任务执行结果（完成、部分完成或阻塞）

**参数**:
- `taskId` (必需): 任务ID
- `status` (必需): `"done"` | `"partial"` | `"blocked"`
- `changedFiles` (必需): 变更的文件列表，如 `["src/server.ts", "src/routes.ts"]`
- `notes` (必需): 执行备注
- `reviewPoints` (可选): 审核要点列表
- `blockedReason` (可选): 阻塞原因（当 status 为 blocked 时）

**示例调用**:
```json
{
  "taskId": "WS-001",
  "status": "done",
  "changedFiles": ["backend/src/interfaces/mcp/server.ts"],
  "notes": "成功实现所有 5 个 MCP 工具，测试通过",
  "reviewPoints": [
    "确认工具返回格式正确",
    "检查错误处理逻辑"
  ]
}
```

---

### 🔄 get_task_diff - 获取 Git Diff

**功能**: 获取任务 worktree 的 git diff

**参数**:
- `taskId` (必需): 任务ID

**示例输出**:
```markdown
# Diff for Task WS-001

**Worktree**: `C:\Users\57556\Desktop\ai-task-flow\.ai-workspaces\WS-001`
**Branch**: `task/WS-001`

\`\`\`diff
diff --git a/backend/src/interfaces/mcp/server.ts b/backend/src/interfaces/mcp/server.ts
index 1234567..abcdefg 100644
--- a/backend/src/interfaces/mcp/server.ts
+++ b/backend/src/interfaces/mcp/server.ts
@@ -10,6 +10,7 @@
+  // 新增功能
\`\`\`
```

---

### 📝 add_note_to_task - 添加备注

**功能**: 为任务添加备注（追加到描述末尾）

**参数**:
- `taskId` (必需): 任务ID
- `note` (必需): 备注内容

**示例调用**:
```json
{
  "taskId": "WS-001",
  "note": "需要额外测试边界情况"
}
```

---

## 完整工作流示例

### 场景：执行一个任务

```bash
# 1. 列出待办任务
list_pending_tasks()
# 输出：WS-001, WS-002...

# 2. 获取任务详情
get_task(taskId: "WS-001")
# 输出：完整的任务描述、步骤、相关文件

# 3. 在看板上点击"派发"按钮（Web UI）
# 系统会自动创建 worktree

# 4. 在 Claude Code 中工作，修改代码

# 5. 记录执行结果
record_result(
  taskId: "WS-001",
  status: "done",
  changedFiles: ["backend/src/interfaces/mcp/server.ts"],
  notes: "实现完成，测试通过"
)

# 6. 查看 diff（可选）
get_task_diff(taskId: "WS-001")

# 7. 在看板上审核（Web UI）
# 审核通过后，系统会自动合并 worktree
```

---

## 测试验证

### 手动测试（使用 stdio）

```bash
cd backend
npm run mcp:dev
```

然后在另一个终端使用 MCP Inspector 或发送 JSON-RPC 消息测试。

### 单元测试

```bash
cd backend
npm test
```

所有 MCP 工具都有完整的单元测试覆盖。

---

## 故障排查

### 问题 1：找不到任务文件

**错误**: `ENOENT: no such file or directory`

**解决**: 确保 `~/.ai-task-flow/tasks.json` 存在：
```bash
mkdir -p ~/.ai-task-flow
echo '{"tasks":[],"nextId":1}' > ~/.ai-task-flow/tasks.json
```

### 问题 2：MCP Server 无法启动

**错误**: `Cannot find module`

**解决**: 先构建项目：
```bash
cd backend
npm run build
```

### 问题 3：任务状态不正确

**错误**: `任务未派发，无法记录结果`

**解决**: 
1. 确认任务状态为 `dispatched`
2. 在 Web UI 上先点击"派发"按钮
3. 或者手动修改 tasks.json 中的 status

---

## 当前状态

✅ **已创建测试任务**: 2 个任务已添加到 `~/.ai-task-flow/tasks.json`
✅ **所有测试通过**: 55 个测试全部通过
✅ **MCP Server 已构建**: `backend/dist/interfaces/mcp/server.js` 可用
✅ **Fastify 版本兼容**: 已升级到 Fastify 5.x

---

## 下一步

1. **启动 HTTP Server**（前端看板）:
   ```bash
   cd backend
   npm run http
   ```

2. **启动前端**:
   ```bash
   cd frontend
   npm run dev
   ```

3. **在 Claude Code 中配置 MCP Server**（见上方配置说明）

4. **开始使用**：在看板上创建任务 → 派发 → Claude Code 拉取 → 执行 → 回写结果 → 审核

---

**文档更新时间**: 2026-06-06
**项目版本**: v0.1.0
