# @ai-task-flow/cli

> 个人 AI 任务编排看板 + Claude Code MCP Server 的 CLI 入口。

在网页看板上录入任务,点派发后创建 git worktree,再用 Claude Code 通过 MCP 拉取任务、回写状态。看板自动同步,保留原生 Claude Code 体验。

[GitHub 仓库](https://github.com/575568329/ai-task-flow) · [Issues](https://github.com/575568329/ai-task-flow/issues)

## 安装

```bash
npm install -g @ai-task-flow/cli
```

## 使用

```bash
# 启动并自动打开浏览器
ai-task-flow

# 自定义端口
ai-task-flow start --port 8080

# 不自动打开浏览器
ai-task-flow --no-open

# 查看帮助
ai-task-flow --help
```

启动后默认在 `http://localhost:3000` 提供:

- **Web UI** — `http://localhost:3000` 任务看板
- **API**   — `http://localhost:3000/api/*` REST 接口
- **SSE**   — `http://localhost:3000/api/events` 实时事件推送

## 数据存储

所有数据存放在用户主目录下,跨项目共享:

| 路径                            | 说明                |
| ------------------------------- | ------------------- |
| `~/.ai-task-flow/tasks.json`    | 任务持久化          |
| `~/.ai-task-flow/events.jsonl`  | 事件日志            |
| `~/.ai-task-flow/uploads/`      | 上传图片            |

## 选项

| 选项               | 说明                       | 默认值  |
| ------------------ | -------------------------- | ------- |
| `-p, --port <n>`   | HTTP 端口                  | `3000`  |
| `--host <addr>`    | 监听地址                   | `0.0.0.0` |
| `--no-open`        | 启动后不自动打开浏览器     | -       |
| `--frontend <dir>` | 自定义前端 dist 目录(开发者用) | -       |
| `-v, --version`    | 显示版本                   | -       |
| `-h, --help`       | 显示帮助                   | -       |

## 许可

MIT © [yufj](https://github.com/575568329)
