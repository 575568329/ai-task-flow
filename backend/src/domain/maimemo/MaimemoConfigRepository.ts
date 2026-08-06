// backend/src/domain/maimemo/MaimemoConfigRepository.ts
import type { PersistedMaimemoConfig } from './MaimemoConfig.js';

/**
 * 墨墨配置仓储接口（领域层定义契约，实现见 infrastructure/persistence）。
 * 仿 LlmConfigRepository。
 */
export interface MaimemoConfigRepository {
  /** 读取持久化配置，文件不存在返回 null（表示未配置） */
  load(): Promise<PersistedMaimemoConfig>;
  /** 保存配置（覆盖写） */
  save(config: PersistedMaimemoConfig): Promise<void>;
}
