# MCP 注册登记(ai-task-flow)

> **用途**:ai-task-flow 的 MCP server 在各 AI 客户端的注册清单与版本记录。
> 更新 MCP 代码后,按文末「更新 SOP」操作并回写「当前版本」。

## Server 本体

| 项 | 值 |
|---|---|
| 名称 | `ai-task-flow` |
| 产物 | `D:/Study/ai-task-flow/backend/dist/interfaces/mcp/server.js`(由 `cd backend && npm run build` 生成) |
| Transport | stdio(本地单用户;远程部署时切换 Streamable HTTP,见 docs/plans/2026-11-17-worklog-slim-design.md §10) |
| 工具(14) | record_work / query_work / list_projects / list_programs / list_versions / update_work / delete_work / delete_version / delete_project / rename_version / rename_project / record_conclusion / query_conclusions / save_to_knowledge |
| 数据 | `~/.ai-task-flow/worklog.json`(备份 `~/.ai-task-flow/worklog-backups/`,滚动 10 份);`~/.ai-task-flow/conclusions.json`(备份 `~/.ai-task-flow/conclusion-backups/`,滚动 10 份) |

## 当前版本

| 项 | 值 |
|---|---|
| dist 构建来源 commit | `108f45c` + 工作区市场版改动(uTools 适配:query 端点/record sourcePath;工具仍 14 个) |
| 构建时间 | 2026-11-27 09:45(构建元数据 `backend/dist/.mcp-build-meta.json`) |
| 源码哈希 | `cbf61efcb454`(101 个源文件,`npm run check:mcp` 可复核) |
| server version(MCP initialize 返回) | 0.1.0 |

> **防漂移**:`backend` 的 build 在 `tsc` 之后自动写构建元数据(源码内容哈希 + commit + 时间);
> `npm run check:mcp` 比对当前 `backend/src` + `shared/src` 与元数据,不一致即退出码 1 并列出改了哪些文件——
> 解决"改了代码忘记 build,全局客户端静默跑旧工具"的问题。

## 注册清单

| # | 客户端 | 范围 | 配置文件 | 状态 |
|---|--------|------|----------|------|
| 1 | ZCode | **用户全局** | `~/.zcode/cli/config.json` → `mcp.servers["ai-task-flow"]` | ✅ 2026-11-18 注册 |
| 2 | Claude Code | **用户全局** | `~/.claude.json` → `mcpServers["ai-task-flow"]` | ✅ 2026-11-18 注册 |
| 3 | Claude Code | 项目级(仓库资产,其他机器 clone 可用) | `<repo>/.mcp.json`(相对路径 `backend/dist/...`,git 跟踪) | ✅ 既有 |
| 4 | ZCode | ~~项目级~~ | ~~`<repo>/.zcode/config.json`~~ | 已移除(全局 #1 覆盖,单点维护;.zcode/ 本就在 gitignore) |

所有注册均指向**同一 dist 绝对路径**(项目级 .mcp.json 为相对路径,以仓库为根)——
即"版本"只由 dist 产物决定,客户端配置无需随版本变动。

## uTools 内置 MCP(市场版插件,可选)

市场版插件额外把 **全部 14 个工具**通过 uTools 8 的内置 MCP 服务暴露给 AI 客户端:

- 声明:`tools/utools/build/plugin.json` 的 `tools`(构建时从后端 `ALL_TOOLS` 生成,与 stdio 同源);
- 执行:`tools/utools/preload-tools.js` 用 `utools.registerTool` 注册,内部只调用本机
  `127.0.0.1` 的固定 `/api` 路径;
- 使用:用户在 uTools「设置 → AI 设置 → MCP 服务」开启后,Claude Code / ZCode 等
  标准 MCP 客户端连接 uTools 即可,无需再配全局 stdio;
- 与本文上半部分的关系:全局 stdio 注册仍服务本机开发/桌面版;uTools 插件是市场用户的
  零 Node 依赖路径。两条路径共享 `~/.ai-task-flow` 与同一套文件锁协议。

工具范围:worklog 11(record_work / query_work / list_projects / list_programs / list_versions /
update_work / delete_work / delete_version / delete_project / rename_version / rename_project)
+ record_conclusion / query_conclusions / save_to_knowledge。
执行统一走 HTTP 桥接 `POST /api/tools/:name`(复用 stdio 的 HANDLERS,参数校验/错误文案同源)。

## 更新 SOP(改了 MCP 相关代码后)

```bash
# 1. 重新构建产物(所有注册点指向同一文件,重建即全局生效)
#    构建末尾自动写入 backend/dist/.mcp-build-meta.json
cd backend && npm run build

# 2. 校验产物与源码一致(输出 ✅ 与源码哈希;不一致会列出改动文件并以 1 退出)
cd .. && npm run check:mcp

# 3. 冒烟验证(stdio 全链路:initialize → tools/list → record → 清理)
#    (见 tests/curl/test_worklog_api.sh 与本文档同目录的验证方式;或直接让 AI 调 list_projects)

# 4. 回写本文档「当前版本」:
#    dist 构建来源 commit ← git log --oneline -1
#    构建时间/源码哈希 ← backend/dist/.mcp-build-meta.json 的 builtAt / sourceHash
#    (以元数据为准,不要用文档编辑时刻或产物 mtime 猜)

# 5. 客户端无需改配置——Claude/ZCode 每次新会话都会重新拉起 stdio 进程,自动加载新 dist;
#    已开着的旧会话需重启才能用新版。
```

## 排障速查

- ZCode:Settings → MCP 看 `ai-task-flow` 状态;`failed` 多为 dist 未构建(跑 build)或 node 不在 PATH;
- Claude Code:`claude mcp list` 查看;项目内 `.mcp.json` 与全局同时存在时,全局(用户级)优先;
- stdio server 的报错输出在客户端日志里;直接 `node <server.js路径>` 手跑可复现启动错误;
- 配置备份:`~/.zcode/cli/config.json.bak-*`、`~/.claude.json.bak-*`(注册操作前自动留档);
- 怀疑跑的是旧工具:`npm run check:mcp`(在仓库根执行),报过期就 `cd backend && npm run build`。
