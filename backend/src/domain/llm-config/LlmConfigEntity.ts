// backend/src/domain/llm-config/LlmConfigEntity.ts

/**
 * LLM 配置值对象
 * 存储 API 地址、API Key、模型名
 */
export interface LlmConfigData {
  baseURL: string;
  apiKey: string;
  model: string;
}

/** 配置文件可能不存在，此时返回 null 表示"使用环境变量/默认值" */
export type PersistedLlmConfig = LlmConfigData | null;

/**
 * 脱敏后的配置（返回给前端展示）
 * apiKey 只保留前4位和后4位
 */
export interface MaskedLlmConfig {
  baseURL: string;
  apiKeyMasked: string;
  apiKeySet: boolean;
  model: string;
}

/** API Key 脱敏：保留前4后4位，中间用星号替代 */
export function maskApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length <= 8) {
    return apiKey ? '****' : '';
  }
  const head = apiKey.slice(0, 4);
  const tail = apiKey.slice(-4);
  const middle = '*'.repeat(Math.min(apiKey.length - 8, 8));
  return `${head}${middle}${tail}`;
}
