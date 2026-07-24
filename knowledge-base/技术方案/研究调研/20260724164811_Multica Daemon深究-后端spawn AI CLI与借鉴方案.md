---
tags: [multica, daemon, spawn, 借鉴方案, 源码剖析, 决策待定]
---
---
tags: [multica, daemon, spawn, 借鉴方案, 研究调研, 源码剖析]
---
# Multica Daemon 深究:后端怎么 spawn AI CLI,我们怎么借鉴

> **Multica 借鉴清单 ①**(底座)。基于本地源码(`D:\Study\multica`)剖析 daemon 工作模式,对照我们的 MCP 拉模型,给借鉴选项与决策点。**不实施,先审。**
>
> 全部结论附源码 `file:line`,可回溯核实。

---

## 一、一句话:daemon = 后端主动 spawn AI CLI

| | 我们(现状) | Multica |
|---|---|---|
| 模型 | **MCP 拉模型**:你在终端 `claude`,后端被动,MCP 反查 `get_task` | **daemon 推模型**:后端主动起 CLI 进程,领任务执行,流式回传 |
| 后端角色 | 被动簿记 | 主动指挥 |

这一刀决定:Autopilot / 实时流 / 多 CLI / 网页原生编排,都**必须后端能 spawn** 才解锁。

---

## 二、工作模式(源码实证数据流)

```
① 前端建 issue / autopilot 触发  →  server 入队
② server  Hub.NotifyTaskAvailable   (daemonws/hub.go:315)  → WS 推 daemon
③ daemon  pollLoop 被 wakeup 唤醒   (daemon.go:2894)
          ClaimTasksWSFirst          (daemon.go:2999)  WS 优先 / HTTP 回退  → 领到 task
④ runTask → agent.New(provider)     (daemon.go:4554)
          → Backend.Execute spawn CLI(隔离 worktree)
⑤ CLI stream-json 输出 → daemon 捕获 → Hub.DeliverDaemonRuntime (hub.go:369) → WS 推前端实时
⑥ heartbeatLoop 15s                 (daemon.go:2261) ↔ server,响应捎带 actions (handleHeartbeatActions:2393)
```

---

## 三、三个关键设计(都可直接学)

### 设计 1:agent 包 = 适配器模式(加 CLI = 加一个文件)

`server/pkg/agent/` 下每个 CLI 一个文件,都实现 `Backend` 接口:

```
claude.go  codex.go  qwen.go  copilot.go  cursor.go  gemini.go  kimi.go
grok.go  hermes.go  opencode.go  pi.go  traecli.go  kiro.go  qoder.go ...
```

`agent.New(agentType, cfg)`(`pkg/agent/agent.go:284`)工厂按 type 返回对应 backend。

> **对我们的价值**:若将来要 spawn,先定义 `Backend` 接口 + 一个 `claude.go`,新增 CLI 零侵入核心。**这就是"适配器模式"的落地实证**(不是 PPT 概念)。

### 设计 2:poll + push 混合领任务(低延迟,不傻轮询)

- **WS 连着**:服务器 `NotifyTaskAvailable` 推 → daemon 立即 claim(**零延迟**)
- **WS 断了**:回退 3s 轮询 `ClaimTasks`(`client.go:204/236`)
- **心跳**(15s,`SendHeartbeat` `client.go:457`)响应还能**捎带 actions** 给 daemon

> **对我们的价值**:我们的看板刷新现在是**纯文件轮询**(等几秒)。可学这个——**WS 事件唤醒为主,poll 兜底**,即时性大增且断线不丢。这是独立于 daemon 的小改、快见效。

### 设计 3:spawn claude 的工业级做法(`pkg/agent/claude.go` 源码)

```go
// claude.go:24  Execute(ctx, prompt, opts)
execPath := "claude"                       // exec.LookPath 确认存在
args := buildClaudeArgs(opts, ...)         // --output-format stream-json -p <prompt>
// 受控 MCP:caller 传 McpConfig → 写临时文件 → --mcp-config <path>
cmd := exec.CommandContext(runCtx, execPath, args...)   // claude.go:60
cmd.Dir = opts.Cwd                         // = 隔离 worktree 目录
stdout, _ := cmd.StdoutPipe()              // 读 NDJSON 事件流 → Message channel
stdin,  _ := cmd.StdinPipe()               // 可注入(交互/追加指令)
cmd.Stderr = newStderrTail(...)            // 失败时带最后几 KB 错误
hideAgentWindow(cmd)                       // headless,不弹窗
cmd.Start()                                // claude.go:93
```

要点:`claude --output-format stream-json -p <prompt> --mcp-config <tmp>`,**stdout 读流、stdin 可写、`--mcp-config` 受控注入(不继承外层 Claude Code 的 MCP)、worktree 隔离、超时/取消/stderr tail**。

> **对我们的价值**:这就是我们「看板对话调研 · 方案 B ClaudeRunner」的**参考实现**——不用从零设计,照着抄参数和管道处理即可。

---

## 四、对我们的映射

| 维度 | 我们(MCP 拉) | Multica(daemon 推) | 切换代价 |
|---|---|---|---|
| 谁起 Claude | 你在终端 | 后端 spawn | 改派发模型 |
| 计费 | 交互式订阅额度 | SDK/API 额度(订阅内含月度额度,重度超额另付) | 方案 B 计费坑 |
| 原生体验 | ✅ 完整保留 | ❌ headless,无 TUI/斜杠命令 | **与 v3「保留原生体验」定位冲突** |
| 解锁能力 | 基本看板 | autopilot / 实时流 / 多 CLI / 网页原生编排 | — |

---

## 五、借鉴选项(三档,给你选)

### A. 不动
保持 MCP 拉,daemon 仅作参考。最稳,不解锁新能力。

### B. 折中借鉴(**推荐先做**)
不切全 daemon,只抄它两个**独立、低成本**的工程模式:
1. **看板刷新改 WS 唤醒 + poll 兜底**(替代文件轮询)——即时性大增,不碰派发模型;
2. **埋一个 `pkg/agent` 式 Backend 接口**(暂只 claude 实现)——为将来 spawn 预留扩展点,现在不启用。

### C. 全切 daemon
后端 spawn ClaudeRunner,解锁 autopilot/实时/多 CLI/网页原生编排。= 方案 B,代价:放弃原生终端 + 计费从交互式订阅切到 SDK 额度。**大决策,需重新对齐产品定位。**

---

## 六、决策点(请你定)

1. daemon 走 **A / B / C** 哪档?
2. 若 **B**:「WS 唤醒 + poll 兜底」先做?(独立、快、替代轮询)
3. **MCP 拉与 daemon 推能否共存?** Multica 是「daemon 为主、MCP(multica-mcp)给外部 LLM 用」。我们可以反过来——**MCP 为主(保原生终端)、daemon 为可选增强**(给自动化/定时留口子),两全。这个方向你认不认?

---

## 七、源码索引(回溯核实用)

| 子系统 | 位置 |
|---|---|
| daemon 主循环 | `server/internal/daemon/daemon.go`(`Run`:999 / `pollLoop`:2894 / `heartbeatLoop`:2261 / `runTask`→`agent.New`:4554) |
| 领任务协议 | `server/internal/daemon/client.go`(`ClaimTask`:204 / `ClaimTasks`:236 / `SendHeartbeat`:457) |
| spawn 各 CLI | `server/pkg/agent/`(`agent.New`:agent.go:284 / `claude.go`:60 / `codex.go`:885) |
| WS 推流 | `server/internal/daemonws/hub.go`(`NotifyTaskAvailable`:315 / `DeliverDaemonRuntime`:369 / 双向 RPC:`SetRPCHandler`:245) |
| 执行隔离 | `server/internal/daemon/execenv/`(`git.go` worktree add/remove、`codex_home`、`isolation_windows/unix`) |
| 配置(per-agent args) | `server/internal/daemon/config.go`(claudeArgs/codexArgs/qwenArgs:346–367) |
