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

// API Key 脱敏统一实现移至 utils/mask.ts(P2-19 DRY,与 settingsCodec.maskToken 合一)。
// re-export 保持现有 `from LlmConfigEntity` import 路径兼容。
export { maskApiKey } from '../../utils/mask.js';
