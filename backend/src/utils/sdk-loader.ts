// backend/src/utils/sdk-loader.ts
// 封装 Claude Agent SDK 的 spawn 钩子:Windows 侧用 SDK 默认 spawn,WSL 侧拦截为 wsl.exe 转发。
//
// WSL 背景(与 AgentRunner.resolveWslClaudePath 同源):appendWindowsPath=false + claude 装在
// ~/.local/bin,非 login shell 的 PATH 找不到它,SDK 默认 spawn(走 PATH / built-in)在 WSL 侧失效。
// 故 WSL 侧用 SDK 的 spawnClaudeCodeProcess 钩子:spawn wsl.exe --cd <mnt> -- <claude 绝对路径> ...原 args,
// 把 SDK 算好的 claude flags 原样转给 WSL 内的全局 claude(2.1.220),绕过 SDK bundled / PATH 查找。
//
// 本文件只管 spawn 形态(双侧差异);clean settings 注入、resume 等由 #3 AgentRuntimeManager 在
// query options 里组合(见文档 §5 Phase 2)。ChildProcess 满足 SDK 的 SpawnedProcess 接口。
import { spawn } from 'node:child_process';
import type { SpawnOptions, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk';
import { toWslPath } from '../infrastructure/system/pathCodec.js';
import { resolveWslClaudePath } from '../application/agent/AgentRunner.js';
import { FileLogger } from '../infrastructure/logging/FileLogger.js';

const logger = new FileLogger('sdk-loader');

export type AgentSide = 'windows' | 'wsl';

export interface SdkSpawnOptions {
  /** SDK query options.cwd(Windows 形态;WSL 侧实际 cwd 由钩子内 --cd 决定) */
  cwd: string;
  /** WSL 侧的自定义 spawn 钩子;Windows 侧缺省 → SDK 默认 spawn */
  spawnClaudeCodeProcess?: (options: SpawnOptions) => SpawnedProcess;
}

/**
 * 构造 SDK query 的 spawn 相关 options。
 * - windows:返回 {cwd},不带 spawnClaudeCodeProcess → SDK 默认 spawn(PATH / built-in claude)
 * - wsl:返回 {cwd, spawnClaudeCodeProcess},钩子内 spawn wsl.exe 转发到 WSL 内 claude
 *
 * 惰性解析 WSL claude 路径(首次 WSL 调用,resolveWslClaudePath 内部缓存 in-flight Promise)。
 */
export async function buildSdkSpawnOptions(side: AgentSide, cwd: string): Promise<SdkSpawnOptions> {
  if (side === 'windows') return { cwd };

  const wslClaudePath = await resolveWslClaudePath();
  const wslCwd = toWslPath(cwd);
  return {
    cwd,
    spawnClaudeCodeProcess: (options: SpawnOptions): SpawnedProcess => {
      // options.command/args 是 SDK 默认 spawn claude 的命令(Windows 形态)。
      // WSL 侧丢弃 command,换成 wsl.exe;前置 --cd <mnt> + -- + WSL claude 绝对路径,
      // 保留 SDK 原 args(claude flags:--output-format / --include-partial-messages / --resume 等)。
      logger.info('WSL 侧 SDK spawn', { wslClaudePath, wslCwd, sdkArgs: options.args });
      const child = spawn('wsl.exe', ['--cd', wslCwd, '--', wslClaudePath, ...options.args], {
        cwd: options.cwd,
        env: options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      child.on('error', (err: Error) =>
        logger.error('WSL 侧 SDK spawn 失败', { error: err.message, wslClaudePath }),
      );
      return child as unknown as SpawnedProcess;
    },
  };
}
