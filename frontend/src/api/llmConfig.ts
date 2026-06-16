// frontend/src/api/llmConfig.ts
import { http } from './http';
import type { TestConnectionResult } from '@ai-task-flow/shared';

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
  /** 测试连接(不保存,验证 端点+key+model 可用性) */
  test: (params: SaveLlmConfigParams) =>
    http.post<TestConnectionResult>('/llm-config/test', params),
};
