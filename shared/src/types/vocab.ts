// shared/src/types/vocab.ts
// 翻译生词本模块前后端共享类型（扩展 / 后端 / 前端 三方共用）

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

/** 更新生词入参（标记掌握/收藏） */
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
  page?: number;
  pageSize?: number;
}

/** 生词列表响应 */
export interface VocabListResponse {
  items: VocabDTO[];
  total: number;
}
