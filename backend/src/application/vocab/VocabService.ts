// backend/src/application/vocab/VocabService.ts
import type { VocabRepository } from '../../domain/vocab/repositories/VocabRepository.js';
import { Vocab } from '../../domain/vocab/entities/Vocab.js';
import type { LlmConfigService } from '../llm-config/LlmConfigService.js';
import type { LlmMessage, StreamChunk } from '../../infrastructure/llm/LlmProvider.js';
import type {
  VocabCreateDTO,
  VocabDTO,
  VocabListQuery,
  VocabListResponse,
  VocabUpdateDTO,
  TranslateResponse,
} from '@ai-task-flow/shared';
import { FileLogger } from '../../infrastructure/logging/FileLogger.js';

const logger = new FileLogger('vocab');

/**
 * translate 的 JSON schema(generateObject 当前未做 zod 强校验,保留以备后续;
 * 同时文档化结构契约)。sourceLang/translation 必填,其余可选。
 */
const TRANSLATE_SCHEMA = {
  type: 'object',
  properties: {
    sourceLang: { type: 'string' },
    translation: { type: 'string' },
    pos: { type: 'string' },
    definition: { type: 'string' },
    example: { type: 'string' },
  },
  required: ['sourceLang', 'translation'],
} as const;

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

  /**
   * 划词翻译：优先 LLM JSON mode（结构化），失败降级流式 + 宽松解析。
   * @param text 待翻译文本
   * @param targetLang 目标语言代码，默认 zh（MVP 固定中文）
   */
  async translate(text: string, targetLang = 'zh'): Promise<TranslateResponse> {
    if (!this.llmConfigService.isConfigured()) {
      throw new Error('尚未配置 API Key,请先在「设置」中填写大模型 API Key');
    }
    const llm = this.llmConfigService.getProvider();
    const messages: LlmMessage[] = [
      { role: 'system', content: this.buildTranslatePrompt(targetLang) },
      { role: 'user', content: text },
    ];

    try {
      const result = await llm.generateObject<TranslateResponse>(messages, TRANSLATE_SCHEMA);
      return this.normalizeTranslateResult(result);
    } catch (error) {
      // JSON mode 失败（模型不支持 / 上游错误）→ 流式 + 宽松解析降级
      logger.warn('translate JSON 模式失败,降级流式解析', {
        error: error instanceof Error ? error.message : String(error),
        textLen: text.length,
      });
      const raw = await this.collectStream(llm.streamText(messages));
      return this.normalizeTranslateResult(this.parseLooseJson(raw));
    }
  }

  /** 构造翻译 system prompt：强制严格 JSON 输出 */
  private buildTranslatePrompt(targetLang: string): string {
    return `你是专业翻译引擎。把用户输入翻译为${targetLang},并识别源语言、词性、释义、例句。

严格输出 JSON(不要任何额外文字、不要 markdown 代码块):
{
  "sourceLang": "源语言代码,如 en/zh/ja/de",
  "translation": "译文",
  "pos": "词性,如 n./v./int.(单词短语时给,句子可省)",
  "definition": "原文释义(源语言解释,可选)",
  "example": "例句(可选)"
}

规则:
- translation 必填,准确自然、符合目标语言表达习惯
- 单词/短语尽量给出 pos/definition/example
- 完整句子只给 translation,pos/example 省略
- 源语言与目标语言相同(如中译中)时,做润色/纠错`.trim();
  }

  /** 规范化翻译结果：保证必填字段类型正确，可选字段空值省略 */
  private normalizeTranslateResult(r: Partial<TranslateResponse> | null | undefined): TranslateResponse {
    const obj = r ?? {};
    const optional = (v: unknown): string | undefined =>
      typeof v === 'string' && v.trim() ? v : undefined;
    return {
      sourceLang: typeof obj.sourceLang === 'string' ? obj.sourceLang : '',
      translation: typeof obj.translation === 'string' ? obj.translation : '',
      pos: optional(obj.pos),
      definition: optional(obj.definition),
      example: optional(obj.example),
    };
  }

  /** 拼接流式输出的所有 delta */
  private async collectStream(iter: AsyncIterable<StreamChunk>): Promise<string> {
    let result = '';
    for await (const chunk of iter) {
      if (chunk.done) break;
      if (chunk.delta) result += chunk.delta;
    }
    return result;
  }

  /**
   * 宽松 JSON 解析（降级路径用）：
   * 1. 剥 ```json ... ``` 代码块围栏
   * 2. 抽取首个 {...} 子串
   * 3. JSON.parse；彻底失败时把整段原文兜底为译文
   */
  private parseLooseJson(raw: string): Partial<TranslateResponse> {
    const trimmed = raw.trim();
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fence ? fence[1].trim() : trimmed;
    const jsonMatch = candidate.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : candidate;
    try {
      return JSON.parse(jsonStr) as Partial<TranslateResponse>;
    } catch {
      logger.warn('parseLooseJson 彻底失败,原文兜底为译文', { rawHead: raw.slice(0, 100) });
      return { translation: raw };
    }
  }
}
