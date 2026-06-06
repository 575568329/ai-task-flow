# @ai-task-flow/cli

个人 AI 任务编排看板 + MCP Server 的 CLI。

## 安装

```bash
npm install -g @ai-task-flow/cli
```

## 使用

```bash
# 启动(自动打开浏览器)
ai-task-flow

# 自定义端口
ai-task-flow --port 8080

# 不自动打开浏览器
ai-task-flow --no-open

# 查看帮助
ai-task-flow --help
```

启动后默认在 `http://localhost:3000` 提供:
- **Web UI** — 任务看板,创建/管理任务,查看 Claude Code 执行结果
- **API**   — `/api/*` REST 接口
- **SSE**   — `/api/events` 实时事件推送

任务数据存储在 `~/.ai-task-flow/tasks.json`,事件日志在 `~/.ai-task-flow/events.jsonl`。

## MCP 集成

CLI 启动 HTTP 服务的同时,Claude Code 可通过项目的 MCP Server 拉取/回写任务。详见仓库 README。
