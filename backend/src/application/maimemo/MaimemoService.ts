// backend/src/application/maimemo/MaimemoService.ts
import type {
  MaimemoConfigDTO,
  SaveMaimemoConfigDTO,
  MaimemoTestResultDTO,
  StudySyncResultDTO,
  NotepadSyncResultDTO,
  StudyProgressDTO,
  MaimemoWordStudyRecord,
} from '@ai-task-flow/shared';
import type { MaimemoConfigRepository } from '../../domain/maimemo/MaimemoConfigRepository.js';
import type { MaimemoConfigData } from '../../domain/maimemo/MaimemoConfig.js';
import { maskToken } from '../../domain/maimemo/MaimemoConfig.js';
import { MaimemoClient, VOCAB_QUERY_BATCH, ADD_WORDS_BATCH, STUDY_RECORDS_BATCH, MaimemoApiError } from '../../infrastructure/maimemo/MaimemoClient.js';
import type { VocabRepository } from '../../domain/vocab/repositories/VocabRepository.js';
import type { Vocab } from '../../domain/vocab/entities/Vocab.js';
import { FileLogger } from '../../infrastructure/logging/FileLogger.js';

const logger = new FileLogger('maimemo');

const NOTEPAD_TITLE = 'ai-task-flow 生词本';
const NOTEPAD_BRIEF = '从有道翻译同步的生词';
/** 测试连接节流：10s 内只允许 1 次（防 token 爆破 + 节省配额） */
const TEST_THROTTLE_MS = 10_000;
/** 进度缓存有效期 */
const PROGRESS_CACHE_MS = 5 * 60_000;
/** 已掌握判定阈值：墨墨 SRS 下次复习距今天数 ≥ 此值视为掌握稳固（间隔越长=掌握越好） */
const MASTERED_INTERVAL_DAYS = 21;

/** 墨墨未配置 token */
export class MaimemoNotConfiguredError extends Error {
  constructor() {
    super('尚未配置墨墨 token，请先在「设置 → 墨墨同步」中填写');
    this.name = 'MaimemoNotConfiguredError';
  }
}

/**
 * 墨墨同步应用服务：配置管理（脱敏）+ 双通道同步（云词本/学习计划）+ 学习进度查询。
 *
 * 依赖注入顺序有环（Client 的 getToken 闭包引用 Service），故 Client 经 useClient() 后置注入。
 */
export class MaimemoService {
  private configData: MaimemoConfigData | null = null;
  private client: MaimemoClient | null = null;
  private lastTestAt = 0;
  private lastTestResult: MaimemoTestResultDTO | null = null;
  private progressCache: { at: number; data: StudyProgressDTO } | null = null;

  constructor(
    private readonly configRepo: MaimemoConfigRepository,
    private readonly vocabRepo: VocabRepository,
  ) {}

  /** 后置注入 HTTP 客户端（其 getToken 闭包引用本 service） */
  useClient(client: MaimemoClient): void {
    this.client = client;
  }

  /** 启动：加载配置 + 把上次中断残留的 syncing 词重置为 pending（可重试） */
  async init(): Promise<void> {
    this.configData = await this.configRepo.load();
    try {
      const syncing = await this.vocabRepo.findByStudySyncStatus('syncing');
      if (syncing.length > 0) {
        syncing.forEach(v => v.resetStudyPending());
        await this.vocabRepo.saveMany(syncing);
        logger.warn('init 重置残留 syncing 词', { count: syncing.length });
      }
    } catch (error) {
      logger.error('init 重置 syncing 失败', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  // —— 配置管理 ——

  /** 后端内部取明文 token（供 Client 闭包用） */
  getActiveToken(): string {
    return this.configData?.token ?? '';
  }

  isConfigured(): boolean {
    return !!this.getActiveToken().trim();
  }

  /** 脱敏配置下发前端（永不回明文） */
  getMaskedConfig(): MaimemoConfigDTO {
    const token = this.getActiveToken();
    return {
      tokenSet: !!token.trim(),
      tokenMasked: token ? maskToken(token) : '',
      notepadId: this.configData?.notepadId,
      notepadTitle: this.configData?.notepadTitle,
      lastNotepadSyncAt: this.configData?.lastNotepadSyncAt,
    };
  }

  /** 保存配置：空 token = 保持原值（与 LlmConfigService 一致） */
  async saveConfig(dto: SaveMaimemoConfigDTO): Promise<MaimemoConfigDTO> {
    const patch: Partial<MaimemoConfigData> = {};
    if (dto.token && dto.token.trim()) patch.token = dto.token.trim();
    await this.updateConfig(patch);
    return this.getMaskedConfig();
  }

  /** 测试连接：调最小只读接口 listNotepads(1)，10s 节流，固定文案不回吐上游原文 */
  async testConnection(): Promise<MaimemoTestResultDTO> {
    const now = Date.now();
    if (now - this.lastTestAt < TEST_THROTTLE_MS && this.lastTestResult) {
      return this.lastTestResult;
    }
    this.lastTestAt = now;
    if (!this.isConfigured() || !this.client) {
      this.lastTestResult = { ok: false, message: '尚未配置 token' };
      return this.lastTestResult;
    }
    try {
      await this.client.listNotepads(1, 0);
      this.lastTestResult = { ok: true, message: '连接正常' };
    } catch (error) {
      const status = error instanceof MaimemoApiError ? error.status : 0;
      // 401/403 → token 无效；其余 → 网络错误
      this.lastTestResult = {
        ok: false,
        message: status === 401 || status === 403 ? 'token 无效或过期' : '网络错误',
      };
      logger.warn('testConnection 失败', { status, error: error instanceof Error ? error.message : String(error) });
    }
    return this.lastTestResult;
  }

  // —— 同步：云词本 ——

  /** 全量替换云词本内容（content = 全部词逐行）。无 notepadId 则创建。 */
  async syncToNotepad(): Promise<NotepadSyncResultDTO> {
    this.assertConfigured();
    const all = await this.vocabRepo.findAll();
    const content = all.map(v => v.word).filter(Boolean).join('\n');
    let notepadId = this.configData?.notepadId;
    const title = this.configData?.notepadTitle ?? NOTEPAD_TITLE;
    let created = false;

    if (notepadId) {
      try {
        await this.client!.updateNotepad(notepadId, { title, content });
      } catch (error) {
        // 云词本在墨墨侧被删 → 清掉 id 重建
        if (error instanceof MaimemoApiError && error.status === 404) {
          logger.warn('云词本已被删除，重建', { notepadId });
          notepadId = undefined;
        } else {
          throw error;
        }
      }
    }
    if (!notepadId) {
      const np = await this.client!.createNotepad({ title, content, brief: NOTEPAD_BRIEF, tags: ['生词'] });
      notepadId = np.id;
      created = true;
    }
    await this.updateConfig({ notepadId, notepadTitle: title, lastNotepadSyncAt: new Date().toISOString() });
    logger.info('syncToNotepad 完成', { count: all.length, notepadId, created });
    return { count: all.length, notepadId, created };
  }

  // —— 同步：学习计划 ——

  /**
   * 把 pending 词加入墨墨学习计划：批量查 vocId → 批量 add_words → 逐批回写状态。
   * 单批失败不影响其他批（标记 failed 后继续）；不回滚已成功批。
   */
  async syncToStudyPlan(): Promise<StudySyncResultDTO> {
    this.assertConfigured();
    // pending + failed 一起处理：failed 词（含上次因字段解析 bug 被误判「未收录」的）允许重试
    const targets = await this.vocabRepo.findByStudySyncStatuses(['pending', 'failed']);
    if (targets.length === 0) {
      return { synced: 0, failed: 0, notFound: 0, errors: [] };
    }
    // 1) 全部标记 syncing（同时清掉 failed 词的旧错误信息）
    targets.forEach(v => v.markStudySyncing());
    await this.vocabRepo.saveMany(targets);

    const errors: StudySyncResultDTO['errors'] = [];
    let synced = 0;
    let failed = 0;
    let notFound = 0;

    // 2) 批量查 vocId（按小写 word 匹配）
    const vocIdByWord = new Map<string, string>(); // lowercase word → vocId
    const byLowerWord = new Map<string, Vocab>();
    targets.forEach(v => byLowerWord.set(v.word.trim().toLowerCase(), v));
    const spellings = [...byLowerWord.keys()];
    for (let i = 0; i < spellings.length; i += VOCAB_QUERY_BATCH) {
      const chunk = spellings.slice(i, i + VOCAB_QUERY_BATCH);
      try {
        const { vocIdBySpelling } = await this.client!.queryVocabularyBatch(chunk);
        vocIdBySpelling.forEach((id, sp) => vocIdByWord.set(sp, id));
      } catch (error) {
        // 查询批失败：整批标记 failed
        const reason = error instanceof Error ? error.message : '查询墨墨单词失败';
        chunk.forEach(lw => {
          const vocab = byLowerWord.get(lw);
          if (vocab) { vocab.markStudyFailed(reason); failed += 1; errors.push({ word: vocab.word, reason }); }
        });
      }
    }

    // 3) 拆分：未收录的直接 failed；已查到的进入 add 队列
    const toAdd: Array<{ vocab: Vocab; vocId: string }> = [];
    const notFoundVocabs: Vocab[] = [];
    for (const [lw, vocab] of byLowerWord) {
      if (vocab.studySyncStatus === 'failed') continue; // 查询批已标记失败
      const vocId = vocIdByWord.get(lw);
      if (!vocId) {
        vocab.markStudyFailed('墨墨词库未收录');
        notFound += 1;
        failed += 1;
        errors.push({ word: vocab.word, reason: '墨墨词库未收录' });
        notFoundVocabs.push(vocab);
      } else {
        toAdd.push({ vocab, vocId });
      }
    }
    if (notFoundVocabs.length > 0) await this.vocabRepo.saveMany(notFoundVocabs);

    // 4) 批量 add_words（每批成功/失败分别回写）
    for (let i = 0; i < toAdd.length; i += ADD_WORDS_BATCH) {
      const batch = toAdd.slice(i, i + ADD_WORDS_BATCH);
      try {
        await this.client!.addWordsBatch(batch.map(b => b.vocId));
        batch.forEach(b => { b.vocab.markStudySynced(b.vocId); synced += 1; });
      } catch (error) {
        const reason = error instanceof Error ? error.message : '加入学习计划失败';
        batch.forEach(b => { b.vocab.markStudyFailed(reason); failed += 1; errors.push({ word: b.vocab.word, reason }); });
      }
      await this.vocabRepo.saveMany(batch.map(b => b.vocab));
    }

    logger.info('syncToStudyPlan 完成', { synced, failed, notFound, total: targets.length });
    return { synced, failed, notFound, errors };
  }

  // —— 进度查询 ——

  /**
   * 学习进度：账号级总体（getStudyProgress，含其他词库）+ 本地口径聚合（query_study_records）。
   * 5 分钟缓存。mastered 判定据 next_review 间隔（SRS：间隔 ≥21 天=掌握稳固），字段已实测确认。
   */
  async getStudyProgress(force = false): Promise<StudyProgressDTO> {
    this.assertConfigured();
    const now = Date.now();
    if (!force && this.progressCache && now - this.progressCache.at < PROGRESS_CACHE_MS) {
      return this.progressCache.data;
    }

    // 账号级
    let accountLevel = { finished: 0, total: 0, studyTime: 0 };
    try {
      accountLevel = await this.client!.getStudyProgress();
    } catch (error) {
      logger.warn('getStudyProgress 账号级失败', { error: error instanceof Error ? error.message : String(error) });
    }

    // 本地口径：已加入学习计划的词
    const synced = await this.vocabRepo.findByStudySyncStatus('synced');
    const lowerToWord = new Map(synced.map(v => [v.word.trim().toLowerCase(), v.word]));
    const spellings = synced.map(v => v.word);
    const records: MaimemoWordStudyRecord[] = [];
    for (let i = 0; i < spellings.length; i += STUDY_RECORDS_BATCH) {
      try {
        records.push(...await this.client!.queryStudyRecordsBatch(spellings.slice(i, i + STUDY_RECORDS_BATCH)));
      } catch (error) {
        logger.warn('queryStudyRecords 批失败', { error: error instanceof Error ? error.message : String(error) });
      }
    }

    // 聚合：以本地 synced 词为口径，逐词匹配墨墨记录
    // 墨墨不返回 familiarity，掌握度据 next_review 间隔推断（间隔越长=掌握越稳固）
    const recordByLower = new Map(records.map(r => [r.spelling.trim().toLowerCase(), r]));
    let mastered = 0;
    let learning = 0;
    for (const v of synced) {
      const r = recordByLower.get(v.word.trim().toLowerCase());
      if (!r) continue; // 无记录 → 计入未开始
      if (isMastered(r, now)) mastered += 1; else learning += 1;
    }
    const notStarted = synced.length - mastered - learning;

    const data: StudyProgressDTO = {
      accountLevel,
      local: { added: synced.length, mastered, learning, notStarted },
      perWord: records.filter(r => lowerToWord.has(r.spelling.trim().toLowerCase())),
    };
    this.progressCache = { at: now, data };
    return data;
  }

  // —— 内部 ——

  private assertConfigured(): void {
    if (!this.isConfigured() || !this.client) throw new MaimemoNotConfiguredError();
  }

  private async updateConfig(patch: Partial<MaimemoConfigData>): Promise<void> {
    this.configData = { ...(this.configData ?? { token: '' }), ...patch };
    await this.configRepo.save(this.configData);
    // 配置变更（如换 token）后进度缓存可能失真，清掉
    this.progressCache = null;
  }
}

/** 已掌握判定：墨墨 SRS 算法下，下次复习间隔越长 = 掌握越稳固。
 *  next_review 距今 ≥ MASTERED_INTERVAL_DAYS 视为已掌握（阈值可调）。无 next_review → 未掌握。 */
function isMastered(r: MaimemoWordStudyRecord, now: number): boolean {
  if (!r.nextReviewAt) return false;
  const daysUntilNext = Math.floor((Date.parse(r.nextReviewAt) - now) / 86_400_000);
  return daysUntilNext >= MASTERED_INTERVAL_DAYS;
}
