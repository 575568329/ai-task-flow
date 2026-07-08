// backend/src/application/vocab/VocabService.ts
import type { VocabRepository } from '../../domain/vocab/repositories/VocabRepository.js';
import { Vocab } from '../../domain/vocab/entities/Vocab.js';
import type { LlmConfigService } from '../llm-config/LlmConfigService.js';
import type {
  VocabCreateDTO,
  VocabDTO,
  VocabListQuery,
  VocabListResponse,
  VocabUpdateDTO,
} from '@ai-task-flow/shared';
import { FileLogger } from '../../infrastructure/logging/FileLogger.js';

const logger = new FileLogger('vocab');

/** 生词已存在（word + targetLang 唯一） */
export class VocabAlreadyExistsError extends Error {
  constructor(word: string, targetLang: string) {
    super(`该词已在生词本：${word} (${targetLang})`);
    this.name = 'VocabAlreadyExistsError';
  }
}

/** 生词不存在 */
export class VocabNotFoundError extends Error {
  constructor(id: string) {
    super(`生词不存在：${id}`);
    this.name = 'VocabNotFoundError';
  }
}

/**
 * 生词本应用服务：CRUD + 去重。
 * translate（调 LLM）见 P1，届时使用注入的 llmConfigService。
 */
export class VocabService {
  constructor(
    private readonly repository: VocabRepository,
    // P1 translate 用；P0 CRUD 不需要，提前注入避免后续改组装点
    private readonly llmConfigService: LlmConfigService,
  ) {}

  /** 新增生词。去重：word + targetLang 唯一，重复抛 VocabAlreadyExistsError */
  async saveVocab(dto: VocabCreateDTO): Promise<VocabDTO> {
    const targetLang = dto.targetLang ?? 'zh';
    const existing = await this.repository.findByWordAndLang(dto.word, targetLang);
    if (existing) {
      logger.warn('saveVocab 去重拦截', { word: dto.word, targetLang, existingId: existing.id });
      throw new VocabAlreadyExistsError(dto.word, targetLang);
    }
    const vocab = Vocab.create({ ...dto, targetLang });
    await this.repository.save(vocab);
    logger.info('saveVocab 成功', { id: vocab.id, word: vocab.word, targetLang });
    return vocab.toJSON();
  }

  /** 单条查询，不存在抛 VocabNotFoundError */
  async getVocab(id: string): Promise<VocabDTO> {
    const vocab = await this.repository.findById(id);
    if (!vocab) throw new VocabNotFoundError(id);
    return vocab.toJSON();
  }

  /** 列表：关键词（word/translation）+ sourceLang/mastered/starred 过滤 + 分页，按创建时间倒序 */
  async listVocab(query: VocabListQuery): Promise<VocabListResponse> {
    let items = await this.repository.findAll();

    if (query.kw?.trim()) {
      const kw = query.kw.trim().toLowerCase();
      items = items.filter(
        v => v.word.toLowerCase().includes(kw) || v.translation.toLowerCase().includes(kw),
      );
    }
    if (query.sourceLang) {
      items = items.filter(v => v.sourceLang === query.sourceLang);
    }
    if (typeof query.mastered === 'boolean') {
      items = items.filter(v => v.mastered === query.mastered);
    }
    if (typeof query.starred === 'boolean') {
      items = items.filter(v => v.starred === query.starred);
    }

    items = [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = items.length;
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.max(1, query.pageSize ?? 50);
    const start = (page - 1) * pageSize;
    const paged = items.slice(start, start + pageSize).map(v => v.toJSON());

    return { items: paged, total };
  }

  /** 更新收藏/掌握状态 */
  async updateVocab(id: string, dto: VocabUpdateDTO): Promise<VocabDTO> {
    const vocab = await this.repository.findById(id);
    if (!vocab) throw new VocabNotFoundError(id);

    if (typeof dto.starred === 'boolean' && dto.starred !== vocab.starred) {
      vocab.toggleStar();
    }
    if (typeof dto.mastered === 'boolean' && dto.mastered !== vocab.mastered) {
      vocab.updateMastered(dto.mastered);
    }

    await this.repository.save(vocab);
    return vocab.toJSON();
  }

  /** 删除，不存在抛 VocabNotFoundError（语义清晰，而非静默） */
  async deleteVocab(id: string): Promise<void> {
    const vocab = await this.repository.findById(id);
    if (!vocab) throw new VocabNotFoundError(id);
    await this.repository.delete(id);
    logger.info('deleteVocab 成功', { id });
  }
}
