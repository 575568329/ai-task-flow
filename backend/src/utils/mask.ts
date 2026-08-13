// backend/src/utils/mask.ts
// 密钥脱敏统一实现(P2-19 DRY)。原 maskApiKey(domain/llm-config/LlmConfigEntity) 与
// maskToken(domain/claude-profile/settingsCodec) 逐字重复同一算法,合一到此处。
//
// 注意:FileLogger.maskSecret 是**日志专用变体**(tail 2 位 + 固定 3 星,更激进),
// 用途不同(日志打印 vs 前端展示辨认),不合并。
/**
 * API Key / Token 脱敏:保留前 4 后 4 位(便于用户辨认是哪把 key),中间用星号替代。
 * 长度 <= 8 位时整体 ****(无法辨认也露不了全文)。
 */
export function maskApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length <= 8) {
    return apiKey ? '****' : '';
  }
  const head = apiKey.slice(0, 4);
  const tail = apiKey.slice(-4);
  const middle = '*'.repeat(Math.min(apiKey.length - 8, 8));
  return `${head}${middle}${tail}`;
}
