// backend/src/application/agent/AgentRunner.ts
// 任务对话 Agent:按轮 spawn Claude Code CLI(headless stream-json),逐事件透传。
// - 隔离用户级 superpowers hook(--settings clean.json,spike 实证 input 35k→2.5k)
// - prompt 经 stdin stream-json 写入(不经命令行/shell,无转义风险,仿 multica buildClaudeInput)
// - 支持 Windows / WSL 两侧 claude(side 切换):
//     · Windows:直接 spawn claude(shell:true 兼容 .cmd shim)
//     · WSL:spawn wsl.exe --cd <mnt> -- claude <args>(claude 在 WSL PATH,直接传 argv)
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

const DEFAULT_MAX_TURNS = 50;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const STDERR_TAIL_MAX = 4096;

/**
 * 按 side 构造 spawn 参数。两侧 prompt 都走 stdin pipe(见文件头注释)。
 * - windows:直接 spawn claude,cwd=Windows 路径,settings 用 Windows 路径
 * - wsl:spawn wsl.exe,claude 在 WSL PATH 里直接作为 argv 传(每参数无空格,
 *   避开 wsl.exe `--` 后参数拼接破坏 `-c` 引号的坑,故无需 bash 脚本包装);
 *   cwd/settings 都用 toWslPath 翻译成 /mnt 形态
 */
function buildSpawn(opts: AgentRunOptions, settingsPath: string): {
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
    '--permission-mode', 'bypassPermissions',
    '--max-turns', maxTurns,
  ];
  if (opts.resumeSessionId) baseArgs.push('--resume', opts.resumeSessionId);

  if (opts.side === 'wsl') {
    return {
      command: 'wsl.exe',
      // --cd 在 -- 前;claude 及其参数在 -- 后,逐个作为 argv 传给 WSL 内 claude
      args: ['--cd', toWslPath(opts.cwd), '--', 'claude', ...baseArgs, '--settings', toWslPath(settingsPath)],
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
    const { command, args, spawnOpts } = buildSpawn(opts, settingsPath);
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

      const [exitCode] = (await once(child, 'close')) as [number | null];
      if (!gotResult) {
        // 把 stderr 末尾拼进 message:前端只读 ev.message,否则用户只看到 exit code,
        // 分不清是 claude 没装、WSL 没起还是别的(CR4)
        const stderr = stderrTail.trim();
        yield {
          type: 'error',
          message: stderr
            ? `claude exited (code=${exitCode ?? 'null'})\n${stderr.slice(-300)}`
            : `claude exited (code=${exitCode ?? 'null'})`,
          stderr,
        };
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
