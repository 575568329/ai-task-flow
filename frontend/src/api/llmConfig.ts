// frontend/src/api/llmConfig.ts
import { http } from './http';

export interface MaskedLlmConfig {
  baseURL: string;
  apiKeyMasked: string;
  apiKeySet: boolean;
  model: string;
}

export interface SaveLlmConfigParams {
  baseURL: string;
  apiKey: string;
  model: string;
}

export const llmConfigApi = {
  /** 获取当前配置（apiKey 脱敏） */
  get: () => http.get<MaskedLlmConfig>('/llm-config'),
  /** 保存配置 */
  save: (params: SaveLlmConfigParams) => http.put<MaskedLlmConfig>('/llm-config', params),
};
