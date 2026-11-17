# worklog 瘦身转型实施计划(2026-11-17)

> 设计文档:`docs/plans/2026-11-17-worklog-slim-design.md`(已定稿)
> 分支:`feat/worklog-slim`
> 节奏:8 步,每步独立 commit,每步结束 `tsc --noEmit` + 全量测试必须全绿。

## Step 1:后端砍除 + MCP 最小化(P0,预估 1.5h)

**目标**:删掉任务/聊天/SSE/usage 后端链路,编译与测试恢复全绿。MCP 暂只留 save_to_knowledge(其任务依赖一并清理),9 个 worklog 工具 Step 4 才上。

**删文件**:

```
backend/src/domain/workflow/                      # Task 聚合根/值对象/仓库接口(整目录)
backend/src/domain/research/                      # ChatMessage/Conversation/ChatRepository
backend/src/application/research/                 # ChatService/SearchOrchestrator/ClassifierService
backend/src/application/usage/                    # UsageService
backend/src/infrastructure/persistence/JsonTaskRepository.ts
backend/src/infrastructure/persistence/TaskFileWatcher.ts
backend/src/infrastructure/persistence/JsonChatRepository.ts
backend/src/infrastructure/git/                   # WorktreeManager(整目录)
backend/src/infrastructure/pubsub/                # EventBus/EventStore
backend/src/infrastructure/search/GlmWebSearchClient.ts
backend/src/interfaces/http/routes/taskRoutes.ts
backend/src/interfaces/http/routes/sseRoutes.ts
backend/src/interfaces/http/routes/chatRoutes.ts
backend/src/interfaces/http/routes/taskChatRoutes.ts
backend/src/interfaces/http/routes/projectChatRoutes.ts
backend/src/interfaces/http/routes/projectRoutes.ts
backend/src/interfaces/http/routes/usageRoutes.ts
backend/src/interfaces/mcp/tools/{list-pending-tasks,get-task,record-result,complete-step,add-note-to-task}.ts
上述对应 __tests__/
```

**改文件**:

- `interfaces/http/server.ts`:移除被砍 import/register/参数;
- `http-server.ts`:移除 SearchOrchestrator/ChatService 等组装;
- `interfaces/mcp/server.ts` + `tools/types.ts`:ToolDeps 换成 worklog 占位(先移除 taskRepository),工具表只注册 save_to_knowledge(若其依赖任务仓库,改依赖 knowledge 路径或暂注入空实现并注明 TODO Step4);
- `config/dataDir.ts`:taskDocsDirPath/taskDocPath/taskSessionsFilePath/sessionTitlesFilePath/chatsFilePath 等聊天与任务专用路径函数暂留(文件仍被 fileRoutes 等读?核实后仅删无人引用者)。

**注意**:`shared/src/types/{task,research,usage}.ts` 本步**不删**(前端仍在编译引用),Step 5 一起删。

**验证**:backend `tsc --noEmit` + vitest 全绿(删除对应测试后数量下降是预期)。

**Commit**:`refactor(backend): 砍除任务派发/AI聊天/SSE/usage 链路,MCP 暂留 save_to_knowledge`

## Step 2:worklog 领域 + Repository(P0,预估 1h)

**目标**:纯后端数据层,可单测的完整 CRUD + 备份。

**新文件**:

- `shared/src/types/worklog.ts`:
  `WorklogProject/WorklogVersion/WorklogEntry/WorklogEntryFile`(字段见设计 §4)、
  API 请求响应类型(WorklogCreateRequest 等);
- `backend/src/domain/worklog/repositories/WorklogRepository.ts`:接口;
- `backend/src/application/worklog/WorklogService.ts`:
  record(自动建层)/query(过滤)/update(含挪版本)/deleteEntry/deleteVersion/deleteProject/
  renameVersion/renameProject/listProjects;
  **破坏性操作前快照**到 `worklog-backups/`,滚动保留 10 份;
  写操作经内存队列串行(单写者);
- `backend/src/infrastructure/persistence/JsonWorklogRepository.ts`:加载 + 原子写(tmp+rename);
- `backend/src/config/dataDir.ts` 增 `worklogFilePath()` / `worklogBackupsDirPath()`。

**TDD**(先写失败测试):

- record:项目/版本不存在自动建;id 唯一;date 取本地日期;
- query:project/version 精确、keyword 大小写不敏感命中 title/detail/files.path、
  tags 包含、limit 截断、includeDiff 开关;
- update:只改传入字段;version 挪动;
- delete/rename:目标不存在→AI 可读错误;破坏性操作后 backups 目录出现快照;
  第 11 次快照挤掉最旧;
- 串行:并发 record 不丢条目。

**Commit**:`feat(worklog): 领域模型+Repository——原子写/单写者/破坏性前快照备份`

## Step 3:shared 工具元数据 + HTTP API(P0,预估 1h)

**目标**:工具目录单一来源落地;页面可用 API。

**新文件**:

- `shared/src/worklog/mcpToolCatalog.ts`:9 工具元数据
  `{ name, description, whenToUse, userPromptExample }`(示例话术给指南页渲染);
- `backend/src/interfaces/http/routes/worklogRoutes.ts`:
  GET /api/worklog(全树) / POST /api/worklog/entries / PUT|DELETE /api/worklog/entries/:id /
  DELETE /api/worklog/versions?project&version / DELETE /api/worklog/projects/:name;
- `server.ts` 注册,与后续 MCP 共用同一 WorklogService 实例(单写者)。

**TDD**:路由集成测试(注入临时 dataDir):正常 200/201、参数缺失 4xx、
删除后 GET 确认、删除产生备份文件。

**Commit**:`feat(worklog): 工具元数据单一来源 + HTTP CRUD API`

## Step 4:MCP 9 工具(P0,预估 1.5h)

**目标**:MCP 工具从 1 个(save_to_knowledge)扩为 10 个(+9 worklog)。

**新文件**:`backend/src/interfaces/mcp/tools/worklog/` 下每工具一文件
(record-work/query-work/list-projects/update-work/delete-work/delete-version/
delete-project/rename-version/rename-project)。

**改文件**:

- `tools/types.ts`:ToolDeps 增 worklogService;
- `tools/index.ts`:工具表由 mcpToolCatalog 驱动注册(definition 从 catalog 生成,handler 手写);
- `mcp/server.ts`:接线 worklogService。

**TDD**:每工具处理器单测(deps 用真 WorklogService+临时目录):
入参校验错误文本可读、record 返回 entryId、query includeDiff 开关、
delete_version 前有备份。工具 schema 与 catalog 一致性断言。

**Commit**:`feat(mcp): worklog 九工具——增删改查/版本项目删除重命名(替换任务工具)`

## Step 5:前端砍除(P0,预估 1.5h)

**删文件**:

```
frontend/src/components/views/{BoardView,ChatView,DocsView,UsageView}.tsx
frontend/src/components/board/            # 整目录
frontend/src/components/chat/             # 整目录
frontend/src/components/docs/             # TaskDocsView(整目录)
frontend/src/stores/{taskStore,chatStore,taskChatStore,projectChatStore,boardGroupingStore}.ts
frontend/src/stores/chat/                 # 整目录(若独立)
frontend/src/api/ 中 task/chat 相关模块
shared/src/types/{task,research,usage}.ts # 此时前后端均无人引用,补删
对应 *.test.*
```

**改文件**:

- `App.tsx`:VIEWS 表删 board/chat/docs/usage,默认视图暂设 knowledge;
- `SidebarNav.tsx`:ViewKey 收敛为 `'knowledge' | 'vocab' | 'mindmap'`(+Step6 的 worklog);
- `SettingsDialog.tsx`:移除过时 Tab/面板引用;
- 其余被砍模块的引用点(grep 清零为准)。

**验证**:frontend tsc + vitest 全绿;grep `BoardView|ChatView|taskStore|chatStore` 无残留。

**Commit**:`refactor(frontend): 砍除看板/聊天/任务文档/用量视图与关联 store`

## Step 6:工作记录页(P0,预估 2h)

**目标**:默认落地视图,两栏布局,内联编辑零弹窗,diff 渲染,AI 指南。

**新文件**:`frontend/src/components/worklog/`:

- `WorklogView.tsx`:两栏骨架 + 数据加载(局部 state,不建全局 store——数据单一树,能局部不全局);
- `ProjectVersionTree.tsx`:左栏树(计数徽标,shadcn Collapsible);
- `EntryList.tsx` / `EntryItem.tsx`:条目流(title/tags/date/files 徽标 + detail markdown 渲染);
- `EntryInlineEditor.tsx`:原地编辑表单(项目/版本 Select + 标题 + detail textarea + files 行 + tags);
- `DiffCollapse.tsx`:折叠面板内嵌现有 DiffViewer;
- `AiGuideView.tsx`:渲染 mcpToolCatalog(作用/何时用/示例话术),从 shared 直接 import;
- `frontend/src/api/worklog.ts`:6 端点客户端。

**改文件**:`ViewKey` 增 `'worklog'`,App.tsx 设为默认视图。

**样式纪律**(设计 §7.3):只用 ui/ 现有组件;颜色/间距全走设计 token;
布局密度对齐 KnowledgeView;亮暗主题可用。

**TDD**:WorklogView 渲染树与条目、EntryItem 编辑保存调用 api、删除二次确认态、
AiGuideView 渲染 9 工具。

**Commit**:`feat(worklog): 工作记录页——两栏树+条目流+内联编辑+diff+AI指南(默认视图)`

## Step 7:claude-profile 单面板化(P1,预估 1.5h)

**目标**:功能清单不变(多套快照/一键切换/备份回滚/API 预设/密钥掩码),
交互重做:单面板、零二级弹窗。

**改文件**:`ClaudeProfilePanel.tsx`(716 行重写):

- profile 卡片列表,选中态即当前激活,点击即切换;
- 编辑区在卡片下**内联展开**(常用字段表单 + JSON 高级模式折叠 + 保存前 JSON 校验);
- API 预设:编辑区内下拉选择 + 就地新增/管理,删除 PresetFormDialog;
- 备份/回滚入口显性化(内联列表,不再藏菜单);
- 删除 PresetFormDialog/ProfileEditDialog 两级 Dialog。

**TDD**:既有 panel 测试改造适配新交互;切换调 api、编辑保存、回滚入口渲染。

**Commit**:`refactor(claude-profile): 单面板化重做——功能不变,消灭二级弹窗`

## Step 8:全量回归 + 壳冒烟(P1,预估 1h)

- backend/frontend/shared:tsc + vitest 全绿;
- backend dev 起服,跑 curl 冒烟:GET /api/worklog 空 JSON、POST 记一条、GET 确认;
- MCP stdio 冒烟:一行脚本调 record_work/list_projects;
- desktop 壳:`desktop/` 起 main.mjs 冒烟(仅验证 server 启动入口无被砍依赖);
- uTools 壳:frontend build 后走 serve-108 快速冒烟(确认无运行时引用断裂);
- 收尾:AGENTS.md 产品概述段落更新为新定位(一小段,不重写全文)。

**Commit**:`test: worklog 转型全量回归+desktop/uTools 壳冒烟`

## 里程碑与依赖

```
Step1(砍后端) ─→ Step2(领域) ─→ Step3(API+catalog) ─→ Step4(MCP) ─┐
                                                                    ├─→ Step8(回归)
Step5(砍前端) ─→ Step6(工作记录页) ─→ Step7(claude-profile) ────────┘
```

Step5 仅依赖 Step1(后端砍除后前端 API 失效无碍编译),1-4 与 5-7 可交错。
