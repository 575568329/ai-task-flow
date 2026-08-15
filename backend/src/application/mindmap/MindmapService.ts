// backend/src/application/mindmap/MindmapService.ts
import type { MindmapRepository } from '../../domain/mindmap/repositories/MindmapRepository.js';
import { MindmapDoc } from '../../domain/mindmap/entities/MindmapDoc.js';
import { MINDMAP_LIMITS } from '@ai-task-flow/shared';
import type {
  MindmapCreateDTO,
  MindmapDocDTO,
  MindmapListResponse,
  MindmapMetaDTO,
  MindmapUpdateDTO,
} from '@ai-task-flow/shared';
import { FileLogger } from '../../infrastructure/logging/FileLogger.js';
import { DomainError } from '../../domain/_shared/DomainError.js';

const logger = new FileLogger('mindmap');

// ============ 类型化领域错误(P2-20: 继承 DomainError 带 httpStatus,setErrorHandler 自动映射) ============

/** 思维导图不存在 → 404 */
export class MindmapNotFoundError extends DomainError {
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`思维导图不存在：${id}`, 'MINDMAP_NOT_FOUND');
  }
}

/** 数据校验失败（标题/图结构/上限） → 400 */
export class MindmapValidationError extends DomainError {
  readonly httpStatus = 400;
  constructor(message: string) {
    super(message, 'MINDMAP_VALIDATION');
  }
}

/** 乐观锁冲突（版本不匹配，多 tab 编辑互相覆盖） → 409 */
export class MindmapConflictError extends DomainError {
  readonly httpStatus = 409;
  constructor(id: string) {
    super(`文档已被他处修改，请刷新后重试：${id}`, 'MINDMAP_CONFLICT');
  }
}

/** 文档数量上限超出 → 400 */
export class MindmapLimitExceededError extends DomainError {
  readonly httpStatus = 400;
  constructor(message: string) {
    super(message, 'MINDMAP_LIMIT_EXCEEDED');
  }
}

/**
 * 思维导图应用服务：CRUD + 复制 + 乐观锁 + 上限校验。
 *
 * 职责边界：
 * - 乐观锁比对在 Service 层（需先 findById 拿当前 version）；
 * - 图结构不变量在聚合根 updateGraph（抛 Error，Service 转 ValidationError）；
 * - 文档数量上限在 Service 层（需 count）。
 */
export class MindmapService {
  constructor(private readonly repository: MindmapRepository) {}

  /** 列表（仅 meta，按 updatedAt 倒序）。nodeCount 已冗余存储，无需解析 nodes。 */
  async listMindmaps(): Promise<MindmapListResponse> {
    const docs = await this.repository.findAll();
    const items: MindmapMetaDTO[] = docs
      .map(d => ({
        id: d.id,
        title: d.title,
        nodeCount: d.nodeCount,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      }))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return { items, total: items.length };
  }

  /** 新建（含默认根节点）。校验文档总数上限。 */
  async createMindmap(dto: MindmapCreateDTO): Promise<MindmapDocDTO> {
    const count = await this.repository.count();
    if (count >= MINDMAP_LIMITS.MAX_DOCS) {
      throw new MindmapLimitExceededError(`思维导图数量已达上限 ${MINDMAP_LIMITS.MAX_DOCS}`);
    }
    const doc = MindmapDoc.create(dto.title, dto.docMode ?? 'tree');
    await this.repository.save(doc);
    logger.info('createMindmap 成功', { id: doc.id, title: doc.title });
    return doc.toJSON();
  }

  /** 获取完整文档。 */
  async getMindmap(id: string): Promise<MindmapDocDTO> {
    const doc = await this.repository.findById(id);
    if (!doc) throw new MindmapNotFoundError(id);
    return doc.toJSON();
  }

  /**
   * 部分更新（PATCH）。
   * 乐观锁：expectedVersion 提供时必须与当前 version 一致，否则抛 ConflictError。
   * 图结构校验由聚合根守，失败转 ValidationError。
   */
  async updateMindmap(id: string, dto: MindmapUpdateDTO): Promise<MindmapDocDTO> {
    const doc = await this.repository.findById(id);
    if (!doc) throw new MindmapNotFoundError(id);
    if (dto.expectedVersion !== undefined && dto.expectedVersion !== doc.version) {
      logger.warn('updateMindmap 乐观锁冲突', { id, expected: dto.expectedVersion, actual: doc.version });
      throw new MindmapConflictError(id);
    }
    try {
      doc.applyUpdate(dto);
    } catch (error) {
      const message = error instanceof Error ? error.message : '图数据校验失败';
      throw new MindmapValidationError(message);
    }
    await this.repository.save(doc);
    return doc.toJSON();
  }

  /** 删除（硬删）。不存在抛 NotFoundError（语义清晰，非静默）。 */
  async deleteMindmap(id: string): Promise<void> {
    const doc = await this.repository.findById(id);
    if (!doc) throw new MindmapNotFoundError(id);
    await this.repository.delete(id);
    logger.info('deleteMindmap 成功', { id });
  }

  /**
   * 复制（新 id / 标题加" 副本" / version=0 / 时间重置）。
   * 深拷贝源图 nodes/edges，避免与源文档共享引用导致后续编辑串扰。
   */
  async duplicateMindmap(id: string): Promise<MindmapDocDTO> {
    const count = await this.repository.count();
    if (count >= MINDMAP_LIMITS.MAX_DOCS) {
      throw new MindmapLimitExceededError(`思维导图数量已达上限 ${MINDMAP_LIMITS.MAX_DOCS}`);
    }
    const source = await this.repository.findById(id);
    if (!source) throw new MindmapNotFoundError(id);
    const copy = MindmapDoc.create(`${source.title} 副本`, source.docMode);
    // 用源图内容整体替换（applyUpdate 会校验 + version++）。
    // structuredClone 深拷贝嵌套 data（style 等嵌套对象不与源共享引用）
    copy.applyUpdate({
      nodes: source.nodes.map(n => ({ ...n, data: structuredClone(n.data) })),
      edges: source.edges.map(e => ({ ...e, data: e.data ? structuredClone(e.data) : undefined })),
    });
    await this.repository.save(copy);
    logger.info('duplicateMindmap 成功', { from: id, to: copy.id });
    return copy.toJSON();
  }
}
