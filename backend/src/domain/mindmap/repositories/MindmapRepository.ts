// backend/src/domain/mindmap/repositories/MindmapRepository.ts
import type { MindmapDoc } from '../entities/MindmapDoc.js';

/**
 * 思维导图仓储接口（领域层只定义契约，实现见 infrastructure/persistence）。
 * 纯 TypeScript interface，只 import 类型，不引 fs/http。
 */
export interface MindmapRepository {
  save(doc: MindmapDoc): Promise<void>;
  findById(id: string): Promise<MindmapDoc | null>;
  /** 全量返回（列表投影 + 复制源读取）。单文件存储下为全量解析，nodeCount 已冗余无需深入 nodes。 */
  findAll(): Promise<MindmapDoc[]>;
  delete(id: string): Promise<void>;
  /** 文档总数（新建/复制时校验上限用） */
  count(): Promise<number>;
}
