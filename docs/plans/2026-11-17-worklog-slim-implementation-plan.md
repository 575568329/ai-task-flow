# worklog 瘦身转型实施计划(2026-11-17,v2)

> 设计文档:`docs/plans/2026-11-17-worklog-slim-design.md`(v2,含三路审阅修订与业界对照)
> 分支:`feat/worklog-slim`
> 节奏:8 步,每步独立 commit,每步结束 `tsc --noEmit` + 全量测试全绿。
> v2 变更:补齐三路审阅发现的清单遗漏(tools/index.ts、floating、MessageContent 迁移、api/task 迁出、
> shared 类型抽取、system 裁剪等);写协调改 proper-lockfile+write-file-atomic;时间预估 11h→13-16h。

## Step 1:后端砍除 + MCP 最小化(P0,预估 2.5h)

**目标**:删掉任务/聊天/SSE/usage 后端链路与 system 死端点,编译与测试恢复全绿。MCP 只留 save_to_knowledge。

**删文件**:

```
backend/src/domain/workflow/                      # 整目录
backend/src/domain/research/                      # ChatMessage/Conversation/ChatRepository
backend/src/application/research/                 # ChatService/SearchOrchestrator/ClassifierService
backend/src/application/usage/                    # UsageService
backend/src/application/agent/                    # AgentRuntimeManager(8 文件+7 测试;仅被死端点引用)
backend/src/infrastructure/persistence/JsonTaskRepository.ts
backend/src/infrastructure/persistence/TaskFileWatcher.ts
backend/src/infrastructure/persistence/JsonChatRepository.ts
backend/src/infrastructure/persistence/TaskSessionStore.ts
backend/src/infrastructure/persistence/SessionTitleStore.ts
backend/src/infrastructure/persistence/taskDoc.ts
backend/src/infrastructure/git/                   # WorktreeManager(整目录)
backend/src/infrastructure/pubsub/                # EventBus/EventStore
backend/src/infrastructure/search/GlmWebSearchClient.ts
backend/src/infrastructure/search/ArxivClient.ts  # 唯一消费者 SearchOrchestrator 已删
backend/src/interfaces/http/routes/taskRoutes.ts
backend/src/interfaces/http/routes/sseRoutes.ts
backend/src/interfaces/http/routes/chatRoutes.ts
backend/src/interfaces/http/routes/taskChatRoutes.ts
backend/src/interfaces/http/routes/projectChatRoutes.ts
backend/src/interfaces/http/routes/projectRoutes.ts
backend/src/interfaces/http/routes/usageRoutes.ts
backend/src/interfaces/mcp/tools/{list-pending-tasks,get-task,record-result,complete-step,add-note-to-task}.ts
上述对应 __tests__/
tests/test-mcp-tools.sh                           # 测 5 个旧 MCP 工具,必红
tests/curl/test_task_api.sh
```

**改文件**:

- `interfaces/mcp/tools/index.ts`(**P0 修正:必须本步改**,v1 遗漏致 tsc 断):删 5 个 import 与注册,工具表只剩 save_to_knowledge;
- `interfaces/http/server.ts`:移除被砍 import/register/参数与模块级单例(TaskSessionStore/SessionTitleStore/AgentRuntimeManager);onClose 的 agentRuntimeManager.shutdown 移除;
- `http-server.ts`:移除 SearchOrchestrator/ChatService 组装与**启动时补写任务 markdown 逻辑**(依赖 taskRepository.findAll);
- `interfaces/http/routes/system.ts`(**system 裁剪**):保留 storage/mcp-setup/health;删 select-directory、claude-sessions、open、agent-runtime/snapshot 端点;`isValidRepoPath` 自 projectChatHelpers 迁入 system(或 utils)后**删除 projectChatHelpers.ts**(其测试随之删除);
- `interfaces/http/__tests__/server.test.ts`:**改造而非全删**——删 Task CRUD 段,保留 Health/WebClip/Mindmap 段;
- `application/system/StorageService.ts`:暂留 dataDir 函数引用(它引用 tasksFilePath/chatFilePath/taskDocsDirPath),仅更新 tasks/chats/taskDocs 类目文案为"(旧数据)";
- `config/dataDir.ts`:任务/聊天专用函数暂留(消费者 StorageService);`uploadsDirWindowsPath` 零引用可删;
- `dataDir` 表述修正(v1 笔误):实际函数名 `chatFilePath` 非 chatsFilePath。

**注意**:`shared/src/types/{task,research,usage}.ts` 本步不删(见 Step 5 抽取前置)。

**验证**:tsc + vitest 全绿;`tests/run_all.sh` 可跑(新增 worklog curl 冒烟在 Step 8)。

**Commit**:`refactor(backend): 砍除任务/聊天/SSE/usage 链路与 system 死端点,MCP 暂留 save_to_knowledge`

## Step 2:worklog 领域 + Repository(P0,预估 1.5h)

**目标**:数据层完整 CRUD + 跨进程写协议 + 备份。

**新依赖**:`proper-lockfile` + `@types/proper-lockfile`、`write-file-atomic` + `@types/write-file-atomic`(业界标准组合,见设计 §10)。

**新文件**:

- `shared/src/types/worklog.ts`:三层模型 + 请求响应类型(字段与约束见设计 §4:name trim 非空禁 `/`,entry.updatedAt);
- `backend/src/domain/worklog/repositories/WorklogRepository.ts`:接口;
- `backend/src/application/worklog/WorklogService.ts`:record/query/update(partial)/deleteEntry/deleteVersion/deleteProject/renameVersion(重名报错)/renameProject/listProjects;
- `backend/src/infrastructure/persistence/JsonWorklogRepository.ts`:**每次操作读最新文件**(读不缓存);写 = proper-lockfile 锁 → 重读 → 变更 → write-file-atomic → 解锁;破坏性操作(deleteEntry 含单条/deleteVersion/deleteProject/rename_*)前置快照,文件名 `backup-<YYYYMMDDHHMMSSmmm>_<rand4>.json`,滚动 10 份;
- `config/dataDir.ts` 增 `worklogFilePath()` / `worklogBackupsDirPath()`。

**TDD**(先写失败测试):

- record:自动建层;record 返回值标注"已新建版本";id 唯一;date 本地日期;
- query:精确/模糊/tags/limit/includeDiff/**dateFrom+dateTo**(v2);
- update:partial 只改传入字段;挪向不存在的版本自动建(v2);
- rename:目标重名 → 可读错误不改(v2);
- 备份:delete_work 与页面级删除均产生快照(v2);第 11 份挤掉最旧;同毫秒两次快照不互覆;
- **跨进程模拟**:同进程 new 两个 Repository 实例(模拟 HTTP 进程与 MCP 进程)并发 record+update,无丢更新、无半截文件。

**Commit**:`feat(worklog): 领域模型+Repository——proper-lockfile 跨进程写协议+破坏性前快照`

## Step 3:shared 工具元数据 + HTTP API(P0,预估 1h)

**新文件**:

- `shared/src/worklog/mcpToolCatalog.ts`:9 工具元数据 `{ name, description, whenToUse, userPromptExample }`;**加入 `shared/src/index.ts` barrel 导出**(shared exports 仅暴露根路径,前端经 workspace dist 消费——**改 shared 后须 rebuild 前端 tsc 才绿**,写入本步验证清单);
- `backend/src/interfaces/http/routes/worklogRoutes.ts`:
  GET /api/worklog / POST /api/worklog/entries / PUT|DELETE /api/worklog/entries/:id /
  DELETE /api/worklog/versions / POST /api/worklog/versions/rename / POST /api/worklog/projects/:name/rename(v2 补);
- `server.ts` 注册。HTTP 与 MCP 各自实例化 Repository,一致性靠 Step 2 锁协议。

**TDD**:路由集成测试(临时 dataDir):CRUD 正常路径;**PUT partial 语义——只传 title 时 diff/files 不丢**(v2 红灯测试);rename 端点重名 4xx;删除产生备份文件。

**Commit**:`feat(worklog): 工具元数据单一来源 + HTTP CRUD/rename API(partial 语义)`

## Step 4:MCP 9 工具(P0,预估 1.5h)

**新文件**:`backend/src/interfaces/mcp/tools/worklog/` 每工具一文件(9 个)。

**改文件**:

- `tools/types.ts`:ToolDeps 增 worklogService(或直接依赖 Repository,与 HTTP 同构);
- `tools/index.ts`:注册 9 工具;**工具 name/description 取自 mcpToolCatalog**(单一来源),inputSchema 手写于各工具文件;
- `mcp/server.ts`:装配。

**TDD**:每工具单测(临时目录真依赖):校验错误返回 `isError: true` + 可读文本(v2);record 返回 entryId 与"已新建版本"标注;query includeDiff/date 过滤;delete_* 前有备份;**catalog 与注册表 name/description 一致性断言**(schema 不在断言范围)。

**Commit**:`feat(mcp): worklog 九工具——增删改查/删除重命名/日期过滤(替换任务工具)`

## Step 5:前端砍除(P0,预估 3h)

**先迁移(防编译断,v1 三处遗漏修正)**:

1. `chat/MessageContent.tsx`、`chat/CodeBlock.tsx`、`chat/MermaidBlock.tsx` → `components/common/`(KnowledgeViewer 在用),改 import;
2. `api/task.ts` 内 `systemApi`/`fetchHealth` → 新建 `api/system.ts`(App 骨架/StoragePanel 在用),消费点改 import;
3. `shared/src/types/task.ts` 内 WebClipService 使用的 StepBlock/TaskStep 等 → 抽到 `types/webclip.ts`,改 `WebClipService.ts` import。

**再删除**:

```
frontend/src/components/views/{BoardView,ChatView,DocsView,UsageView}.tsx
frontend/src/components/board/  components/chat/(迁移后余下文件)  components/docs/  components/floating/(v2 补:10 文件)
frontend/src/stores/{taskStore,chatStore,taskChatStore,projectChatStore,boardGroupingStore}.ts + stores/chat/
frontend/src/api/{task,taskChat,projectChat,chat,chatStream,sse,sse-utils,files}.ts
frontend/src/lib/{chatEvents,repoHistory,taskMeta}.ts
frontend/src/components/McpHelpPanel.tsx          # 指南唯一入口在工作记录页
shared/src/types/{task,research,usage,agent}.ts + shared/src/utils/{prompt,steps}.ts
shared/src/index.ts barrel 对应行清理
对应 *.test.*
```

**lib 保留(勿删)**:`speech.ts`/`docExport.ts`/`formatDate.ts`/`copyPath.ts`(VocabView/KnowledgeViewer 在用)。

**改文件**:

- `App.tsx`:VIEWS 表删 4 项;**启动 useEffect(SSE/taskStore 逻辑)整体重写为仅 fetchHealth**;移除 FloatingChatRoot 挂载;默认视图暂设 knowledge;
- `SidebarNav.tsx`:ViewKey 收敛;
- `SettingsDialog.tsx`:移除 McpHelpPanel/过时 Tab;
- `StoragePanel.tsx`:import 改 api/system,类目文案更新。

**验证**:tsc + vitest 全绿;`grep -r "FloatingChatRoot\|projectChatStore\|BoardView\|ChatView\|taskStore\|chatStore\|MessageContent.*chat/" frontend/src` 残留为零;shared rebuild 后 frontend tsc 亦绿。

**Commit**:`refactor(frontend): 砍除看板/聊天/悬浮窗/任务文档/用量——迁移通用组件后清理`

## Step 6:工作记录页(P0,预估 3.5h)

**新文件**:`frontend/src/components/worklog/`:

- `WorklogView.tsx`(两栏骨架,局部 state,每次操作后重拉 /api/worklog——读不缓存与后端一致);
- `ProjectVersionTree.tsx`(计数徽标 + **右键菜单:重命名**(v2),shadcn ContextMenu);
- `EntryList.tsx` / `EntryItem.tsx`(title/tags/date/files 徽标 + detail 渲染,新在前按 createdAt/updatedAt);
- `EntryInlineEditor.tsx`(partial 提交:表单外字段不回传即保留;项目/版本下拉含"新建"选项;人工默认无 diff);
- `DiffCollapse.tsx`(折叠 + 现成 DiffViewer);
- `AiGuideView.tsx`(渲染 mcpToolCatalog:作用/何时用/示例话术);
- `api/worklog.ts`(7 端点客户端)。

**改文件**:ViewKey 增 `'worklog'`,设默认视图。

**样式纪律**:只用 ui/ 现有组件;token 化颜色间距;密度对齐 KnowledgeView;亮暗主题。

**TDD**:树/条目渲染;编辑保存后 **diff 字段不丢**(v2 红灯);删除二次确认态;右键重命名调 API;AiGuide 渲染 9 工具。

**Commit**:`feat(worklog): 工作记录页——两栏树+内联编辑(partial)+diff+右键重命名+AI指南(默认视图)`

## Step 7:claude-profile 单面板化(P1,预估 1.5h)

`ClaudeProfilePanel.tsx`(716 行)重写:卡片选中即切换、编辑内联展开(常用字段表单 + JSON 折叠高级模式 + 保存前校验)、API 预设下拉管理、备份/回滚内联列表;删除 PresetFormDialog/ProfileEditDialog。功能清单不变。既有测试改造适配。

**Commit**:`refactor(claude-profile): 单面板化重做——功能不变,消灭二级弹窗`

## Step 8:全量回归 + 壳冒烟(P1,预估 1h)

- backend/frontend/shared:tsc + vitest 全绿;**Windows 双进程锁冒烟**:两个 node 进程并发 record_work,无丢更新(v2);
- 新增 `tests/curl/test_worklog_api.sh`(record→query→delete 断言备份产生),`tests/run_all.sh` 全绿;
- MCP stdio 冒烟:record_work/list_products 一轮;
- desktop 起 main.mjs 冒烟;uTools 壳 serve-108 快速冒烟;
- 收尾:AGENTS.md 产品概述段更新;**注明旧任务存档仍在 `~/.ai-task-flow/tasks/`(DocsView 已移除,手工可看)**。

**Commit**:`test: worklog 转型全量回归——双进程锁冒烟+curl+desktop/uTools 壳`

## 里程碑与依赖

```
Step1(砍后端) ─→ Step2(领域+锁) ─→ Step3(catalog+API) ─→ Step4(MCP) ─┐
                                                                      ├─→ Step8(回归)
Step5(砍前端,仅依赖 Step1) ─→ Step6(工作记录页) ─→ Step7(claude-profile) ┘
```

时间合计 ≈ 15.5h(区间 13-16h,v1 的 11h 系统性偏乐观已修正)。
