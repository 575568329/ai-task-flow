// shared/src/types/vocab.ts
// 翻译生词本模块前后端共享类型（扩展 / 后端 / 前端 三方共用）

/**
 * 墨墨「学习计划」通道的逐词同步状态。
 * 注意：云词本（notepad）是全量替换的快照操作，状态属整个词本（见 MaimemoConfigDTO），
 * 不在单个词上记录。
 */
export type StudySyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';

/** 单条生词 */
export interface VocabDTO {
  id: string;
  word: string;            // 原文（选中文本）
  sourceLang?: string;     // 检测到的源语言（en/ja/...）
  targetLang: string;      // 目标语言，默认 zh
  translation: string;     // 译文
  pos?: string;            // 词性（n./v./phrase）
  definition?: string;     // 释义/解释
  example?: string;        // 例句
  sourceUrl?: string;      // 来自哪个网页
  context?: string;        // 选中上下文（前后文片段）
  starred: boolean;        // 收藏
  mastered: boolean;       // 已掌握
  reviewCount: number;     // 复习次数（P5）
  lastReviewedAt?: string; // 上次复习时间（P5，ISO）
  // —— 墨墨「学习计划」通道逐词状态（前端只读展示，禁止通过 VocabUpdateDTO 写入）——
  maimemoVocId?: string;          // 墨墨单词 ID（查 vocabulary 拿到，add_words/查进度复用）
  studySyncStatus?: StudySyncStatus; // 缺省视为 'pending'（旧数据迁移）
  studySyncError?: string;        // 失败原因
  studySyncedAt?: string;         // 加入学习计划成功时间（ISO）
  createdAt: string;       // ISO
  updatedAt: string;       // ISO
}

/** 创建生词入参 */
export interface VocabCreateDTO {
  word: string;
  translation: string;
  targetLang?: string;
  sourceLang?: string;
  pos?: string;
  definition?: string;
  example?: string;
  sourceUrl?: string;
  context?: string;
}

/**
 * 更新生词入参（标记掌握/收藏）。
 * 注意：墨墨同步状态由后端独占写入，**禁止**在此暴露 studySyncStatus 等字段，
 * 否则前端/扩展可绕过同步流程直接伪造状态。
 */
export interface VocabUpdateDTO {
  starred?: boolean;
  mastered?: boolean;
}

/** 翻译请求 */
export interface TranslateRequest {
  text: string;
  targetLang?: string;
}

/** 翻译响应（LLM 结构化返回） */
export interface TranslateResponse {
  sourceLang: string;
  translation: string;
  pos?: string;
  definition?: string;
  example?: string;
}

/** 生词列表查询参数 */
export interface VocabListQuery {
  kw?: string;
  sourceLang?: string;
  mastered?: boolean;
  starred?: boolean;
  studySyncStatus?: StudySyncStatus; // 按墨墨学习计划同步状态筛选
  page?: number;
  pageSize?: number;
}

/** 生词列表响应 */
export interface VocabListResponse {
  items: VocabDTO[];
  total: number;
}

// ============ 墨墨背单词集成相关类型 ============

/** 墨墨配置（脱敏后下发给前端） */
export interface MaimemoConfigDTO {
  tokenSet: boolean;              // 是否已配置 token
  tokenMasked: string;            // 脱敏 token（前4+*+后4）
  notepadId?: string;             // 云词本 ID（同步目标）
  notepadTitle?: string;          // 云词本标题
  lastNotepadSyncAt?: string;     // 上次云词本同步时间（ISO）
}

/** 保存墨墨配置入参（token 为空字符串表示「保持原值」） */
export interface SaveMaimemoConfigDTO {
  token?: string;
}

/** 测试连接结果（固定文案，不回吐上游 401 原文） */
export interface MaimemoTestResultDTO {
  ok: boolean;
  message: '连接正常' | 'token 无效或过期' | '网络错误' | '尚未配置 token';
}

/** 有道 .bin 导入结果 */
export interface YoudaoImportResultDTO {
  parsed: number;                 // 解析出的词条总数
  added: number;                  // 新增（去重后实际写入）
  duplicates: number;             // 与已有重复被跳过
  skipped: number;                // 解析失败/无效被跳过
  skipReasons: string[];          // 跳过原因汇总
}

/** 加入学习计划同步结果 */
export interface StudySyncResultDTO {
  synced: number;                 // 成功加入
  failed: number;                 // 失败（含未收录）
  notFound: number;               // 墨墨词库未收录（failed 的子集）
  errors: Array<{ word: string; reason: string }>;
}

/** 同步云词本结果 */
export interface NotepadSyncResultDTO {
  count: number;                  // 写入词数
  notepadId: string;              // 云词本 ID
  created: boolean;               // 是否为本次新建
}

/** 单词学习记录（墨墨 query_study_records 返回，逐项；字段据 2026-08-05 实测） */
export interface MaimemoWordStudyRecord {
  spelling: string;               // voc_spelling
  status?: string;                // last_response 枚举（如 STUDY_RESPONSE_UNSPECIFIED），原始值不友好，前端不直接展示
  reviewCount?: number;           // study_count 累计复习次数
  lastReviewAt?: string;          // last_study_date（ISO）
  nextReviewAt?: string;          // next_study_date（ISO），间隔长度=掌握稳固度
}

/** 学习进度聚合（本地口径为主 + 账号级总览） */
export interface StudyProgressDTO {
  /** 账号级总体（含用户其他词库，展示时须标注） */
  accountLevel: {
    finished: number;
    total: number;
    studyTime: number;
  };
  /** 本应用单词本地口径聚合（仅统计已加入学习计划的词） */
  local: {
    added: number;                // 已加入学习计划总数
    mastered: number;             // 已掌握
    learning: number;             // 学习中
    notStarted: number;           // 已加入但墨墨尚无记录
  };
  /** 逐词学习记录（来自 query_study_records） */
  perWord: MaimemoWordStudyRecord[];
}
