# 贡献指南

感谢你对 AI Task Flow 的兴趣!这是一个**个人 AI 工作台**(任务编排看板 + 原生 Claude Code 对话 + 知识库 + 思维导图),通过 MCP 协议串联,保留原生 Claude Code 体验。

## 开发环境

需 Node.js ≥ 18 和 git。Windows / macOS / Linux 均可。

```bash
git clone <repo>
cd ai-task-flow
npm install          # 安装所有 workspace 依赖
npm run dev          # 跨平台启动(shared watch + backend + frontend)
```

Windows 用户可用 `npm run dev:windows` 获得端口探测/复用/前端 dist 多形态解析增强。

## 项目结构

| 目录 | 说明 |
|------|------|
| `shared/` | 前后端共享 TS 类型契约(前后端单一真相源) |
| `backend/` | Fastify HTTP + MCP Server,DDD 四层(domain/application/infrastructure/interfaces) |
| `frontend/` | React 19 + shadcn/ui(Radix) + Tailwind v4 + Zustand |
| `cli/` | 命令行入口(端口探测/dev 共存检测/多形态 dist 解析) |
| `extension/` | Chrome 网页剪藏扩展(MV3) |

完整规范见 `AGENTS.md`(编码哲学、分层、TDD、命名等)。

## 开发流程

1. 建分支:`git checkout -b feat/xxx` / `fix/xxx` / `refactor/xxx`
2. 编码:遵循 `AGENTS.md`(TypeScript strict、零 `any`、注释解释 Why 而非 What)
3. 自检:
   ```bash
   cd backend && npx tsc --noEmit && npx vitest run
   cd frontend && npx tsc --noEmit && npm test
   cd extension && npm test
   ```
4. 提交:Conventional Commits(`feat:` / `fix:` / `refactor:` / `docs:` / `chore:` / `test:`)
5. Push 并开 PR(模板见 `.github/PULL_REQUEST_TEMPLATE.md`)

## 测试约定(AGENTS.md §五 TDD)

- 关键业务逻辑必须有单元测试;新增功能先写测试再实现(Red → Green → Refactor)
- 测试命名:`should_<预期>_when_<前置>` 或中文描述
- Mock 外部依赖(数据库/HTTP/MQ),不 Mock 被测对象自身方法
- 每个 curl/API 测试含正常 + 异常场景

## 安全约束

本项目是**本地个人工具**:

- HTTP 服务**无鉴权**,默认仅监听 `127.0.0.1`。不要暴露到公网。
- 涉及凭证(`ANTHROPIC_AUTH_TOKEN` / API Key)的改动需脱敏处理,GET 接口不返回明文。
- spawn 终端等危险操作限本机访问(`isLocalAccess` 校验)。

详见 `SECURITY.md`。

## 提问 / 报告问题

- Bug → [Issue: Bug 报告模板](.github/ISSUE_TEMPLATE/bug_report.md)
- 功能建议 → [Issue: 功能建议模板](.github/ISSUE_TEMPLATE/feature_request.md)
- 安全问题 → 见 `SECURITY.md`(勿开公开 Issue)
