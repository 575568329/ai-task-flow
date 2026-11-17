# 工作台瘦身转型设计:worklog 记录中枢(2026-11-17,v2)

> 分支:`feat/worklog-slim`(基于 `feat/utools-adapter`,含知识库 ENOENT 修复)
> 状态:v1 经三路审阅(架构师/资深开发/产品经理)+业界调研修订,v2 为开工稿。
> v2 变更:跨进程写协调(锁方案,替换错误的"单写者"表述)、砍除边界补全(floating/system 裁剪/死代码链)、
> HTTP partial 语义与 rename 端点、备份范围扩到单条删除、数据模型补约束,详见各节。

## 1. 背景与动机

产品从「任务编排看板 + AI 聊天 + 个人工具集」瘦身转型为「**AI 工作记录中枢 + 个人工具集**」:

- 砍掉 AI 聊天与任务指派两大块(维护成本高、实际使用少);
- 核心循环变为:用户在终端用 Claude Code/ZCode 干活 → AI 通过 MCP 调 `record_work`
  记录「项目 → 版本 → 功能点」→ 用户在工作记录页按项目/版本回溯,页面上直接看 diff。

## 2. 已确认决策(头脑风暴结论 + v2 修订)

| # | 决策点 | 结论 |
|---|--------|------|
| 1 | 周边模块去留 | 保留 webClip、claude-profile;砍 UsageView(含后端 usage 统计) |
| 2 | 默认落地视图 | 工作记录页 |
| 3 | 存储形态 | JSON 单文件 `~/.ai-task-flow/worklog.json`(写入者/查询者都是 AI;人类阅读靠 UI;CHANGELOG 可日后从 JSON 导出) |
| 4 | 版本建模 | 版本必填(无当前版本指针),项目/版本不存在自动创建 |
| 5 | diff 关联 | A+B:存 diff 原始文本 + 结构化文件引用;git 深度集成留待下期「项目关联」功能 |
| 6 | CRUD 范围 | MCP 全量 9 工具;**所有删除与重命名操作**(含单条 delete_work)执行前自动备份 |
| 7 | claude-profile | 功能不变,交互重做:单面板完成全部操作,消灭二级弹窗 |
| 8 | 页面可编辑 | 工作记录页支持人工增删改**与重命名**,内联编辑不弹窗,更新为 partial 语义 |
| 9 | 工具指南 | 9 工具说明/场景/示例话术在工作记录页指南视图;元数据单一来源(shared) |
| 10 | **跨进程写协调(v2)** | MCP 保持 stdio 独立进程(业界共识:本地单用户场景 stdio 即最佳实践);写操作用 proper-lockfile 跨进程文件锁 + write-file-atomic 原子写;**每次操作读最新文件,不缓存** |

## 3. 砍除范围(数据文件保留,只删代码)

### 3.1 后端

| 类别 | 砍除项 |
|------|--------|
| 领域/应用 | `domain/workflow`(整目录)、`domain/research` 聊天链路(ChatMessage/Conversation/ChatRepository)、ChatService、SearchOrchestrator、ClassifierService、GlmWebSearchClient、ArxivClient(唯一消费者为 SearchOrchestrator)、UsageService |
| 基础设施 | JsonTaskRepository、TaskFileWatcher、JsonChatRepository、TaskSessionStore、SessionTitleStore、taskDoc.ts、`infrastructure/git/`(WorktreeManager)、EventBus/EventStore(pubsub) |
| HTTP 路由 | taskRoutes、sseRoutes、chatRoutes、taskChatRoutes、projectChatRoutes、projectRoutes、usageRoutes |
| MCP | 5 个任务工具(list_pending_tasks / get_task / record_result / complete_step / add_note_to_task) |
| system 裁剪(v2) | 保留 storage/mcp-setup/health;砍 select-directory、claude-sessions、open、agent-runtime/snapshot 端点及 AgentRuntimeManager(杀 claude 子进程链);`isValidRepoPath` 自 projectChatHelpers 迁入 system 后整删该文件 |

**保留**:knowledge、mindmap、vocab、maimemo、webclip、llm-config(被 vocab/maimemo/webclip 依赖)、claude-profile、file、upload、system(裁剪后)、MCP 的 save_to_knowledge、`migrations.ts`(被 JsonMindmapRepository 引用)。
`dataDir.ts` 中任务/聊天专用路径函数(tasksFilePath/chatFilePath/eventsFilePath/taskDocsDirPath 等)**暂留**——保留的 StorageService 存储统计仍引用,仅更新其类目文案。

### 3.2 前端

- BoardView + board 组件、ChatView + chat 组件、**floating/ 悬浮聊天整目录**(10 文件,依赖被砍 projectChatStore)、DocsView(docs/TaskDocsView)、UsageView;
- taskStore / chatStore / taskChatStore / projectChatStore / boardGroupingStore、stores/chat/;
- api 层:taskChat/projectChat/chat/chatStream/sse/sse-utils/files(仅 docs 引用);**先迁出** api/task.ts 内被保留功能引用的 systemApi/fetchHealth → api/system.ts;
- **先迁移后删**:`chat/MessageContent`、`chat/CodeBlock`、`chat/MermaidBlock` 为通用 Markdown 渲染组件(被保留的 KnowledgeViewer 引用),迁至 components/common/ 后再删 chat 目录;
- lib:删 chatEvents/repoHistory/taskMeta(消费者均在砍除范围);**保留** speech/docExport/formatDate/copyPath(VocabView/KnowledgeViewer 在用);
- **McpHelpPanel 删除**(指南唯一入口在工作记录页,与决策 9 一致);
- SidebarNav 对应入口;App.tsx 启动 effect(SSE/taskStore 逻辑)整体重写。

### 3.3 shared 包

- types/task.ts 中 WebClipService 实际使用的 StepBlock/TaskStep 等类型**先抽取**至 types/webclip.ts(或独立 steps 类型文件)并改 import,再删 types/{task,research,usage}.ts 与 utils/{prompt,steps}.ts;
- types/agent.ts(无人用)删除;index.ts barrel 对应行清理。

### 3.4 测试资产

- `tests/test-mcp-tools.sh`(测 5 个旧 MCP 工具)、`tests/curl/test_task_api.sh` 删除,新增 worklog curl 冒烟(record→query→delete 前备份断言),保住 `tests/run_all.sh` 统一回归入口。

## 4. worklog 数据模型与存储

```jsonc
// ~/.ai-task-flow/worklog.json(路径经 resolveDataDir() 收口)
{
  "projects": [
    {
      "name": "ai-task-flow",            // 项目名,唯一键,精确匹配;trim 后非空,禁含 '/'(防路由参数歧义)
      "createdAt": 1763000000000,
      "versions": [
        {
          "name": "v1.2.0",              // 版本名,自由文本,项目内唯一,必填;同上约束
          "createdAt": 1763000000000,
          "entries": [
            {
              "id": "e_ab12cd34",        // 短随机 id,全局唯一
              "title": "砍掉任务派发链路",
              "detail": "## 改动\n- 删除 workflow 域...",
              "diff": "diff --git a/...",  // 可选:git diff 原始文本(记录时快照)
              "files": [                  // 可选:结构化文件引用(行号是记录时刻的,只展示不承诺跳转)
                { "path": "backend/src/server.ts", "startLine": 12, "endLine": 40 }
              ],
              "tags": ["refactor"],       // 可选,约定 feat/fix/refactor/docs
              "date": "2026-11-17",       // 记录当天本地日期(YYYY-MM-DD)
              "createdAt": 1763000000000,
              "updatedAt": 1763000000000  // v2:update_work 时刷新
            }
          ]
        }
      ]
    }
  ]
}
```

### 4.1 跨进程写协调(v2,替换 v1"单写者"表述)

MCP(stdio 独立进程,业界共识:本地单用户场景的最佳 transport)与 HTTP backend 是**两个 OS 进程**,不存在"共享内存实例"。写协议:

- **每次操作(读和写)都从磁盘读最新文件**——HTTP 侧不缓存树,页面刷新即拉新,故 AI 刚记的条目页面立刻可见(替代被砍的 TaskFileWatcher 轮询);
- 写操作 = `proper-lockfile` 锁住 worklog.json → 重读 → 内存变更 → `write-file-atomic`(tmp+rename)写回 → 解锁;
- proper-lockfile 用 mkdir 原子策略(任何文件系统原子),自带 stale lock 检测恢复,进程崩溃不留下死锁;
- 两个进程各持 Repository 实例,协议一致性由文件锁保证(单测以双实例模拟双进程验证)。

### 4.2 备份(v2:范围扩大)

- **触发**:delete_work / delete_version / delete_project / rename_* 执行前,**以及页面删单条**——所有不可逆删除均有兜底;record/update(追加/可逆修改)不快照,防滚动窗口挤掉救命快照;
- 文件:`~/.ai-task-flow/worklog-backups/backup-<YYYYMMDDHHMMSSmmm>_<随机4位>.json`(毫秒+随机后缀,防同秒互覆);
- 滚动保留最近 10 份;恢复本期不做 UI(备份即普通 JSON,手工复制即可)。

## 5. MCP 工具契约(9 个,显式分开不合并)

| 工具 | 入参 | 行为 |
|------|------|------|
| `record_work` | project, version, title, detail, files?, diff?, tags? | 项目/版本不存在自动创建;返回 entryId、path,**若新建了项目/版本,返回文本显式标注"已新建版本 xxx"**(人扫一眼即知拼错) |
| `query_work` | project?, version?, keyword?, tags?, **dateFrom?, dateTo?**(v2), limit?=20, includeDiff?=false | project/version 精确;keyword 对 title/detail/files.path 不区分大小写;date 过滤 entry.date;diff 默认不返回(省 token) |
| `list_projects` | — | 项目/版本树 + 每版本条目数/首末日期 |
| `update_work` | entryId, title?, detail?, tags?, files?, diff?, date?, version? | **partial 语义**(只改传入字段);version 指向不存在的版本**自动创建**(与 record 建层一致)并挪入 |
| `delete_work` | entryId | 删单条,**执行前自动备份**(v2) |
| `delete_version` | project, version | 删整个版本,备份 |
| `delete_project` | project | 删整个项目,备份 |
| `rename_version` | project, version, newName | 重命名;**newName 与既有版本重名 → AI 可读错误,不改**(v2 明确) |
| `rename_project` | project, newName | 重命名;重名同上报错 |

错误语义:校验失败返回 `isError: true` + AI 可读结构化文本(v2:补 isError,语义更准,客户端可识别)。
工具 description 写明 files/diff 从 `git diff`/`git status` 获取、**何时调用**(干完活、汇报完成前——业界同类工具 Clockwork-MCP/Daily Work Log 同一定位)。

**工具元数据单一来源**:`shared` 包 mcpToolCatalog(含 name/description/whenToUse/userPromptExample),
经 shared barrel(index.ts)导出——MCP server 注册工具名/描述、前端指南视图渲染均从此取;
inputSchema 仍手写在工具文件(catalog 不含 schema),测试断言 catalog 与注册表 name/description 一致。

## 6. HTTP API(与 MCP 走同一 Repository + 文件锁协议)

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/worklog` | GET | 全树(含 diff;>2MB 时演进见 §9) |
| `/api/worklog/entries` | POST | 新增条目(项目/版本自动建层,同 record_work) |
| `/api/worklog/entries/:id` | PUT | **partial 更新**(同 update_work 语义;严禁全量替换实现——表单无 diff 字段,全量会把 AI 记录的 diff 抹掉) |
| `/api/worklog/entries/:id` | DELETE | 删单条,自动备份 |
| `/api/worklog/versions` | DELETE | 删版本(可删非空),备份 |
| `/api/worklog/versions/rename` | POST | v2:重命名版本(页面右键重命名用) |
| `/api/worklog/projects/:name/rename` | POST | v2:重命名项目 |

## 7. 前端设计

### 7.1 工作记录页(默认落地视图)

两栏布局,与知识库页同构:

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

- 编辑内联(原地变表单,partial 提交,diff/files 不在表单时不回传即保留);
- 「+ 记一条」内联表单:项目/版本**下拉支持"新建项目/新建版本"**(人工开层,同 record 建层);人工记录默认无 diff,可由 AI 后补;
- 删除:按钮变红色确认态(再点才删),不弹 Dialog;
- 树节点**右键菜单:重命名**(v2,补齐人工重命名能力);
- diff 折叠默认收起,点开用现成 DiffViewer 渲染;
- AI 使用指南:左栏入口 → 页内切换指南视图(非弹窗),渲染 mcpToolCatalog。

### 7.2 claude-profile 单面板化(功能不变)

单面板:profile 卡片列表(选中即当前)、点击直接切换、编辑区内联展开(常用字段表单 + JSON 高级模式折叠 + 保存前校验)、API 预设下拉管理、备份/回滚内联列表。零二级弹窗。

### 7.3 样式统一原则

只用现有 ui/(shadcn/ui)组件;颜色/间距/字号走 Tailwind v4 设计 token(CSS 变量),禁硬编码,亮暗主题兼容;布局密度对齐 KnowledgeView;中文文案语气统一。

## 8. 实施顺序与风险(顺序详见实施计划文档,v2 时间修正)

预估 **13-16h**(v1 的 11h 偏乐观,三路审阅一致:Step1/5/6 最紧)。

| 风险 | 应对 |
|------|------|
| 砍除牵动 server.ts 与 50+ 文件 | 每步 tsc + 全量测试;砍除步独立 commit;grep 残留清零(floating/projectChatStore 关键词在列) |
| 双进程丢更新 | proper-lockfile + write-file-atomic + 读不缓存(§4.1);双实例单测模拟双进程 |
| 旧功能反悔 | 旧数据文件保留;代码 git 可回滚 |
| AI 误删 | 所有删除(含单条)前快照,滚动 10 份 |
| 版本树变脏 | list_projects 先查 + record 返回"已新建版本"标注 + 指南话术 |
| proper-lockfile 在 Windows 的兼容性 | mkdir 锁策略本身跨文件系统原子;Step2 冒烟含双进程并发写用例,Step8 回归覆盖 |
| uTools/desktop 壳引用被砍模块 | Step8 冒烟;desktop 仅依赖 server 启动入口 |

## 9. 明确不做(YAGNI 清单)

- git 深度集成(项目路径注册/实时 diff/跳转)→ 下期「项目关联」功能;
- CHANGELOG markdown 导出(导出是视图;changesets 的"文件级冲突隔离"布局留作多人协作时的参考);
- 备份恢复 UI;worklog 分片;
- GET 全树按需加载:worklog.json > 2MB 时再做 entries/:id 按需拉 diff(触发条件写明);
- webclip 的 ClipResponse 任务草稿流向:本期声明"草稿仅供扩展侧预览"(看板已砍,不再入任务流);
- 多用户/权限。

## 10. 业界对照与借鉴(v2 新增)

| 来源 | 结论 | 对本项目 |
|------|------|----------|
| MCP 官方 spec / AWS / TrueFoundry(2025) | 本地单用户单客户端 → stdio 是最佳实践;Streamable HTTP 用于远程多租户 | 保持 stdio,不换 transport;跨进程一致性用文件锁解决 |
| proper-lockfile / write-file-atomic 生态实践 | 锁(mkdir 原子+stale 恢复)+ 原子替换(tmp+rename)是 Node 跨进程写标准组合 | §4.1 直接采用 |
| changesets(npm 标准 changelog 工具) | 每变更独立 md+frontmatter,价值在冲突隔离;聚合是发布时视图 | 验证"导出是视图";多人协作场景可借鉴其文件布局 |
| Clockwork-MCP / Daily Work Log Generator | 同类工具定位"干完活后、汇报完成前记录" | record_work 的 whenToUse 话术与此对齐 |
