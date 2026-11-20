# AI Task Flow

> 个人 AI 工作记录中枢 + 个人工具集合 —— AI 干完活先记录再汇报,成果不留在对话里

在终端用 Claude Code / ZCode 干活 → AI 通过 MCP 调 `record_work` 把改动记录为「**项目 → 版本 → 功能点**」(含 git diff 与文件行号) → 你在工作记录页按项目/版本/关键字回溯,页面直接看 diff、人工增删改。

[![CI](https://github.com/575568329/ai-task-flow/actions/workflows/ci.yml/badge.svg)](https://github.com/575568329/ai-task-flow/actions/workflows/ci.yml)

---

## 核心循环

```
① 你在终端让 AI 改代码
        ↓
② AI 调 record_work 记录(项目/版本/标题/详情/diff/文件行号)   ← detail 按固定模板分条:
        ↓                                                       Bug→问题/原因/解决/验证
③ 工作记录页(默认视图)随时回溯                                  任务→需求/方案/实现/验证
   · 左栏项目/版本树 · 全局关键字搜索(标题/详情/文件路径)
   · diff 折叠查看 · 人工增删改/重命名(内联编辑,零弹窗)
```

删除/重命名自动快照备份(`~/.ai-task-flow/worklog-backups/`,滚动 10 份);AI 使用指南在工作记录页 📖 入口(worklog 9 个工具的示例话术)。

长对话讨论定稿后,让 AI 记一张**结论卡**(`record_conclusion`,结论/数据/待办/代码位置),下次直接看最新版;补充/修正走追加新版,历史逐版可查。默认**一对话一卡**,跨对话续写需显式允许。工作记录/结论卡都带**唯一阶段标签**（获取需求→设计→开发→自测→代码评审→覆盖度→上线→复盘;缺陷修改用 `fix` 标签）。

## 快速启动

```bash
npm install                 # monorepo workspaces(shared/backend/frontend)
cd backend && npm run dev   # 后端 :47821(读 .logs/backend-port.txt,dev 自动写)
cd frontend && npm run dev  # 前端 :5678(vite,代理 /api → 后端)
# 打开 http://127.0.0.1:5678 —— 默认即工作记录页
```

## MCP 挂载(AI 客户端)

已注册 **ZCode 全局**(`~/.zcode/cli/config.json`)与 **Claude Code 全局**(`~/.claude.json`),指向同一 dist 产物:

```bash
cd backend && npm run build   # 更新 MCP:重建 dist 即全局生效,客户端配置无需改
```

工具(12):`record_work` / `query_work` / `list_projects` / `update_work` / `delete_work` / `delete_version` / `delete_project` / `rename_version` / `rename_project` / `record_conclusion` / `query_conclusions` / `save_to_knowledge`

注册清单、当前版本与更新 SOP 见 **[docs/mcp-registration.md](docs/mcp-registration.md)**。

## 功能模块

| 模块 | 说明 |
|---|---|
| **工作记录**(核心) | 项目→版本→功能点;MCP 记录 + 页面人工增删改/搜索;diff 与文件行号关联;按阶段筛选 |
| **结论卡** | 长对话结论按主题沉淀:结论/数据/待办/代码位置;逐版完整历史,默认看最新;按阶段筛选 |
| **阶段标签** | `record_work` / `record_conclusion` 唯一单值 stage:获取需求/设计/开发/自测/评审/覆盖度/上线/复盘;缺陷修改用 `fix` tag |
| 知识库 | markdown/文档库,目录树 + wiki 链接;MCP `save_to_knowledge` 可写 |
| 网页剪藏 | 浏览器扩展剪藏 → LLM 拆解为任务草稿 → 入库 |
| 思维导图 | 画布编辑,Mermaid 导入 |
| Claude 配置切换 | settings.json 多套快照一键切换(单面板,自动备份) |

## 架构要点

- **Backend**: Node + TS + Fastify + @modelcontextprotocol/sdk,DDD 四层(domain/application/infrastructure/interfaces)
- **worklog 写协议**: 双层锁(进程内 mutex + proper-lockfile 跨进程文件锁)+ write-file-atomic 原子写——HTTP 与 MCP(stdio 独立进程)并发写零丢失(双进程冒烟验证)
- **单一来源**: MCP 工具元数据(catalog)、记录格式模板均为 shared 单一定义,MCP 注册/页面指南/AI 描述三方同源
- **Frontend**: React 19 + Vite + shadcn/ui(Radix) + Tailwind v4 + Zustand

## 测试

```bash
cd backend && npx vitest run    # 274 用例(领域/锁协议/路由/MCP 工具)
cd frontend && npm test         # 141 用例(组件/搜索过滤)
BASE_URL=http://127.0.0.1:47821 bash tests/run_all.sh   # curl E2E(需后端在跑)
node tests/mcp/conclusion-stdio-smoke.mjs              # MCP stdio 冒烟(需先 cd backend && npm run build)
```

## 文档地图

| 文档 | 内容 |
|---|---|
| [AGENTS.md](AGENTS.md) | 协作规范(编码/TDD/任务分解)+ 产品定位(AI 会话必读) |
| [docs/mcp-registration.md](docs/mcp-registration.md) | MCP 注册登记与版本记录(更新 SOP) |
| [docs/plans/2026-11-17-worklog-slim-design.md](docs/plans/2026-11-17-worklog-slim-design.md) | worklog 转型设计 v3(含业界对照) |
| [docs/plans/2026-11-17-worklog-slim-implementation-plan.md](docs/plans/2026-11-17-worklog-slim-implementation-plan.md) | 转型实施计划(8 步 TDD,已全部落地) |

`docs/` 下其余 `YYYYMMDDHHMMSS_*` 命名的历史文档为各阶段设计/踩坑归档,记录当时决策背景,现状以本 README 与上表为准。

---

**2026-11 转型说明**:任务编排看板/AI 聊天/任务文档/用量统计已砍除(旧数据保留于 `~/.ai-task-flow/`,代码在 git 历史)。旧版 README 与设计见 `docs/plans/` 归档。
