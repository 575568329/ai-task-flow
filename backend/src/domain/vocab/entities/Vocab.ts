// backend/src/domain/vocab/entities/Vocab.ts
import type { VocabDTO, StudySyncStatus } from '@ai-task-flow/shared';

/** 翻译生词本聚合实体。唯一性键 = word + targetLang（去重判定）。 */
export class Vocab {
  constructor(
    public readonly id: string,
    public word: string,
    public sourceLang: string | undefined,
    public targetLang: string,
    public translation: string,
    public pos: string | undefined,
    public definition: string | undefined,
    public example: string | undefined,
    public sourceUrl: string | undefined,
    public context: string | undefined,
    public starred: boolean,
    public mastered: boolean,
    public reviewCount: number,
    public lastReviewedAt: Date | undefined,
    // —— 墨墨「学习计划」通道逐词状态（云词本状态属 MaimemoConfig，不在此）——
    public maimemoVocId: string | undefined,
    public studySyncStatus: StudySyncStatus,
    public studySyncError: string | undefined,
    public studySyncedAt: Date | undefined,
    public readonly createdAt: Date,
    public updatedAt: Date,
  ) {}

  static create(params: {
    word: string;
    translation: string;
    targetLang?: string;
    sourceLang?: string;
    pos?: string;
    definition?: string;
    example?: string;
    sourceUrl?: string;
    context?: string;
  }): Vocab {
    const now = new Date();
    return new Vocab(
      crypto.randomUUID(),
      params.word,
      params.sourceLang,
      params.targetLang ?? 'zh',
      params.translation,
      params.pos,
      params.definition,
      params.example,
      params.sourceUrl,
      params.context,
      false, // starred
      false, // mastered
      0,     // reviewCount
      undefined, // lastReviewedAt
      undefined, // maimemoVocId
      'pending', // studySyncStatus
      undefined, // studySyncError
      undefined, // studySyncedAt
      now,
      now,
    );
  }

  /** 翻转收藏 */
  toggleStar(): void {
    this.starred = !this.starred;
    this.updatedAt = new Date();
  }

  /**
   * 设置掌握状态。
   * 标记掌握(true)时累加复习次数 + 记录时间；取消掌握只翻转标记，不回退计数。
   */
  updateMastered(mastered: boolean): void {
    this.mastered = mastered;
    if (mastered) {
      this.reviewCount += 1;
      this.lastReviewedAt = new Date();
    }
    this.updatedAt = new Date();
  }

  /** 去重键：word（trim+小写）+ targetLang */
  uniqueKey(): string {
    return `${this.word.trim().toLowerCase()}|${this.targetLang}`;
  }

  // —— 墨墨「学习计划」同步状态机（仅后端调用，前端无写入路径）——

  /** 进入同步中（清空上次错误） */
  markStudySyncing(): void {
    this.studySyncStatus = 'syncing';
    this.studySyncError = undefined;
    this.updatedAt = new Date();
  }

  /** 同步成功，缓存墨墨单词 ID */
  markStudySynced(vocId: string): void {
    this.studySyncStatus = 'synced';
    this.maimemoVocId = vocId;
    this.studySyncError = undefined;
    this.studySyncedAt = new Date();
    this.updatedAt = new Date();
  }

  /** 同步失败，记录原因（保留已缓存的 vocId 以便下次复用） */
  markStudyFailed(error: string): void {
    this.studySyncStatus = 'failed';
    this.studySyncError = error;
    this.updatedAt = new Date();
  }

  /** 重置为待同步（启动时把残留 syncing 回收，防进程崩溃中断） */
  resetStudyPending(): void {
    this.studySyncStatus = 'pending';
    this.studySyncError = undefined;
    this.updatedAt = new Date();
  }

  toJSON(): VocabDTO {
    return {
      id: this.id,
      word: this.word,
      sourceLang: this.sourceLang,
      targetLang: this.targetLang,
      translation: this.translation,
      pos: this.pos,
      definition: this.definition,
      example: this.example,
      sourceUrl: this.sourceUrl,
      context: this.context,
      starred: this.starred,
      mastered: this.mastered,
      reviewCount: this.reviewCount,
      lastReviewedAt: this.lastReviewedAt?.toISOString(),
      maimemoVocId: this.maimemoVocId,
      studySyncStatus: this.studySyncStatus,
      studySyncError: this.studySyncError,
      studySyncedAt: this.studySyncedAt?.toISOString(),
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }

  static fromJSON(dto: VocabDTO): Vocab {
    return new Vocab(
      dto.id,
      dto.word,
      dto.sourceLang,
      dto.targetLang,
      dto.translation,
      dto.pos,
      dto.definition,
      dto.example,
      dto.sourceUrl,
      dto.context,
      dto.starred,
      dto.mastered,
      dto.reviewCount,
      dto.lastReviewedAt ? new Date(dto.lastReviewedAt) : undefined,
      dto.maimemoVocId,
      // 旧数据无 studySyncStatus 字段，统一视为待同步
      dto.studySyncStatus ?? 'pending',
      dto.studySyncError,
      dto.studySyncedAt ? new Date(dto.studySyncedAt) : undefined,
      new Date(dto.createdAt),
      new Date(dto.updatedAt),
    );
  }
}
