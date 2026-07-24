---
tags: [竞品分析, multica, agent平台, 参考调研]
---
---
tags: [竞品分析, multica, agent平台, 参考调研]
---
# Multica 调研:工作模式与对我们的启发

> 对开源项目 [multica-ai/multica](https://github.com/multica-ai/multica) 的工作模式分析,提炼对 ai-task-flow 可借鉴的点。
> 与我们高度同构(都做 AI 任务编排 + worktree + MCP),对照能看清差异与可借鉴处。

---

## 一、Multica 是什么

- **定位**:开源的「受管理代码代理平台」,把 AI 编码 agent 变成真正的团队成员。
- **目标用户**:与 AI agent 协作的开发者/小团队。理念是「你接下来的 10 位新员工不会是人类」。
- **一句话**:像分给同事一样分任务给 agent——它们自主接活、写码、报告阻塞、更新状态。

## 二、工作模式

- **多 workspace 隔离**:每个 workspace 独立 agents / issues / settings。
- **Projects**:介于 issue 和 workspace 之间的容器,组织相关任务(如「迭代 1.1」含 N 个任务)。
- **Squad 模式**:多个 agent 分组,由 leader agent 分配任务。
- **Git Worktree 隔离**:每个 GitHub repo 任务建独立 worktree(clone-per-task)。
- **任务分配**:Issue assign / @-mention / Chat 对话 / **Autopilots**(cron/webhook 自动触发,无需人工)。
- **核心链路**:建 Issue → 分给 Agent → 本地 daemon 驱动 AI CLI 执行 → WebSocket 流式推进度 → 报告阻塞/完成 → 沉淀为 Skill 复用。

## 三、技术架构

| 层 | 技术 |
|---|---|
| 前端 | Next.js 16(App Router) |
| 后端 | Go(Chi / sqlc / gorilla/websocket) |
| 数据库 | PostgreSQL 17 + pgvector |
| 执行 | 本地 daemon 进程驱动各种 AI CLI |
| MCP | 有(27 工具,社区贡献 #1351) |

## 四、和 ai-task-flow 的对照

| 维度 | ai-task-flow(我们) | multica |
|---|---|---|
| 定位 | **个人**任务看板 + MCP | **团队级**托管 agent 平台 |
| 后端 | Node/TS + **JSON 文件** | Go + **PostgreSQL** |
| 任务隔离 | git worktree | worktree + local_directory **双轨** |
| 实时更新 | **文件轮询**(等几秒) | **WebSocket 流** |
| 自动化 | 无 | Autopilots(cron/webhook) |
| 知识沉淀 | 知识库(**人工**写) | Skill **自动**沉淀 + agent 拾取 |
| 多 agent | 单 | Squad 分组协作 |
| 部署 | 本地优先 | Cloud / Self-host / Desktop |

**高度同构**,差异主轴是**轻 vs 重**(个人/JSON/Node vs 团队/PostgreSQL/Go)。

## 五、对我们最值得借鉴的(3 条)

1. **WebSocket 实时流替代文件轮询** ⭐:我们现在 MCP 回写后前端靠文件轮询刷新(要等几秒)。multica 用 WebSocket 推进度。对我们「派发 → Claude 干活 → 看板同步」这条主链路体验提升最大。
2. **Autopilots 自动触发**:cron/webhook 驱动任务,无需人工派发。适合「每天定时跑某任务」「CI 触发」场景。
3. **Skill 沉淀机制**:agent 干完一个任务,自动把解法固化为可复用流程,形成团队 playbook。我们知识库是人工写,它是 agent 自动产出——思路可参考。

## 六、不该照搬

- **PostgreSQL**:对个人/小团队过重,我们 JSON 够用,未来量大再换 DB。
- **Go 后端**:切技术栈成本高,Node 生态已打通。
- **团队 workspace / Squad 多 agent**:个人场景过重,MVP 不需要。

## 七、风险 / 局限

- 成熟度:活跃(据其仓库 4300+ commits),但未见正式版本号 / release。
- License:修改版 Apache 2.0,允许商用。
- MCP 集成由社区贡献(#1351),非官方核心,可能滞后于主版本。

## 八、来源

- [GitHub: multica-ai/multica](https://github.com/multica-ai/multica)
- [官方文档](https://www.multica.ai/docs)
- [MCP Server Issue #1351](https://github.com/multica-ai/multica/issues/1351)
