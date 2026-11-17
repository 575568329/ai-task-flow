# worklog 瘦身转型实施计划(2026-11-17,v3)

> 设计文档:`docs/plans/2026-11-17-worklog-slim-design.md`(v3)
> 分支:`feat/worklog-slim`
> 节奏:8 步,每步独立 commit,每步结束 `tsc --noEmit` + 全量测试全绿。
> v2→v3 变更(第二轮三路审阅):补 mcp/server.ts+types.ts 装配断链与 sdk-loader/TerminalLauncher/modelPricing、
> shared 6 类型二次迁移(usage/agent → claude-session.ts)、api/usage.ts、测试资产补全、锁协议双层化、
> 删项目端点、时间 15.5h→18-20h。

## Step 1:后端砍除 + MCP 最小化(P0,预估 3.5h)

**目标**:删掉任务/聊天/SSE/usage 后端链路与 system 死端点,编译与测试恢复全绿。MCP 只留 save_to_knowledge。

**删文件**:

```
backend/src/domain/workflow/                      # 整目录
backend/src/domain/research/                      # ChatMessage/Conversation/ChatRepository
backend/src/application/research/                 # ChatService/SearchOrchestrator/ClassifierService
backend/src/application/usage/                    # UsageService
backend/src/application/agent/                    # 整目录(AgentRuntimeManager 等)
backend/src/utils/sdk-loader.ts                   # v3 P0:import AgentRunner,agent 删后必断
backend/src/infrastructure/persistence/JsonTaskRepository.ts
backend/src/infrastructure/persistence/TaskFileWatcher.ts
backend/src/infrastructure/persistence/JsonChatRepository.ts
backend/src/infrastructure/persistence/TaskSessionStore.ts
backend/src/infrastructure/persistence/SessionTitleStore.ts
backend/src/infrastructure/persistence/taskDoc.ts
backend/src/infrastructure/git/                   # WorktreeManager(整目录)
backend/src/infrastructure/pubsub/                # EventBus/EventStore
backend/src/infrastructure/search/GlmWebSearchClient.ts
backend/src/infrastructure/search/ArxivClient.ts
backend/src/infrastructure/system/TerminalLauncher.ts   # v3:open 死端点专用,且 import TaskEnv
backend/src/infrastructure/llm/modelPricing.ts    # v3:UsageService 专用
backend/src/interfaces/http/routes/taskRoutes.ts
backend/src/interfaces/http/routes/sseRoutes.ts
backend/src/interfaces/http/routes/chatRoutes.ts
backend/src/interfaces/http/routes/taskChatRoutes.ts
backend/src/interfaces/http/routes/projectChatRoutes.ts
backend/src/interfaces/http/routes/projectRoutes.ts
backend/src/interfaces/http/routes/usageRoutes.ts
backend/src/interfaces/http/routes/projectChatHelpers.ts # v3:直删不迁移(isSafeRepoPath 调用点全在死端点)
backend/src/interfaces/http/routes/__tests__/systemRoutes.test.ts  # v3:测被裁端点
backend/src/interfaces/mcp/tools/{list-pending-tasks,get-task,record-result,complete-step,add-note-to-task}.ts
上述对应 __tests__/
tests/test-mcp-tools.sh
tests/curl/test_task_api.sh
tests/curl/test_claude_sessions.sh                # v3:claude-sessions 端点被裁
```

**改文件**:

- `interfaces/mcp/tools/index.ts`:删 5 个 import 与注册,工具表只剩 save_to_knowledge;
- `interfaces/mcp/server.ts`(**v3 P0:v2 重写时丢失,v1 已知教训**):删 TaskRepository/JsonTaskRepository import 与装配,重写为仅装配 KnowledgeService;
- `interfaces/mcp/tools/types.ts`(**v3 P0,同上**):ToolDeps 移除 taskRepository(worklogService Step4 再加);
- `interfaces/http/server.ts`:移除被砍 import/register/参数与模块级单例(TaskSessionStore/SessionTitleStore/AgentRuntimeManager);onClose 的 shutdown 移除;`startHttpServer` 参数签名收窄;
- `http-server.ts`:移除 SearchOrchestrator/ChatService 组装、**启动时补写任务 markdown 逻辑**(taskRepository.findAll)、JsonTaskRepository/EventBus/EventStore/TaskFileWatcher/ChatRepository 装配;
- `interfaces/http/routes/system.ts`(**system 裁剪**):保留 storage/health;删 select-directory、claude-sessions、open、agent-runtime/snapshot、**mcp-setup**(McpHelpPanel 已删,无消费者)端点与 isSafeRepoPath;`node-file-dialog` 依赖自 package.json 移除;
- `interfaces/http/__tests__/server.test.ts`:改造而非全删——删 Task CRUD 段,保留 Health/WebClip/Mindmap 段;
- `application/system/StorageService.ts`:暂留引用(tasksFilePath/chatFilePath/**eventsFilePath**/taskDocsDirPath),tasks/chats/**events**/taskDocs 类目文案改"(旧数据)";
- `config/dataDir.ts`:暂留上述 4 函数;**删** taskSessionsFilePath/sessionTitlesFilePath/taskDocPath/uploadsDirWindowsPath(零引用);
- **勿删**:`@anthropic-ai/claude-agent-sdk` 依赖(claude-profile 链在用)、ClaudeSessionScanner.ts、migrations.ts。

**注意**:`shared/src/types/{task,research,usage,agent}.ts` 本步不删(见 Step 5 两轮抽取前置)。

**验证**:tsc + vitest 全绿;`tests/run_all.sh` 可跑(worklog curl 冒烟 Step 8 补)。

**Commit**:`refactor(backend): 砍除任务/聊天/SSE/usage 链路与 system 死端点,MCP 暂留 save_to_knowledge`

## Step 2:worklog 领域 + Repository(P0,预估 2h)

**目标**:数据层完整 CRUD + 双层锁写协议 + 备份。

**新依赖**:`proper-lockfile` + `@types/proper-lockfile`、`write-file-atomic` + `@types/write-file-atomic`(业界标准组合,见设计 §10)。

**新文件**:

- `shared/src/types/worklog.ts`:三层模型 + 请求响应类型(字段与约束见设计 §4:name trim 非空禁 `/`,entry.updatedAt);
- `backend/src/domain/worklog/repositories/WorklogRepository.ts`:接口;
- `backend/src/application/worklog/WorklogService.ts`:record/query/update(partial)/deleteEntry/deleteVersion/deleteProject/renameVersion(重名报错)/renameProject/listProjects——HTTP 与 MCP 的**唯一入口**,partial/建层/重名规则单点;
- `backend/src/infrastructure/persistence/JsonWorklogRepository.ts`:**extends JsonRepository 基类**(v3)——复用 `withWriteLock` 进程内 mutex,临界区内 proper-lockfile(**retries/backoff 必配**,ELOCKED→HTTP 409/503、MCP isError;stale 调大)→ **锁内重读** → 变更 → write-file-atomic 写回 → 解锁(catch ECOMPROMISED);**每次操作读最新文件**(读不缓存);破坏性操作(deleteEntry 含单条/deleteVersion/deleteProject/rename_*)在**锁内重读之后、写回之前**落快照,文件名 `backup-<YYYYMMDDHHMMSSmmm>_<rand4>.json`,滚动 10 份;
- `config/dataDir.ts` 增 `worklogFilePath()` / `worklogBackupsDirPath()`。

**TDD**(先写失败测试):

- record:自动建层;record 返回值标注"已新建版本";id 唯一;date 本地日期;
- query:精确/模糊(**大小写不敏感**)/tags/limit/includeDiff/**dateFrom+dateTo**;
- update:partial 只改传入字段;挪向不存在的版本自动建;
- rename:目标重名 → 可读错误不改;rename 成功路径也产生快照;
- list_projects:每版本条目数/首末日期计算正确;
- 备份:delete_work 与页面级删除均产生快照;第 11 份挤掉最旧;同毫秒两次快照不互覆;
- **跨进程模拟**:同进程 new 两个 Repository 实例(模拟 HTTP 与 MCP 双进程)并发 record+update,无丢更新、无半截文件。

**Commit**:`feat(worklog): 领域模型+Repository——双层锁写协议+破坏性前快照`

## Step 3:shared 工具元数据 + HTTP API(P0,预估 1h)

**新文件**:

- `shared/src/worklog/mcpToolCatalog.ts`:9 工具元数据 `{ name, description, whenToUse, userPromptExample }`;**加入 `shared/src/index.ts` barrel 导出**(shared exports 仅暴露根路径,前端经 workspace dist 消费——**改 shared 后须 rebuild 前端 tsc 才绿**,写入本步验证清单);
- `backend/src/interfaces/http/routes/worklogRoutes.ts`:
  GET /api/worklog / POST /api/worklog/entries / PUT|DELETE /api/worklog/entries/:id /
  DELETE /api/worklog/versions?project=&version=(参数走 query) / POST /api/worklog/versions/rename /
  DELETE /api/worklog/projects/:name(v3 补,页面删项目) / POST /api/worklog/projects/:name/rename;
- `server.ts` 注册。HTTP 与 MCP 各自实例化 Repository,一致性靠 Step 2 锁协议。

**TDD**:路由集成测试(临时 dataDir):CRUD 正常路径;**PUT partial 语义——只传 title 时 diff/files 不丢**(红灯测试);rename 端点重名 4xx;删除产生备份文件。

**Commit**:`feat(worklog): 工具元数据单一来源 + HTTP CRUD/rename API(partial 语义)`

## Step 4:MCP 9 工具(P0,预估 1.5h)

**新文件**:`backend/src/interfaces/mcp/tools/worklog/` 每工具一文件(9 个)。

**改文件**:

- `tools/types.ts`:ToolDeps 增 worklogService(v3:taskRepository 已在 Step1 移除;HTTP 与 MCP **统一经 WorklogService**,不直调 Repository);
- `tools/index.ts`:注册 9 工具;**工具 name/description 取自 mcpToolCatalog**(单一来源),inputSchema 手写于各工具文件;
- `mcp/server.ts`:装配。

**TDD**:每工具单测(临时目录真依赖):校验错误返回 `isError: true` + 可读文本;record 返回 entryId、path 与"已新建版本"标注;query includeDiff/date 过滤;delete_*/rename_* 前有快照;**catalog 与注册表 name/description 一致性断言**(schema 不在断言范围)。

**Commit**:`feat(mcp): worklog 九工具——增删改查/删除重命名/日期过滤(替换任务工具)`

## Step 5:前端砍除(P0,预估 4h)

**先迁移(防编译断,两轮审阅共五处)**:

1. `chat/MessageContent.tsx`、`chat/CodeBlock.tsx`、`chat/MermaidBlock.tsx` → `components/common/`(KnowledgeViewer 在用),改 import;
2. `api/task.ts` 内 `systemApi`(仅保留活方法 getStorage/clearStorage)/`fetchHealth` → 新建 `api/system.ts`(App 骨架/StoragePanel 在用),消费点改 import;
3. `shared/src/types/task.ts` 内 WebClipService 使用的 StepBlock/TaskStep 等 → 抽到 `types/webclip.ts`(内联其 `import from './task.js'` 依赖),改 `WebClipService.ts` import;
4. **`shared/src/types/usage.ts` 的 ModelAccum/SessionUsage/TokenUsage 与 `types/agent.ts` 的 ChatTurn/ChatBlock → 迁至保留的 `types/claude-session.ts`**(v3 P0:保留的 ClaudeSessionScanner 引用,不迁则删 types 时后端 tsc 断);
5. `App.tsx` 启动 effect 重写为 **fetchHealth + getStorage(侧边栏存储红点)**,移除 fetchAll/sseClient/taskStore 逻辑。

**再删除**:

```
frontend/src/components/views/{BoardView,ChatView,DocsView,UsageView}.tsx
frontend/src/components/board/  components/chat/(迁移后余下文件)  components/docs/  components/floating/(v3 核实:8 文件)
frontend/src/stores/{taskStore,chatStore,taskChatStore,projectChatStore,boardGroupingStore}.ts + stores/chat/
frontend/src/api/{task,taskChat,projectChat,chat,chatStream,sse,sse-utils,files,usage}.ts   # v3 补 usage.ts
frontend/src/lib/{chatEvents,repoHistory,taskMeta,shortcuts}.ts  # v3 补 shortcuts(动作全是任务语义)
frontend/src/components/{McpHelpPanel,ShortcutsPanel,NightModePanel}.tsx  # 过时面板(NightMode 唯一消费场景是被砍的 board)
shared/src/types/{task,research,usage,agent}.ts + shared/src/utils/{prompt,steps}.ts   # 前置迁移完成后删
shared/src/index.ts barrel 对应行清理
对应 *.test.*
```

**lib 保留(勿删)**:`speech.ts`/`docExport.ts`/`formatDate.ts`/`copyPath.ts`(VocabView/KnowledgeViewer 在用)。

**改文件**:

- `App.tsx`:VIEWS 表删 4 项;启动 effect 见前置迁移第 5 条;移除 FloatingChatRoot 挂载;默认视图暂设 knowledge;
- `SidebarNav.tsx`:ViewKey 收敛;
- `SettingsDialog.tsx`:移除 McpHelpPanel/Shortcuts/NightMode 过时 Tab;
- `StoragePanel.tsx`:import 改 api/system,类目文案更新(含 events 旧数据)。

**验证**:tsc + vitest 全绿;`grep -r "FloatingChatRoot\|projectChatStore\|BoardView\|ChatView\|taskStore\|chatStore\|MessageContent.*chat/" frontend/src` 残留为零;shared rebuild 后 frontend tsc 亦绿。

**Commit**:`refactor(frontend): 砍除看板/聊天/悬浮窗/任务文档/用量——迁移通用组件后清理`

## Step 6:工作记录页(P0,预估 3.5h)

**新文件**:`frontend/src/components/worklog/`:

- `WorklogView.tsx`(两栏骨架,局部 state,每次操作后重拉 /api/worklog——读不缓存与后端一致);
- `ProjectVersionTree.tsx`(计数徽标 + **右键菜单:重命名/删除**(v3:删除覆盖项目与版本,红色确认态,项目走 DELETE /projects/:name 自动备份),shadcn ContextMenu;**工具栏刷新按钮**——读不缓存,手动拉最新);
- `EntryList.tsx` / `EntryItem.tsx`(title/tags/date/files 徽标 + detail 渲染,新在前按 createdAt/updatedAt);
- `EntryInlineEditor.tsx`(partial 提交:表单外字段不回传即保留;项目/版本下拉含"新建"选项;人工默认无 diff);
- `DiffCollapse.tsx`(折叠 + 现成 DiffViewer);
- `AiGuideView.tsx`(渲染 mcpToolCatalog:作用/何时用/示例话术);
- `api/worklog.ts`(7 端点客户端)。

**改文件**:ViewKey 增 `'worklog'`,设默认视图。

**样式纪律**:只用 ui/ 现有组件;token 化颜色间距;密度对齐 KnowledgeView;亮暗主题。

**TDD**:树/条目渲染;编辑保存后 **diff 字段不丢**(红灯);删除二次确认态;右键重命名/删除调 API;AiGuide 渲染 9 工具。

**Commit**:`feat(worklog): 工作记录页——两栏树+内联编辑(partial)+diff+右键重命名+AI指南(默认视图)`

## Step 7:claude-profile 单面板化(P1,预估 1.5h)

`ClaudeProfilePanel.tsx`(716 行)重写:卡片选中即切换、编辑内联展开(常用字段表单 + JSON 折叠高级模式 + 保存前校验)、API 预设下拉管理、备份/回滚内联列表;删除 PresetFormDialog/ProfileEditDialog。功能清单不变。既有测试改造适配。

**Commit**:`refactor(claude-profile): 单面板化重做——功能不变,消灭二级弹窗`

## Step 8:全量回归 + 壳冒烟(P1,预估 1h)

- backend/frontend/shared:tsc + vitest 全绿;**Windows 双进程锁冒烟**:两个 node 进程并发 record_work,无丢更新;
- 新增 `tests/curl/test_worklog_api.sh`(record→query→delete 断言备份产生),`tests/run_all.sh` 全绿;
- MCP stdio 冒烟:record_work/list_projects 一轮;
- desktop 起 main.mjs 冒烟;uTools 壳 serve-108 快速冒烟;
- 收尾:AGENTS.md 产品概述段更新;**注明旧任务存档仍在 `~/.ai-task-flow/tasks/`(DocsView 已移除,手工可看)**。

**Commit**:`test: worklog 转型全量回归——双进程锁冒烟+curl+desktop/uTools 壳`

## 里程碑与依赖

```
Step1(砍后端) ─→ Step2(领域+锁) ─→ Step3(catalog+API) ─→ Step4(MCP) ─┐
                                                                      ├─→ Step8(回归)
Step5(砍前端,仅依赖 Step1) ─→ Step6(工作记录页) ─→ Step7(claude-profile) ┘
```

时间合计 ≈ 18h(区间 18-20h;两轮审阅一致:v2 的 15.5h 仍偏乐观,Step1 牵动 60+ 文件、Step5 两轮迁移叠加,已上调)。
