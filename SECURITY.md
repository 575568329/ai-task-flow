# 安全策略

## 报告漏洞

发现安全问题请**不要**开公开 Issue,邮件联系 `yufj@intest.cn`,或私下告知维护者。

## 已知安全边界(设计声明,非漏洞)

AI Task Flow 是**本地个人工具**,以下行为是设计选择,不在漏洞受理范围:

### 1. HTTP 服务无鉴权

- 默认监听 `127.0.0.1`(本机回环),不对外。
- 如需局域网访问,设 `HOST=0.0.0.0` 启动,但**同网段任意主机可访问全部接口**(含 spawn 终端、bypass 权限)——仅在隔离可信网络这么做,启动时会打印安全告警。

### 2. Claude Code 权限旁路(bypassPermissions)

- 常驻对话 runtime 默认开启 `bypassPermissions`(claude 自动执行不卡顿,个人工具设计)。
- 每次 runtime 创建记 `WARN` 日志(`agent-runtime` category),便于事后排查「为什么没弹权限」。
- 远程攻击面已由 host 收敛(默认 127.0.0.1)+ system 路由非本机拒绝根治。

### 3. 明文凭证落盘

- `~/.ai-task-flow/` 下的配置文件(`llm-config.json` / `claude-profiles.json` / `claude_desktop_config.json`)含明文 API Key / `ANTHROPIC_AUTH_TOKEN`。
- 仅后端进程读写,文件权限 `0600`;任何下发前端前必须脱敏(GET `/api/llm-config` 已脱敏)。
- Claude profile 的 `settings` 因用户需编辑自己的快照(含 token)而完整下发(决策 3A),前端 JSON 编辑器有敏感凭证提示。

### 4. spawn 终端通道

- `/api/system/claude-sessions/open` 接收 `repoPath` 拼进 shell 命令,有 `isSafeRepoPath` 校验(合法绝对路径 + shell 元字符黑名单)防命令注入。
- 非本机访问拒绝 spawn(纵深防御)。

## 受理范围

- 上述边界绕过(如默认配置下远程可触发 spawn / 明文 token 下发到前端列表)
- 路径穿越、命令注入、XSS 等 OWASP 经典漏洞
- 依赖已知 CVE

## 不受理

- 公网部署的安全问题(本项目不面向公网)
- 无鉴权下的多用户隔离(设计为单用户本地)
- 「服务无鉴权」本身(已声明为设计)
