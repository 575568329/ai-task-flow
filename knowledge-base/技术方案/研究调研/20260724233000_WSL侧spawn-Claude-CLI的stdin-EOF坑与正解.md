# WSL 侧 spawn Claude CLI 的 stdin EOF 坑与正解

> 沉淀场景:Node.js 后端(Windows)需要 spawn **WSL 内的** claude,做任务对话(stream-json 双向流)。踩了三天坑,最终在 multica 源码 + 实测里找到根因与正解。

## 一、需求

任务看板支持「Windows / WSL」两侧 claude 对话切换。用户主力在 WSL,要能在网页里实时跟 WSL 的 claude 聊,并续接 WSL 侧历史会话。两侧是两套独立 claude(不同 home、不同 session 池)。

## 二、走过的三条路(坑)

### 路 1:`wsl.exe -- claude ...` + Node stdin pipe —— 初判「wsl.exe 不转发 stdin」

最早按 multica 的做法(见下文)直接 `spawn('wsl.exe', [..., 'claude', ...])`,prompt 写进 Node 的 stdin。当时一次粗测「写进去 claude 没收到」,误判为 **wsl.exe 不转发 Node stdin pipe**,于是退到路 2。

### 路 2:`< file` 重定向喂 prompt —— 静默 exit 0 无输出

把 prompt 的 stream-json envelope 写临时文件,bash 脚本里 `claude ... < prompt.json`。结果:**claude 启动后 exit 0,stdout 无任何 stream-json 输出**。间歇性能成功(产生了一个真实 session id),绝大多数时候静默挂。

为绕 wsl.exe `--` 后参数拼接破坏 `-c` 引号,又加了 bash 脚本文件包装。bash 基础设施全通(echo 能回传、claude 在 `/usr/bin/claude`),但 claude 本体仍静默退出。

### 路 3:实测推翻「不转发」结论,回到 stdin pipe —— 通

用 `wsl.exe -- bash cat.sh`(脚本内 `cat`)+ Node stdin 写两行,cat **完整回显** → **wsl.exe 完全转发 Node stdin pipe**,路 1 的初判是错的(那次粗测方法有 bug,大概率没给子进程启动时间)。

直接 `spawn('wsl.exe', ['--cd', wslCwd, '--', 'claude', ...args])` + stdin pipe,**system/init 事件正常输出,session_id 正确,resume 历史会话成功**。

## 三、根因:stream-json 模式的 stdin 不是「读完即关」

`claude -p --input-format stream-json` 的 stdin 是一根**持续双向流**:

- 父进程通过 stdin 写 `user` 帧(prompt);
- claude 处理过程中可能通过 stdout 发 `control_request` 事件(工具权限确认等),**要求父进程通过同一根 stdin 回 `control_response`**;
- 父进程主动 `stdin.end()`(EOF)才表示「没有更多输入」。

用 `< file` 重定向:文件读完**立即 EOF**,claude 在 stream-json 模式下把 EOF 当作「会话/输入结束」,往往**不做任何处理就 exit 0**,且无 stderr。这解释了「静默 exit 0 无输出」与「间歇成功」(恰好那一轮 claude 没发 control_request、EOF 前已处理完)。

**正解:prompt 必须经 stdin pipe 写入,写完保持打开,直到收到 `result` 事件(或 abort)才 `stdin.end()`。** 两侧 claude(Windows / WSL)都这么做,完全统一。

## 四、参考成熟项目:multica 的做法(`server/pkg/agent/claude.go`)

multica 是「宿主机一侧直接 spawn 本机 claude」,**不做 WSL 分支**(grep 全 server 无 `wsl.exe`)。它的关键约定:

| 维度 | multica 做法 |
|---|---|
| 启动 | `exec.CommandContext(ctx, execPath, args...)`,`execPath` 默认 `"claude"` |
| argv | 固定 `-p --output-format stream-json --input-format stream-json --verbose --permission-mode bypassPermissions --disallowedTools AskUserQuestion` |
| prompt 传递 | **stdin pipe** 写一帧 `{"type":"user","message":{"role":"user","content":[{"type":"text","text":...}]}}\n`(`buildClaudeInput`) |
| stdin 生命周期 | 写完首帧**保持打开**(应答 control_request),收到 `result` / ctx 取消才 `closeStdin()` |
| 协议级参数保护 | 用户 custom_args 不能覆盖 `-p`/`--output-format`/`--input-format`/`--permission-mode`/`--mcp-config`/`--effort`(黑名单) |
| resume | 仅 `--resume`,带 **resume 被拒绝检测**(匹配 `no conversation found` / `no saved session found` 等,被拒则丢 session id 重试新会话) |
| control_request | `handleControlRequest` 自动 approve 所有 tool use,并把 `run_in_background=true` 强制改 false(daemon 模式不产生后台任务) |
| 进程清理 | `cmd.WaitDelay = 10s`;Windows 用 `CREATE_NEW_CONSOLE + HideWindow`(不是 `CREATE_NO_WINDOW`,否则给每个孙子 console-subsystem 进程开可见窗口=弹窗风暴) |
| env | 保留 `CLAUDE_CODE_*` 用户配置(含 `CLAUDE_CODE_GIT_BASH_PATH`),只剥内部进程标记(`CLAUDECODE`/`CLAUDE_CODE_ENTRYPOINT`/...)。曾一刀切剥 `CLAUDE_CODE_*` 导致 Windows 上 claude 找不到 bash.exe 立即退出 |

**对本项目最重要的两点**:① stdin pipe + 保持打开;② control_request 机制(stream-json 不是单向)。

## 五、wsl.exe 的几个硬事实(spike 实证)

1. **转发 stdin**:`wsl.exe -- bash <脚本>` 下,Node 写进 wsl.exe stdin 的数据,WSL 内进程能读到(cat 实测)。之前误判不转发是测试方法问题。
2. **`--` 后参数是逐个 argv,但带空格的值会出问题**:尤其 `bash -c "<含空格命令>"`,wsl.exe 会把引号内容按空格拆,wsl 内 bash 的 `-c` 只取第一个 token → 命令失效。**解法:不要 `bash -c`,直接 `-- claude <独立参数>`**(claude 的参数都不含空格,prompt 走 stdin)。
3. **`--cd` 必须在 `--` 前**:`wsl.exe --cd <mnt路径> -- claude ...`。路径用 `/mnt/c/...` 形态(`wslpath` 翻译)。
4. **claude 要在 WSL PATH**:本项目 WSL 里 claude 在 `/usr/bin/claude`,直接 `-- claude` 可起。
5. **两侧 home 不同**:Windows `C:\Users\about` vs WSL `/home/yufj`,session 文件在不同 `~/.claude/projects/<encoded-cwd>/`,续接 sessionId 必须按侧存取(否则 `No conversation found`)。

## 六、本项目最终实现(`backend/src/application/agent/AgentRunner.ts`)

- `buildSpawn(side)`:
  - windows:`spawn(claude, [...args, '--settings', winPath], {cwd, shell:true})`
  - wsl:`spawn('wsl.exe', ['--cd', toWslPath(cwd), '--', 'claude', ...args, '--settings', toWslPath(winPath)], {shell:false})`
  - 两侧 `stdio: ['pipe','pipe','pipe']`
- `run()`:无条件 `child.stdin.write(envelope)`(envelope = stream-json user 帧),收到 `result` 才 `stdin.end()`。
- `--settings clean.json` 清空 hooks/permissions,隔离用户级 superpowers SessionStart 注入(spike 实证 input 35k→2.5k)。
- 删掉了为 `< file` 方案服务的 `writePromptFile`/`writeWslRunScript`/`shSingle`——YAGNI,正解不需要。

## 七、待办(nice-to-have,未做)

- **resume 被拒绝检测**(对齐 multica):resume 失败报 `No conversation found` 时,丢 session id 自动开新会话重试,而非直接报错给用户。
- **control_response 应答**:当前 `shouldKeep` 过滤了 control_request,靠 `--permission-mode bypassPermissions` 让 claude 不发权限请求。若未来放开交互式权限,需补 control_request → control_response 回环。
- **进程组 / WaitDelay**:Node 侧用 timeout + kill 兜底;WSL 下 kill wsl.exe 能否连带杀掉 claude 孙子,未严格验证(对话场景 max-turns/timeout 可控,风险低)。

## 八、一句话结论

**WSL 侧 spawn claude 的正解 = `wsl.exe --cd <mnt> -- claude <args>` + stdin pipe(prompt 写入,收到 result 才 end)。绝不用 `< file` 重定向——文件读完立即 EOF,stream-json 模式下 claude 会静默 exit 0。**
