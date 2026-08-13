// backend/src/application/agent/AgentRunner.ts
// 任务对话 Agent:按轮 spawn Claude Code CLI(headless stream-json),逐事件透传。
// - 隔离用户级 superpowers hook(--settings clean.json,spike 实证 input 35k→2.5k)
// - prompt 经 stdin stream-json 写入(不经命令行/shell,无转义风险,仿 multica buildClaudeInput)
// - 支持 Windows / WSL 两侧 claude(side 切换):
//     · Windows:直接 spawn claude(shell:true 兼容 .cmd shim)
//     · WSL:spawn wsl.exe --cd <mnt> -- <claude绝对路径> <args>
//       (appendWindowsPath=false + claude 装在 ~/.local/bin,非 login shell PATH 找不到;
//        用绝对路径直接 exec,wsl.exe -- 后 argv 逐个传不经 shell,避开 -c 引号拼接坑)
// - ⚠️ 两侧 prompt 都走 stdin pipe 并在 result 后才 end()。绝不能用 `< file` 重定向:
//   文件读完立即 EOF,而 stream-json 模式下 claude 期望 stdin 是持续流(可能发 control_request
//   待父进程回 control_response),EOF → claude 判定会话结束 → 静默 exit 0 无输出。
//   经 spike 复验:wsl.exe 确实转发 Node stdin pipe(cat 回显实测),无需文件中转。
// - 仅透传对话相关事件(assistant/user/result/system-init),过滤 hook_*/thinking_tokens 噪音
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { toWslPath } from '../../infrastructure/system/pathCodec.js';
import { FileLogger } from '../../infrastructure/logging/FileLogger.js';
import type { AgentEvent } from '@ai-task-flow/shared';

const logger = new FileLogger('agent-runner');

/** 对话跑在哪一侧的 claude */
export type AgentSide = 'windows' | 'wsl';

export interface AgentRunOptions {
  prompt: string;
  /** Claude 工作目录(Windows 形态):任务 worktree 或 repoPath */
  cwd: string;
  /** 跑哪一侧的 claude,默认 windows */
  side?: AgentSide;
  /** 续接上轮会话(--resume) */
  resumeSessionId?: string;
  /** 防失控,默认 50 */
  maxTurns?: number;
  /** 超时,默认 10 分钟 */
  timeoutMs?: number;
  /** 中断信号:abort 时 kill 子进程(用户点「停止」/ 客户端断开) */
  signal?: AbortSignal;
}

/** 仅透传对话相关事件,过滤 hook/thinking_tokens 噪音 */
function shouldKeep(ev: AgentEvent): boolean {
  if (ev.type === 'assistant' || ev.type === 'user' || ev.type === 'result') return true;
  if (ev.type === 'system' && ev.subtype === 'init') return true;
  if (ev.type === 'stream_event') {
    // partial 开后只透传 thinking_delta(思考逐字增量),过滤 text_delta/signature 等噪音控 SSE 流量。
    // text/tool_use 仍走终态 assistant 事件(text 快、非痛点);前端靠「末尾已有 thinking block」去重。
    const e = (ev as { event?: { type?: string; delta?: { type?: string } } }).event;
    return e?.type === 'content_block_delta' && e.delta?.type === 'thinking_delta';
  }
  return false;
}

/** 隔离用的干净 settings:清空 hooks/permissions,阻断 superpowers SessionStart 注入 */
const CLEAN_SETTINGS = JSON.stringify({
  hooks: {},
  permissions: { allow: [], deny: [], ask: [] },
});

let cachedCleanSettingsPath: string | null = null;
function ensureCleanSettings(): string {
  if (cachedCleanSettingsPath && fs.existsSync(cachedCleanSettingsPath)) return cachedCleanSettingsPath;
  const p = path.join(os.tmpdir(), 'ai-task-flow-claude-clean-settings.json');
  fs.writeFileSync(p, CLEAN_SETTINGS, 'utf8');
  cachedCleanSettingsPath = p;
  return p;
}

let cachedWslClaudePathPromise: Promise<string> | null = null;

/**
 * 解析 WSL 侧 claude 的绝对路径(惰性:首次 WSL 调用解析一次后缓存 in-flight Promise)。
 * 背景:appendWindowsPath=false + claude 装在 ~/.local/bin(用户级),非 login shell 的 PATH
 * 不含 ~/.local/bin,故 `wsl.exe -- claude` 报 command not found。改用绝对路径直接 exec
 * (wsl.exe -- 后 argv 逐个传不经 shell,无引号拼接坑)。通过 `wsl.exe -- printenv HOME`
 * 取 home,拼 ${home}/.local/bin/claude(Claude Code 官方安装位置);取不到则回退 'claude'
 * (全局安装场景,非 login PATH 可能含系统级 bin,但 appendWindowsPath=false 下不保证)。
 * 缓存 Promise 而非值:多个 task 并发首调 WSL 侧时共享同一次 wsl.exe 探测(WSL 冷启 4-10s)。
 */
export function resolveWslClaudePath(): Promise<string> {
  if (cachedWslClaudePathPromise) return cachedWslClaudePathPromise;
  cachedWslClaudePathPromise = new Promise<string>((resolve) => {
    const p = spawn('wsl.exe', ['--', 'printenv', 'HOME'], { shell: false, windowsHide: true });
    let out = '';
    p.stdout.on('data', (c: Buffer) => { out += c.toString('utf8'); });
    p.on('error', (err) => {
      logger.warn('解析 WSL home 失败(WSL 未装?),回退裸 claude', { error: err.message });
      resolve('claude');
    });
    p.on('close', (code) => {
      const home = out.trim();
      if (code === 0 && home) {
        const resolved = `${home}/.local/bin/claude`;
        logger.info('解析 WSL claude 路径', { home, path: resolved });
        resolve(resolved);
      } else {
        logger.warn('解析 WSL home 失败,回退裸 claude', { exitCode: code, out });
        resolve('claude');
      }
    });
  });
  return cachedWslClaudePathPromise;
}

const DEFAULT_MAX_TURNS = 50;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const STDERR_TAIL_MAX = 4096;

/**
 * 按 side 构造 spawn 参数。两侧 prompt 都走 stdin pipe(见文件头注释)。
 * - windows:直接 spawn claude,cwd=Windows 路径,settings 用 Windows 路径
 * - wsl:spawn wsl.exe,用 claude 绝对路径(wslClaudePath)直接 exec(每参数无空格,
 *   避开 wsl.exe `--` 后参数拼接破坏 `-c` 引号的坑,故无需 bash 脚本包装);
 *   cwd/settings 都用 toWslPath 翻译成 /mnt 形态
 */
function buildSpawn(opts: AgentRunOptions, settingsPath: string, wslClaudePath: string): {
  command: string;
  args: string[];
  spawnOpts: { cwd?: string; shell: boolean; windowsHide: boolean; stdio: ['pipe', 'pipe', 'pipe'] };
} {
  const maxTurns = String(opts.maxTurns ?? DEFAULT_MAX_TURNS);
  // 协议级固定参数(对齐 multica buildClaudeArgs,用户不可覆盖)
  const baseArgs = [
    '-p',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--verbose',
    // 开 partial:claude 发 stream_event(content_block_delta 逐字增量),前端实时渲染思考过程。
    // 需 claude ≥2.1.205(Windows 2.1.218 / WSL 2.1.220 均满足)
    '--include-partial-messages',
    '--permission-mode', 'bypassPermissions',
    '--max-turns', maxTurns,
  ];
  if (opts.resumeSessionId) baseArgs.push('--resume', opts.resumeSessionId);

  if (opts.side === 'wsl') {
    return {
      command: 'wsl.exe',
      // --cd 在 -- 前;claude 绝对路径及其参数在 -- 后,逐个作为 argv 传给 WSL 内 claude
      args: ['--cd', toWslPath(opts.cwd), '--', wslClaudePath, ...baseArgs, '--settings', toWslPath(settingsPath)],
      spawnOpts: { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    };
  }

  return {
    command: process.env.CLAUDE_EXECUTABLE?.trim() || 'claude',
    args: [...baseArgs, '--settings', settingsPath],
    spawnOpts: { cwd: opts.cwd, shell: true, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  };
}

export class AgentRunner {
  /**
   * 运行一轮对话,逐事件 yield。
   * 正常结束以 type==='result' 的事件收尾;异常(退出码非 0 且无 result)yield error 事件。
   */
  async *run(opts: AgentRunOptions): AsyncGenerator<AgentEvent> {
    const settingsPath = ensureCleanSettings();
    const wslClaudePath = opts.side === 'wsl' ? await resolveWslClaudePath() : 'claude';
    const { command, args, spawnOpts } = buildSpawn(opts, settingsPath, wslClaudePath);
    const child = spawn(command, args, spawnOpts);

    // prompt 经 stdin 写入 stream-json user envelope(两侧统一;仿 multica buildClaudeInput)。
    // 写完保持打开,直到收到 result 才 end()——stream-json 协议下 claude 可能中途发
    // control_request,需要父进程通过同一根 stdin 回 control_response,故不能写完即关。
    const envelope =
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: opts.prompt }] },
      }) + '\n';

    let stderrTail = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail += chunk.toString('utf8');
      if (stderrTail.length > STDERR_TAIL_MAX) stderrTail = stderrTail.slice(-STDERR_TAIL_MAX);
    });

    // spawn 失败(如 wsl.exe 不在 PATH / claude 二进制缺失)会发 'error' 事件,无 handler 则
    // unhandled → 崩后端进程。捕获后存起来,由下方 close 分支降级为 yield error 事件给前端。
    // 用对象容器而非裸 let:TS 控制流会把「仅闭包赋值的 let」窄化为初始值 null,读取处变 never。
    const spawnState: { error: Error | null } = { error: null };
    child.on('error', (err: Error) => {
      spawnState.error = err;
      logger.error('spawn 失败', { command, side: opts.side ?? 'windows', error: err.message });
    });

    try {
      child.stdin?.write(envelope);
    } catch (error) {
      // pipe broken(子进程已退出/claude 不存在):落文件日志,由 close 事件兜底报错,
      // 不静默吞掉(CLAUDE.md 异常处理红线)——否则用户要等到 timeout 才看到错误
      logger.warn('stdin write 失败', {
        command,
        side: opts.side ?? 'windows',
        cwd: opts.cwd,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let gotResult = false;

    // 中断:signal abort 时 kill 子进程(用户点「停止」/ 客户端断开连接)
    const onAbort = () => child.kill('SIGTERM');
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      const rl = createInterface({ input: child.stdout });
      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let ev: AgentEvent;
        try {
          ev = JSON.parse(trimmed) as AgentEvent;
        } catch {
          continue; // 非 JSON 行忽略(banner 等)
        }
        // control_request:bypassPermissions 下罕见(MCP 工具权限/AskUserQuestion 等),当前未实现
        // auto-approve,claude 会等 control_response——记录以便排查「转圈到 timeout」(CR3)
        if ((ev as { type?: string }).type === 'control_request') {
          logger.warn('收到 control_request,当前未实现 auto-approve,claude 可能挂到 timeout');
        }
        if (!shouldKeep(ev)) continue;
        yield ev;
        if (ev.type === 'result') {
          gotResult = true;
          // 主动关 stdin:让 claude 收到 EOF 自然退出,减少对 finally kill 的依赖
          child.stdin?.end();
          break;
        }
      }

      // spawn 失败(如 wsl.exe 不在 PATH)时 child 先发 'error'(上方 handler 已捕获并记 spawnState),
      // 再让 once('close') reject——这里 catch 住走 spawnError 友好提示;否则 reject 直抛只能由 chat route 兜底 generic error
      let exitCode: number | null = null;
      try {
        [exitCode] = (await once(child, 'close')) as [number | null];
      } catch (e) {
        // once reject 多因 spawn 失败(spawnState.error 已记录);非此情况落日志排查,禁止吞异常
        if (!spawnState.error) {
          logger.warn('once(close) reject 但无 spawn error', { error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (!gotResult) {
        // 把 spawn 错误 / stderr 末尾拼进 message:前端只读 ev.message,否则用户只看到 exit code,
        // 分不清是 claude 没装、WSL 没起还是别的(CR4)。spawnError 优先(二进制缺失的最直接信号)
        const spawnError = spawnState.error;
        const stderr = stderrTail.trim();
        const hint = command === 'wsl.exe' ? '(检查 WSL 是否安装 / claude 路径)' : '(检查 claude 是否安装)';
        const message = spawnError
          ? `claude 启动失败: ${spawnError.message} ${hint}`
          : stderr
            ? `claude exited (code=${exitCode ?? 'null'})\n${stderr.slice(-300)}`
            : `claude exited (code=${exitCode ?? 'null'})`;
        yield { type: 'error', message, stderr };
      }
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      // 先断 stdio 再 kill:WSL 下 kill wsl.exe 不保证连带杀 WSL 内 claude,先 destroy stdin
      // 让 claude 收到 EOF 自行退出,减少孤儿进程占用/继续写文件(CR2)
      try {
        child.stdin?.destroy();
        child.stdout?.destroy();
        child.stderr?.destroy();
      } catch {
        // 已关闭,忽略
      }
      if (!child.killed && child.exitCode === null && child.pid !== undefined) child.kill();
    }
  }
}
