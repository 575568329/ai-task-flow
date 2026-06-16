// backend/src/domain/llm-config/LlmConfigRepository.ts
import type { PersistedLlmConfig } from './LlmConfigEntity.js';

/**
 * LLM 配置仓储接口
 * 遵循 DDD：领域层定义接口，基础设施层实现
 */
export interface LlmConfigRepository {
  /** 读取持久化配置，文件不存在返回 null */
  load(): Promise<PersistedLlmConfig>;
  /** 保存配置（覆盖写） */
  save(config: PersistedLlmConfig): Promise<void>;
}
