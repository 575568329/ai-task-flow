// backend/src/application/agent/routeMessage.ts
// SDK query 输出消息(SDKMessage)的路由纯函数:分流 result(turn 分界)与可透传事件,
// 过滤对话噪音(hook/thinking_tokens/text_delta 等)。与 AgentRunner.shouldKeep 同源——
// #5 路由层切到常驻 runtime 后 AgentRunner 逐步废弃,届时两处过滤统一到本文件。
import type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '@ai-task-flow/shared';

export type RoutedEvent =
  /** turn 结束(result):AgentRuntime 据此 resolve executeTurn、首 turn 取 session_id */
  | { kind: 'turnEnd'; result: SDKResultMessage }
  /** 可透传给上层 onEvent 的对话事件(归一化为 AgentEvent) */
  | { kind: 'stream'; event: AgentEvent }
  /** 过滤掉的噪音 */
  | { kind: 'ignore' };

/**
 * result 已在 routeMessage 顶层分流为 turnEnd,本函数只判其余消息是否透传。
 * 与 AgentRunner.shouldKeep 同款过滤:
 * - assistant / user → 透传(终态文本/工具调用)
 * - system && subtype==='init' → 透传(前端拿 session 元信息)
 * - stream_event → 仅 thinking_delta 透传(思考逐字增量);text_delta 等过滤控 SSE 流量
 */
function shouldStream(msg: SDKMessage): boolean {
  if (msg.type === 'assistant' || msg.type === 'user') return true;
  if (msg.type === 'system' && (msg as { subtype?: string }).subtype === 'init') return true;
  if (msg.type === 'stream_event') {
    const e = (msg as { event?: { type?: string; delta?: { type?: string } } }).event;
    return e?.type === 'content_block_delta' && e.delta?.type === 'thinking_delta';
  }
  return false;
}

/** 路由单条 SDKMessage:result → turnEnd,可透传 → stream,其余 → ignore。纯函数,便于单测 */
export function routeMessage(msg: SDKMessage): RoutedEvent {
  if (msg.type === 'result') return { kind: 'turnEnd', result: msg };
  return shouldStream(msg) ? { kind: 'stream', event: msg as unknown as AgentEvent } : { kind: 'ignore' };
}
