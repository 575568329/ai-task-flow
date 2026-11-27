# AI 工作记录 · uTools 插件(市场版 v0.2.0)

目标形态:uTools 8 插件壳 + 独立 backend 子进程 + 802 主窗 + `~/.ai-task-flow` 共用数据 +
uTools 内置 MCP(全部 14 个工具)。审核文案见 `store-listing.md`。

> 为什么 backend 是子进程而不是 preload 内 import:uTools 8 的 preload 是渲染进程 CJS 注入,
> 实测对包内 ESM 的 `import()` 会静默挂起;改为用 `process.execPath` +
> `ELECTRON_RUN_AS_NODE=1` 跑自带的 Node 20,不依赖系统 Node,也不打包任何原生二进制。

## 构建

```bash
node tools/utools/build.mjs          # shared/backend/frontend 全量构建 + 打包
node tools/utools/build.mjs --skip-build   # 只重打插件(产物已存在时)
node tools/utools/check-plugin.mjs   # 发行包合规自查
```

产物:`tools/utools/ai-worklog-<version>.upx`(版本取自仓库根 `package.json`)

构建做的事:

- `backend/public` → `web/`(前端,同源托管)
- `backend/dist` → `backend/dist/`(只留 `.js`;排除 `.map/.d.ts/__tests__/interfaces/mcp`)
- `shared/dist` → `backend/node_modules/@ai-task-flow/shared`
- 在 `backend/` 里 `npm install --omit=dev`,只装运行依赖;清掉第三方 `.map` 与
  `demo/test/docs/examples` 等非运行目录
- `plugin.json.tools` 从后端 `ALL_TOOLS` 生成全部 14 个工具 schema,避免与 MCP 漂移
- 写入 `build-id.txt`(`<version>-<构建时间>`),插件用它和 `/health` 的 `buildId` 握手
- 校验:无 `.exe/.dll/.so/.dylib/.node`、无 `.map`、无外部 script、无开发机路径、logo 非默认图

## 安装/验证

1. 把 `.upx` 拖入 uTools 主输入框;若装的旧版本,先在插件管理里移除再拖。
2. `Alt+Space` 输入 `atf` / `工作记录` / `AI工作记录` 回车。
3. 应看到「AI 工作记录」启动页 → 自动打开工作记录视图(iframe 内同源加载)。
4. 失败时看 `~/.ai-task-flow/logs/utools.log`,启动页也会显示错误摘要。

## 实例生命周期(升级不看到旧界面)

- 每次构建写入新的 `build-id.txt`,preload 启动时先探测 47921–47925:
  只有 `/health` 回报的 `buildId` 与本包一致才复用;**不一致就杀掉旧实例的 pid 并重新拉起**。
  升级后不需要手动止血,不会再出现"装完新版还是旧界面"。
- 插件不活跃时后端不退出(缓存/快速重开);uTools 完全退出后,后端连续 60s 读不到
  `~/.ai-task-flow/run/plugin-heartbeat.json` 会自动关服务退出,不留孤儿进程。
- 运行时状态都在 `~/.ai-task-flow/run/`(心跳 + 各端口 pid 表),不参与账号同步。

## 跨站访问边界

- 后端 `CORS` 默认**关闭**,并且对所有带 `Origin` 的浏览器请求做来源校验:
  只放行 `127.0.0.1 / localhost / ::1` 同源页面;`curl`/CLI/MCP 子进程不带 Origin,不受影响。
  这样「任意网页 fetch 本机接口导出知识库」这条链被堵死。
- 需要真正跨域时(例如浏览器扩展 `chrome-extension://<id>`)显式启动:
  `CORS_ORIGIN=chrome-extension://<id> npm start`(多个用逗号分隔,`*` 表示全放开)。

## AI 记录(uTools 内置 MCP)

- 插件启动时在 preload 里 `utools.registerTool` 注册全部 14 个工具;
  `plugin.json.tools` 的 schema 与 stdio MCP 同源生成。
- preload 内部用 `child_process` 拉起 `backend/plugin-entry.mjs`(uTools 自带 Electron Node),
  该能力不暴露给页面;不打包 `.exe/.node`,仅复用已安装的 uTools 运行时。
- 用户在 uTools「设置 → AI 设置 → MCP 服务」开启后,Claude Code / ZCode 等
  标准 MCP 客户端即可发现并调用;不需要再配全局 stdio。
- 插件进程 cwd 不是用户项目目录,`record_work` 支持可选 `sourcePath`
  (AI 从会话上下文传入),用于按项目路径自动归属;也可显式传 `project`。

## 知识库导入/导出

知识库页右上角有「导出」「导入」两个入口,只读本机数据目录,不依赖仓库路径。

导入(支持多选):

- **选择文件…**:一次可多选文本(Markdown/TXT/JSON/CSV/HTML/YML)与附件(PDF/PNG/JPG/GIF/WEBP/SVG/DOCX);
- **选择文件夹…**:保留相对目录结构,文本与附件一起导入;
- 单文件 ≤5MB、单批 ≤500 篇,附件以 base64 提交、按字节落盘(与导出完全对称);
- 内容级幂等:相同内容跳过,同路径不同内容生成 `-imported` 副本,不覆盖;
- 导入后的**文本**会随后续快照同步到 uTools 账号(附件暂不同步)。

导出:

- 把整个知识库打成 zip(`GET /api/knowledge/export`,deflate,保留相对路径,跳过隐藏项),
  解压后可直接用「选择文件夹」原样导回。
- 单次上限 5000 篇 / 200MB;知识库为空时返回 404 并提示。

## 数据:本地优先 + uTools 账号同步

市场版 preload 把 `AI_TASK_FLOW_DATA_DIR` 设为 **`~/.ai-task-flow`**,与现有
desktop/stdio MCP 完全共用同一份数据(用户从桌面版迁过来时直接可见)。

账号同步(`preload-sync.js`):

- 在 uTools 设置开启「数据同步」后,worklog/conclusions/mindmaps + knowledge-base 文本
  以 gzip 分片快照写入 `utools.db`(单文档 1MB 限制,按 600KB 分片),换设备自动拉取;
- 不同步:`llm-config.json`/`claude-profiles.json`(密钥)、`uploads/` 图片、日志、备份;
- 冲突不静默覆盖:覆盖前把本地/云端旧数据备份到 `~/.ai-task-flow/sync-conflicts/`;
- 云同步状态用 `utools.db.replicateStateFromCloud()` 等待拉取完成。

数据文件:

- `worklog.json`、`conclusions.json`、`mindmaps.json`
- `knowledge-base/`、`uploads/`
- `llm-config.json`、`claude-profiles.json`
- 以及迁移标记与备份目录

worklog 写入仍是「进程内 mutex + proper-lockfile 跨进程锁 + 原子写」,
插件页、dev 后端、stdio MCP 同时写不会丢数据。

市场版如果改成 `utools.getPluginLocalDataPath()` 沙箱目录,需要额外做:
「选择已有数据目录」或「从 `~/.ai-task-flow` 复制导入」(见对话里的 B 档评估)。

## 市场版已知边界

- 802 主窗布局需在 uTools 内实测;工具栏已 flex-wrap,空间不足可继续收进筛选下拉。
- 市场版隐藏「Claude 配置」Tab(启动页以 `?market=1` 打开前端);桌面版/个人版仍保留。
- uTools 内置 MCP 暴露全部 14 个工具;执行统一走本机 `/api/tools/:name` 桥接,与 stdio 同一套 handler。
- 若同时开着 dev 后端(47821),插件会在 47921 起自己的实例;两边共享同一数据文件。
- 数据目录固定为 `~/.ai-task-flow`;改成插件沙箱目录需另做导入/选目录(见上)。
- 知识库附件(图片/PDF)能导入导出,但**不参与账号同步**,换设备需重新导入或走导出 zip。
- 提交前仍需在 uTools 开发者工具里补商店截图,并跑官方 selfcheck skill 复核。
