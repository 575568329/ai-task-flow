// backend/src/domain/maimemo/MaimemoConfig.ts

/**
 * 墨墨背单词配置值对象。
 *
 * 存储内容：
 * - token：墨墨开放 API 密钥（明文落盘，等价于 LLM apiKey，禁止下发前端/日志）
 * - notepadId/notepadTitle：云词本同步目标（全量替换式同步，状态属整个词本而非单个词）
 * - lastNotepadSyncAt：上次云词本同步时间
 *
 * 注意：学习计划的逐词同步状态记录在 Vocab 实体上（studySyncStatus），
 * 不在此处——因为学习计划是逐词操作，云词本是快照操作，两者建模粒度不同。
 */
export interface MaimemoConfigData {
  token: string;
  notepadId?: string;
  notepadTitle?: string;
  lastNotepadSyncAt?: string; // ISO
}

/** 配置文件可能不存在，返回 null 表示「未配置」 */
export type PersistedMaimemoConfig = MaimemoConfigData | null;

/** token 脱敏：照抄 LlmConfigEntity.maskApiKey —— len≤8 返回 ****，否则前4 + *(min(len-8,8)) + 后4 */
export function maskToken(token: string): string {
  if (!token || token.length <= 8) {
    return token ? '****' : '';
  }
  const head = token.slice(0, 4);
  const tail = token.slice(-4);
  const middle = '*'.repeat(Math.min(token.length - 8, 8));
  return `${head}${middle}${tail}`;
}
