import type { ConclusionSource } from '@ai-task-flow/shared';

// 进程指纹：stdio MCP 每个会话一个进程，pid + 启动时间在一次会话内稳定。
const PROCESS_STARTED_AT = Math.floor(Date.now() - process.uptime() * 1000);

export interface McpClientInfo {
  name?: string;
  version?: string;
}

function toolFromEnv(): string | undefined {
  const raw = process.env.AI_AGENT?.trim();
  if (!raw) return undefined;
  return raw.split('_')[0] || undefined;
}

export function resolveMcpSource(
  client: McpClientInfo | undefined,
  conversationName?: string,
): ConclusionSource {
  const tool = toolFromEnv() ?? client?.name?.trim() ?? 'unknown';
  const conversationId = process.env.CLAUDE_CODE_SESSION_ID?.trim()
    || `${tool}:${process.pid}:${PROCESS_STARTED_AT}`;
  return {
    tool,
    conversationId,
    ...(conversationName ? { conversationName } : {}),
    cwd: process.cwd(),
    ...(client?.version ? { agentVersion: client.version } : {}),
  };
}

export function resolveManualSource(): ConclusionSource {
  return { tool: 'manual', cwd: process.cwd() };
}
