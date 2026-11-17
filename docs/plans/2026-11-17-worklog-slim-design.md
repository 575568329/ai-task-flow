# 工作台瘦身转型设计:worklog 记录中枢(2026-11-17)

> 分支:`feat/worklog-slim`(基于 `feat/utools-adapter`,含知识库 ENOENT 修复)
> 状态:设计已经用户逐段确认,本文为定稿。

## 1. 背景与动机

产品从「任务编排看板 + AI 聊天 + 个人工具集」瘦身转型为「**AI 工作记录中枢 + 个人工具集**」:

- 砍掉 AI 聊天与任务指派两大块(维护成本高、实际使用少);
- 核心循环变为:用户在终端用 Claude Code/ZCode 干活 → AI 通过 MCP 调 `record_work`
  记录「项目 → 版本 → 功能点」→ 用户在工作记录页按项目/版本回溯,页面上直接看 diff。

## 2. 已确认决策(头脑风暴结论)

| # | 决策点 | 结论 |
|---|--------|------|
| 1 | 周边模块去留 | 保留 webClip、claude-profile;砍 UsageView(含后端 usage 统计) |
| 2 | 默认落地视图 | 工作记录页 |
| 3 | 存储形态 | JSON 单文件 `~/.ai-task-flow/worklog.json`(写入者/查询者都是 AI,机器最可靠;人类阅读靠 UI 渲染;CHANGELOG 可日后从 JSON 导出) |
| 4 | 版本建模 | 版本必填(无当前版本指针),项目/版本不存在自动创建 |
| 5 | diff 关联 | A+B:存 diff 原始文本 + 结构化文件引用;git 深度集成(项目路径注册/实时 diff)留待下期「项目关联」功能 |
| 6 | CRUD 范围 | MCP 全量 9 工具(增删改查 + 项目/版本删除与重命名);破坏性操作前自动备份 |
| 7 | claude-profile | 功能不变,交互重做:单面板完成全部操作,消灭二级弹窗 |
| 8 | 页面可编辑 | 工作记录页支持人工增删改(非只读占位),内联编辑不弹窗 |
| 9 | 工具指南 | 9 个 MCP 工具的说明/使用场景/示例话术在工作记录页内有指南视图;工具元数据单一来源(shared),MCP 注册与页面渲染共用 |

## 3. 砍除范围(数据文件保留,只删代码)

### 3.1 后端

| 类别 | 砍除项 |
|------|--------|
| 领域/应用 | `domain/workflow`(Task 聚合根等)、`domain/research` 聊天链路(ChatMessage/Conversation/ChatRepository)、ChatService、SearchOrchestrator、ClassifierService、GlmWebSearchClient |
| 基础设施 | JsonTaskRepository、TaskFileWatcher、JsonChatRepository、`infrastructure/git/WorktreeManager`、EventBus/EventStore(pubsub) |
| HTTP 路由 | taskRoutes、sseRoutes、chatRoutes、taskChatRoutes、projectChatRoutes、projectRoutes、usageRoutes |
| MCP | 5 个任务工具(list_pending_tasks / get_task / record_result / complete_step / add_note_to_task) |

保留:knowledge、mindmap、vocab、maimemo、webclip、llm-config(被 vocab/maimemo/webclip 依赖)、claude-profile、file、upload、system、MCP 的 save_to_knowledge。

### 3.2 前端

BoardView + board 组件、ChatView + chat 组件、DocsView(docs/TaskDocsView)、UsageView、
taskStore / chatStore / taskChatStore / projectChatStore / boardGroupingStore、
SettingsDialog 中过时面板(McpHelpPanel 换新内容)、SidebarNav 对应入口。

## 4. worklog 数据模型与存储

```jsonc
// ~/.ai-task-flow/worklog.json(路径经 resolveDataDir() 收口,支持 --data-dir/env 覆盖)
{
  "projects": [
    {
      "name": "ai-task-flow",            // 项目名,唯一键,精确匹配
      "createdAt": 1763000000000,
      "versions": [
        {
          "name": "v1.2.0",              // 版本名,自由文本,项目内唯一,必填
          "createdAt": 1763000000000,
          "entries": [
            {
              "id": "e_ab12cd34",        // 短随机 id,全局唯一(删除/更新定位)
              "title": "砍掉任务派发链路",   // 一句话功能点
              "detail": "## 改动\n- 删除 workflow 域...",  // markdown 详细说明
              "diff": "diff --git a/...",  // 可选:git diff 原始文本(记录时快照)
              "files": [                  // 可选:结构化文件引用(行号是记录时刻的,只展示不承诺跳转)
                { "path": "backend/src/server.ts", "startLine": 12, "endLine": 40 }
              ],
              "tags": ["refactor"],       // 可选,约定 feat/fix/refactor/docs
              "date": "2026-11-17",       // 记录当天本地日期
              "createdAt": 1763000000000
            }
          ]
        }
      ]
    }
  ]
}
```

- **原子写**:tmp + rename(复用 KnowledgeService 已验证模式);
- **单写者**:MCP 与 HTTP 共享同一内存 service 实例,写操作串行化;
- **自动建层**:record 时项目/版本不存在即创建;
- **备份**:`~/.ai-task-flow/worklog-backups/backup-<YYYYMMDDHHMMSS>.json`,
  **仅破坏性操作**(delete_version/delete_project/rename_*)执行前整文件快照,
  滚动保留最近 10 份;恢复本期不做 UI(备份即普通 JSON,手工复制即可);
- **容量**:个人量级一年数千条,单文件足够,不分片。

## 5. MCP 工具契约(9 个,显式分开不合并)

| 工具 | 入参 | 行为 |
|------|------|------|
| `record_work` | project, version, title, detail, files?, diff?, tags? | 项目/版本不存在自动创建;追加条目;返回 entryId 与 path |
| `query_work` | project?, version?, keyword?, tags?, limit?=20, includeDiff?=false | project/version 精确匹配;keyword 对 title/detail/files.path 不区分大小写;diff 默认不返回(省 token) |
| `list_projects` | — | 项目/版本树 + 每版本条目数/首末日期(AI 记录前先查,防写错版本名) |
| `update_work` | entryId, title?, detail?, tags?, files?, diff?, date?, version? | 只改传入字段;version 传新值 = 挪到别的版本 |
| `delete_work` | entryId | 删单条 |
| `delete_version` | project, version | 删整个版本(可删非空),执行前自动备份 |
| `delete_project` | project | 删整个项目,执行前自动备份 |
| `rename_version` | project, version, newName | 重命名版本,执行前自动备份 |
| `rename_project` | project, newName | 重命名项目,执行前自动备份 |

错误语义:校验失败返回 AI 可读的结构化文本错误(不抛崩),AI 可自我纠正。
工具 description 写明 files/diff 从 `git diff`/`git status` 获取,引导填好可选字段。

**工具元数据单一来源**:`shared` 包定义工具名/描述/使用场景/示例话术的元数据数组,
MCP server 注册与前端指南视图均从此渲染,杜绝说明与实现漂移。

## 6. HTTP API(与 MCP 共享同一 service)

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/worklog` | GET | 全树(带版本计数),一次给页面 |
| `/api/worklog/entries` | POST | 新增条目 |
| `/api/worklog/entries/:id` | PUT | 更新条目(含挪版本) |
| `/api/worklog/entries/:id` | DELETE | 删除条目 |
| `/api/worklog/versions` | DELETE | 删空版本?否——可删非空,同 MCP 语义,自动备份 |
| `/api/worklog/projects/:name` | DELETE | 删项目,自动备份 |

## 7. 前端设计

### 7.1 工作记录页(默认落地视图)

两栏布局,与知识库页(KnowledgeView)同构,复用其交互心智:

```
┌─────────────┬──────────────────────────────┐
│ 项目/版本树   │  条目列表(当前版本下,新在前)     │
│ ▼ ai-task    │  ┌────────────────────────┐  │
│   v1.2.0 (3) │  │ 砍掉任务派发链路           │  │
│   v1.1.0 (12)│  │ refactor · 11-17 · 3文件  │  │
│ ▶ proj-b     │  │ [detail markdown 渲染]    │  │
│              │  │ [diff 折叠面板 DiffViewer] │  │
│ [+记一条]     │  │ [编辑] [删除] ← 内联展开    │  │
│ [AI 使用指南] │  └────────────────────────┘  │
└─────────────┴──────────────────────────────┘
```

- **编辑内联**:点「编辑」条目原地变表单,保存即写,无二级弹窗;
- **新增**:右栏顶部「+ 记一条」内联表单(项目/版本下拉 + 标题 + 详情 + 文件引用 + tags);
- **删除**:按钮变红色确认态(再点才删),不弹 Dialog;
- **diff 折叠**:默认收起,点开用现成 DiffViewer 组件渲染;
- **AI 使用指南**:左栏底部入口 → **页内切换到指南视图**(非弹窗),渲染 shared 工具元数据:
  每工具一节 = 作用 + 什么时候用 + 用户示例话术(如「把这次改动记录到 ai-task-flow 的 v1.2.0」)。

### 7.2 claude-profile 单面板化(功能不变)

现状痛点:设置弹窗(外层)→ API 预设弹窗 / JSON 编辑弹窗(内层)→ 弹窗套弹窗。
重做为单面板:profile 列表卡片(选中即当前)、点击直接切换、编辑区**内联展开**于卡片下方
(常用字段表单 + JSON 高级模式折叠)、API 预设改为主面板内的下拉管理,全部操作零二级弹窗。

### 7.3 样式统一原则

- 组件一律用现有 `ui/`(shadcn/ui + Radix)体系:Button/Card/Tabs/Select/Badge 等,不新造轮子;
- 颜色/间距/字号走 Tailwind v4 设计 token(CSS 变量主题),禁止硬编码色值,亮暗主题自然兼容;
- 布局密度、圆角、阴影与知识库/思维导图页保持一致(同构页一致的视觉语言);
- 中文文案与现有页面语气统一。

## 8. 实施顺序与风险

顺序(每步 TDD,砍完立即全量测试):

1. 后端砍除(workflow/聊天/SSE/usage) + server.ts 重组装
2. worklog 领域模型 + Repository(原子写/单写者/破坏性备份)
3. shared 工具元数据 + HTTP API
4. MCP 9 工具(替换任务工具,保留 save_to_knowledge)
5. 前端砍除(board/chat/docs/usage 视图与 store)
6. 工作记录页(两栏树 + 条目流 + 内联编辑 + DiffViewer + AI 指南视图,设为默认视图)
7. claude-profile 单面板化重做
8. 全量回归 + desktop/uTools 壳冒烟

风险与应对:

| 风险 | 应对 |
|------|------|
| 砍除牵动 server.ts 组装与 45+ 文件 | 每步 tsc --noEmit + 全量测试;步骤 1、5 各自独立提交 |
| 旧功能反悔 | 旧数据文件(tasks.json/chats.json)保留不删;代码在 git 历史可回滚 |
| AI 误删项目/版本 | 破坏性操作前自动快照(保留 10 份) |
| 版本树变脏 | list_projects 先查再写 + 指南页教正确话术 |
| uTools 壳/desktop 引用被砍模块 | 步骤 8 冒烟;desktop 仅依赖 server 启动入口,预期影响小 |

## 9. 明确不做(YAGNI 清单)

- git 深度集成(项目路径注册表/实时 diff/点击跳转当前文件)→ 下期「项目关联」功能;
- CHANGELOG markdown 导出(JSON 是存储,导出是视图,要做随时可加);
- 备份恢复 UI(手工复制备份文件即可);
- worklog 数据分片/压缩;
- 多用户/权限。
