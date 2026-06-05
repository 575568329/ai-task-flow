# AI Task Flow - Claude 项目指导

## 项目概述

**产品定位**: 个人 AI 任务编排看板 + MCP Server

**核心价值**: 在网页看板上录入任务，点派发后创建 git worktree，你在终端用 Claude Code 通过 MCP 协议拉取任务、回写状态。看板自动同步，保留原生 Claude Code 体验。

**技术栈**: 
- Backend: Node.js + TypeScript + Fastify + @modelcontextprotocol/sdk + simple-git
- Frontend: Vue 3 + TypeScript + Vite + Element Plus
- Architecture: DDD 四层 + git worktree 隔离 + EventBus

**MVP 周期**: 2-3 周

---

## 核心文档

1. **设计文档**: `.claude/2026-06-05-ai-task-flow-design.md`
   - 完整的产品定位、架构设计、技术选型
   - 必读，理解整体方向

2. **实施计划**: `.claude/2026-06-05-ai-task-flow-implementation-plan.md`
   - Task 1-5 的详细步骤（项目初始化 + DDD 骨架 + Worktree + Task 聚合根）
   - 每个 Task 包含完整代码 + 测试 + commit 信息

3. **任务概要**: `docs/plans/2026-06-05-ai-task-flow-phase3-6-summary.md`
   - Task 6-35 的概要（MCP Server + HTTP API + 前端看板）

---

## 实施指南

### 执行方式

**按 Task 顺序逐步实施**：

```
Task 1: 项目结构搭建 (monorepo + 依赖安装)
  ↓
Task 2: TypeScript 配置 + DDD 目录结构
  ↓
Task 3: TaskStatus/Priority/TaskId 值对象
  ↓
Task 4: WorktreeManager (git worktree 管理)
  ↓
Task 5: Task 聚合根 (dispatch/recordResult)
  ↓
Task 6-12: MCP Server + 5 个工具
  ↓
Task 13-15: EventBus + EventStore
  ↓
Task 16-21: HTTP API + SSE 推送
  ↓
Task 22-32: 前端看板实现
  ↓
Task 33-35: E2E 测试 + 文档
```

### 关键原则

1. **TDD**: 先写测试，再写实现
2. **DRY**: 不重复代码
3. **YAGNI**: 只实现当前需要的功能
4. **小步提交**: 每个 Task 完成后立即 commit

### 目录结构

```
ai-task-flow/
├── .claude/                    # 项目指导文档（本目录）
├── backend/
│   ├── src/
│   │   ├── domain/workflow/           # 领域层：Task聚合根、值对象、事件
│   │   ├── application/workflow/      # 应用层：用例
│   │   ├── infrastructure/
│   │   │   ├── git/                   # WorktreeManager
│   │   │   ├── persistence/           # JsonTaskRepository
│   │   │   └── pubsub/                # EventBus
│   │   └── interfaces/
│   │       ├── mcp/                   # MCP Server（给 Claude Code）
│   │       └── http/                  # REST API（给前端）
│   └── package.json
├── frontend/
│   └── src/modules/workflow/          # 看板组件
├── shared/types/                      # 前后端共享类型
└── docs/plans/                        # 设计与实施文档
```

---

## 快速开始

### Step 1: 阅读设计文档

```bash
# 在项目根目录
cat .claude/2026-06-05-ai-task-flow-design.md
```

理解核心概念：
- 双层存储（~/.ai-task-flow/ + 项目/.ai-workspaces/）
- MCP 工具（list_pending_tasks / get_task / record_result）
- git worktree 隔离机制

### Step 2: 执行 Task 1-5

打开实施计划：
```bash
cat .claude/2026-06-05-ai-task-flow-implementation-plan.md
```

从 **Task 1: 项目结构搭建** 开始，逐步执行每个 Step。

每个 Task 的典型结构：
- **Files**: 要创建/修改的文件清单
- **Step 1-7**: 具体操作步骤（含完整代码）
- **Commit**: git commit 信息模板

### Step 3: 验证进度

完成 Task 1-5 后，应该能够：
- ✅ 跑通 `npm install`
- ✅ 跑通 `npm test`（单元测试 pass）
- ✅ WorktreeManager 能创建/销毁 worktree
- ✅ Task 聚合根能正确状态转换

### Step 4: 继续 Phase 3-6

参考 `docs/plans/2026-06-05-ai-task-flow-phase3-6-summary.md`，继续实施 MCP Server 和前端看板。

---

## 关键决策参考

### 为什么选择这个技术栈？

| 技术 | 理由 |
|------|------|
| MCP Server | 保留原生 Claude Code 体验，官方协议长期稳定 |
| git worktree | 任务级隔离，失败可丢弃，主分支永远干净 |
| DDD 四层 | 未来要扩展 5 个 Bounded Context，必须清晰边界 |
| JSON 文件存储 | MVP 阶段够用，简单可靠 |
| Zod + MCP schema | token 级格式保证，无 YAML+正则反模式 |

### 常见问题

**Q: 为什么不用 Agent SDK 嵌入 Claude？**
A: v2 设计尝试过，但用户反馈"失去原生 Claude Code 体验"。v3 通过 MCP 协议让用户完全掌控 AI 交互。

**Q: 为什么每个任务一个 worktree？**
A: 所有严肃竞品（Vibe Kanban/agetor）都用。好处：多任务并行不冲突、失败可丢弃、diff 干净。

**Q: MCP Server 和 HTTP Server 如何共享数据？**
A: 共享同一个 `~/.ai-task-flow/tasks.json`，通过 EventBus 互通。MCP 写入 → 发事件 → HTTP 接口监听 → SSE 推前端。

---

## 测试策略

- **70% 单元测试**: domain 层（Task 聚合根、值对象）
- **20% 集成测试**: infrastructure 层（WorktreeManager、Repository）
- **10% E2E 测试**: 完整流程（录入 → 派发 → Claude 拉取 → 回写 → 审查）

---

## 下一步

1. **读完设计文档**（理解 WHY）
2. **执行 Task 1**（项目初始化）
3. **逐步推进到 Task 35**（MVP 完成）

有问题随时查阅 `.claude/` 目录下的文档，或者问我。

Good luck! 🚀
