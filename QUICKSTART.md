# 🚀 AI Task Flow - 快速启动

## ✅ 已完成

- ✅ 修复编译错误（shared 包构建成功）
- ✅ 修复 Fastify 版本兼容性（升级到 5.x）
- ✅ 所有测试通过（55/55 tests）
- ✅ MCP Server 构建成功（5 个工具可用）
- ✅ 创建测试任务（2 个示例任务）
- ✅ 生成使用文档

## 🛠️ MCP 工具清单

| 工具名 | 功能 | 状态 |
|--------|------|------|
| `list_pending_tasks` | 列出待办任务 | ✅ 已实现 |
| `get_task` | 获取任务详情 | ✅ 已实现 |
| `record_result` | 记录执行结果 | ✅ 已实现 |
| `get_task_diff` | 查看 git diff | ✅ 已实现 |
| `add_note_to_task` | 添加备注 | ✅ 已实现 |

## 📦 快速启动

### 1. 启动后端 HTTP Server（看板后端）

```bash
cd backend
npm run http
```

访问: `http://localhost:3000`

### 2. 启动前端（看板界面）

```bash
cd frontend
npm run dev
```

访问: `http://localhost:5173`

### 3. 配置 Claude Code MCP Server

**配置文件位置**: `C:\Users\57556\.claude\config\claude_desktop_config.json`

**配置内容**:
```json
{
  "mcpServers": {
    "ai-task-flow": {
      "command": "node",
      "args": [
        "C:/Users/57556/Desktop/ai-task-flow/backend/dist/interfaces/mcp/server.js"
      ]
    }
  }
}
```

**重启 Claude Code** 以加载 MCP Server。

### 4. 测试 MCP 工具

在 Claude Code 中，你可以使用以下工具：

```javascript
// 列出所有待办任务
list_pending_tasks()

// 获取任务详情
get_task(taskId: "WS-001")

// 添加备注
add_note_to_task(taskId: "WS-001", note: "开始执行任务")

// 记录结果（任务需先派发）
record_result(
  taskId: "WS-001",
  status: "done",
  changedFiles: ["src/server.ts"],
  notes: "功能实现完成"
)

// 查看变更（任务需先派发）
get_task_diff(taskId: "WS-001")
```

## 🔄 完整工作流

1. **在 Web 看板创建任务**
   - 填写标题、描述、步骤
   - 上传截图（可选）
   - 选择优先级

2. **派发任务**
   - 点击"派发"按钮
   - 系统自动创建 git worktree
   - 任务状态变为 `dispatched`

3. **在 Claude Code 中工作**
   - 使用 `list_pending_tasks()` 查看任务
   - 使用 `get_task()` 获取详情
   - 修改代码、运行测试

4. **记录执行结果**
   - 使用 `record_result()` 提交结果
   - 任务状态变为 `review`

5. **审核代码**
   - 在 Web 看板查看 diff
   - 审核通过：自动合并 worktree
   - 审核打回：任务回到 `dispatched`

## 📚 文档资源

- **MCP 工具详细指南**: [docs/MCP_TOOLS_GUIDE.md](./docs/MCP_TOOLS_GUIDE.md)
- **项目设计文档**: [.claude/2026-06-05-ai-task-flow-design.md](./.claude/2026-06-05-ai-task-flow-design.md)
- **实施计划**: [.claude/2026-06-05-ai-task-flow-implementation-plan.md](./.claude/2026-06-05-ai-task-flow-implementation-plan.md)

## 🧪 测试验证

```bash
# 运行所有测试
npm test

# 仅构建项目
npm run build

# 运行 MCP Server（开发模式）
cd backend && npm run mcp:dev
```

## 📋 当前任务状态

已创建 2 个测试任务（位于 `~/.ai-task-flow/tasks.json`）：

1. **WS-001**: 测试 MCP 工具功能 (P0)
2. **WS-002**: 优化前端性能 (P1)

## ⚡ 下一步

1. **测试 MCP 工具**: 重启 Claude Code，使用 `list_pending_tasks()` 验证
2. **启动完整系统**: 同时运行前后端，测试完整工作流
3. **创建真实任务**: 在看板上创建实际开发任务
4. **实施计划中的功能**: 继续完成 Phase 6-7 的任务

---

**更新时间**: 2026-06-06  
**版本**: v0.1.0  
**状态**: ✅ MCP 工具已就绪
