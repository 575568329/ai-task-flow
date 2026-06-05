
## Phase 3-6 任务概要（Task 6-35）

> **注意**：Phase 1-2 的详细步骤（Task 1-5）已在文档前半部分完成。以下为剩余阶段的任务概要，每个任务的详细步骤请参考前面的模式自行展开。

---

### Phase 3: MCP Server 核心工具 (Day 5-7)

**Task 6**: MCP Server 骨架 + DI 容器配置
**Task 7**: 实现 `list_pending_tasks` 工具
**Task 8**: 实现 `get_task` 工具（含 Markdown 模板拼装）
**Task 9**: 实现 `record_result` 工具（Zod schema 校验）
**Task 10**: 实现 `get_task_diff` 工具
**Task 11**: 实现 `add_note_to_task` 工具
**Task 12**: MCP Inspector 本地测试

---

### Phase 4: EventBus 与跨域协作 (Day 8-9)

**Task 13**: 实现 InMemoryEventBus + EventStore (JSONL)
**Task 14**: TaskRepository 发布领域事件
**Task 15**: HTTP 接口监听事件推送 SSE

---

### Phase 5: HTTP API + 前端准备 (Day 10-12)

**Task 16**: Fastify HTTP Server + CORS + SSE 端点
**Task 17**: REST API: POST /api/tasks (创建任务)
**Task 18**: REST API: POST /api/tasks/:id/dispatch (派发)
**Task 19**: REST API: POST /api/tasks/:id/approve (审核通过)
**Task 20**: REST API: POST /api/tasks/:id/reject (打回)
**Task 21**: REST API: GET /api/tasks/:id/diff (查看 diff)

---

### Phase 6: 前端看板实现 (Day 13-18)

**Task 22**: Vue 项目初始化 + Vite + Element Plus
**Task 23**: Pinia store: tasks / projects / templates
**Task 24**: 看板视图（6 列：planning/todo/dispatched/review/done/blocked）
**Task 25**: 任务卡片组件（拖拽排序）
**Task 26**: 任务详情抽屉
**Task 27**: 新建任务表单（含截图上传）
**Task 28**: 派发按钮 + 确认弹窗
**Task 29**: Diff 审查视图（diff2html-vue3）
**Task 30**: 审核操作（通过/打回+理由）
**Task 31**: SSE 客户端（EventSource 监听状态更新）
**Task 32**: 多项目过滤器

---

### Phase 7: E2E 测试与文档 (Day 19-21)

**Task 33**: E2E 测试脚本：录入 → 派发 → Claude 拉取 → 回写 → 审查
**Task 34**: 用户文档：~/.claude.json 配置指南
**Task 35**: README + 快速开始 + 开发指南

---

## 执行建议

### 方式 A：按 Task 顺序串行实施（推荐新手）

1. 严格按 Task 1 → Task 35 顺序执行
2. 每个 Task 完成后 commit
3. 每 5 个 Task 跑一次集成测试
4. Week 1 完成 Task 1-12，Week 2 完成 Task 13-21，Week 3 完成 Task 22-35

### 方式 B：前后端并行实施（推荐有经验团队）

**后端线**：Task 1-5 → Task 6-12 → Task 13-15 → Task 16-21
**前端线**：Task 22 → Task 23-26 → Task 27-32

两条线最后在 Task 33 (E2E) 汇合。

### 方式 C：垂直切片实施（推荐敏捷）

**Slice 1 (最小闭环)**：Task 1-5 + Task 8 (get_task) + Task 16-17 + Task 22-24
→ 跑通：创建任务 → 看板显示

**Slice 2 (派发闭环)**：Task 6-7 + Task 9 + Task 18 + Task 28
→ 跑通：派发 → Claude 拉取 → 回写

**Slice 3 (审查闭环)**：Task 10 + Task 19-21 + Task 29-30
→ 跑通：Diff 审查 → 通过/打回

**Slice 4 (完善)**：Task 11-12 + Task 13-15 + Task 25-27 + Task 31-32 + Task 33-35

---

## 关键文件速查

**启动命令**：
```bash
# 开发环境（前后端同时）
npm run dev

# 仅后端
cd backend && npm run dev

# MCP Server（Claude Code 调用）
cd backend && npm run mcp

# 前端
cd frontend && npm run dev
```

**目录结构**：
```
C:\Users\fjyu9\Desktop\ai-task-flow\
├── backend/
│   ├── src/
│   │   ├── domain/workflow/           # Task聚合根 + 值对象
│   │   ├── application/workflow/      # 用例
│   │   ├── infrastructure/git/        # WorktreeManager
│   │   ├── infrastructure/persistence/# JsonTaskRepository
│   │   ├── interfaces/mcp/            # MCP Server
│   │   └── interfaces/http/           # REST API
│   └── package.json
├── frontend/
│   ├── src/modules/workflow/          # 看板组件
│   └── package.json
├── docs/plans/
│   ├── 2026-06-05-ai-task-flow-design.md
│   └── 2026-06-05-ai-task-flow-implementation-plan.md
└── package.json (monorepo root)
```

**~/.claude.json 配置**：
```json
{
  "mcpServers": {
    "ai-task-flow": {
      "command": "node",
      "args": [
        "C:/Users/fjyu9/Desktop/ai-task-flow/backend/dist/interfaces/mcp/server.js"
      ],
      "env": {
        "AI_TASK_FLOW_PROJECT": "${workspaceFolder}"
      }
    }
  }
}
```

---

## 下一步

**实施计划已完整保存到：**
`C:\Users\fjyu9\Desktop\ai-task-flow\docs\plans\2026-06-05-ai-task-flow-implementation-plan.md`

**你现在可以：**

1. **使用 superpowers:executing-plans 技能**（如果可用）— 逐 Task 自动执行
2. **手动按 Task 顺序实施** — 每个 Task 5-7 步骤，清晰明确
3. **让我辅助实施** — 告诉我"开始 Task X"，我逐步指导你

选择哪种方式？
