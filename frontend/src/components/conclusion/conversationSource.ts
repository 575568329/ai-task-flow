import type { ConclusionSource } from '@ai-task-flow/shared';

/** 人工来源标记（与后端 resolveManualSource 一致） */
export const MANUAL_TOOL = 'manual';
/** UUID/普通 ID 的短显长度 */
const SHORT_UUID_LEN = 8;

export interface ConversationDisplay {
  label: string;
  shortId?: string;
}

/**
 * 进程指纹形如 `zcode:52568:1795001084373`：前 8 位截断会变成所有卡都一样的
 * `zcode:52…`，改用 `tool:pid` 才有区分度。UUID 等普通 ID 取前 8 位。
 */
export function shortConversationId(id: string): string {
  const value = id.trim();
  if (!value) return '';
  if (value.includes(':')) {
    const [tool, pid] = value.split(':');
    return pid ? `${tool}:${pid}` : value;
  }
  return value.length > SHORT_UUID_LEN ? `${value.slice(0, SHORT_UUID_LEN)}…` : value;
}

export function conversationDisplay(
  source: Pick<ConclusionSource, 'tool' | 'conversationId' | 'conversationName'>,
): ConversationDisplay {
  const id = source.conversationId?.trim();
  const name = source.conversationName?.trim();
  const label = name || (id || source.tool !== MANUAL_TOOL ? '未命名对话' : '手工创建');
  return { label, ...(id ? { shortId: shortConversationId(id) } : {}) };
}
