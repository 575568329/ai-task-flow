// backend/src/infrastructure/maimemo/MaimemoClient.ts
import type { MaimemoWordStudyRecord } from '@ai-task-flow/shared';

/** 墨墨开放 API 基址（实测验证；注意带 /open 前缀，非 api.maimemo.com） */
const MAIMEMO_BASE_URL = 'https://open.maimemo.com/open';

/** 批量查单词的每批上限（vocabulary/query），服务层按此分批 */
export const VOCAB_QUERY_BATCH = 50;
/** 加入学习计划的每批上限（study/add_words），服务层按此分批 */
export const ADD_WORDS_BATCH = 20;
/** 查学习记录的每批上限（study/query_study_records） */
export const STUDY_RECORDS_BATCH = 50;

/** 限速窗口配置：墨墨官方 10s/20、60s/40（5h/2000 足够宽松，暂不显式管控） */
const RATE_WINDOWS = [
  { sizeMs: 10_000, max: 18 },   // 留 2 余量，避免边缘抖动撞墙
  { sizeMs: 60_000, max: 36 },   // 同上留余量
];

/**
 * 滑动窗口限速器：在发出下一个请求前，确保 10s/60s 两窗口均未触顶；
 * 触顶则睡到最旧一条记录滑出窗口再重试。单进程内有效。
 */
export class SlidingWindowLimiter {
  private timestamps: number[] = [];
  private readonly maxWindowMs: number;

  constructor(windows: { sizeMs: number; max: number }[]) {
    this.maxWindowMs = Math.max(...windows.map(w => w.sizeMs));
  }

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      // 裁剪：只保留最大窗口内的记录
      this.timestamps = this.timestamps.filter(t => t > now - this.maxWindowMs);
      let waitMs = 0;
      for (const w of RATE_WINDOWS) {
        const inWindow = this.timestamps.filter(t => t > now - w.sizeMs);
        if (inWindow.length >= w.max) {
          // 该窗口已满，需等窗口内最旧一条滑出
          const oldest = Math.min(...inWindow);
          waitMs = Math.max(waitMs, oldest + w.sizeMs - now);
        }
      }
      if (waitMs <= 0) {
        this.timestamps.push(now);
        return;
      }
      await new Promise(r => setTimeout(r, waitMs + 10));
    }
  }
}

interface NotepadData {
  id: string;
  title?: string;
  content?: string;
  brief?: string;
  tags?: string[];
  status?: string;
}

/**
 * 墨墨 API 客户端。原生 fetch，token 经 getToken 闭包注入（仿 GlmWebSearchClient），
 * 支持热更新（改 token 无需重建实例）。内置滑动窗口限速。
 *
 * 方法均为「单批」语义（caller 按常量分批），以便服务层做逐批状态回写与错误归因。
 */
export class MaimemoClient {
  private readonly limiter = new SlidingWindowLimiter(RATE_WINDOWS);

  constructor(private readonly getToken: () => string) {}

  /** 当前是否已配置 token */
  isConfigured(): boolean {
    return !!this.getToken().trim();
  }

  /** 底层请求：限速 → 注入 Bearer → 解析 JSON；非 2xx 抛带状态码与响应体的错误 */
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    await this.limiter.acquire();
    const token = this.getToken().trim();
    if (!token) throw new MaimemoApiError(401, '尚未配置墨墨 token');
    const res = await fetch(`${MAIMEMO_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new MaimemoApiError(res.status, `墨墨 API ${res.status}: ${body.slice(0, 200)}`);
    }
    // 204/空响应兜底
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  // —— 云词本 notepads ——

  /** 列出云词本（分页） */
  async listNotepads(limit = 10, offset = 0): Promise<NotepadData[]> {
    const data = await this.request<{ data?: { notepads?: NotepadData[] }; notepads?: NotepadData[] }>(
      `/api/v1/notepads?limit=${limit}&offset=${offset}`,
      { method: 'GET' },
    );
    return data.data?.notepads ?? data.notepads ?? [];
  }

  /** 创建云词本（content 每行一个单词；status 必须大写 PUBLISHED） */
  async createNotepad(params: { title: string; content: string; brief?: string; tags?: string[] }): Promise<NotepadData> {
    const data = await this.request<{ data?: { notepad?: NotepadData }; notepad?: NotepadData }>(
      '/api/v1/notepads',
      { method: 'POST', body: JSON.stringify({ notepad: { status: 'PUBLISHED', tags: [], ...params } }) },
    );
    const np = data.data?.notepad ?? data.notepad;
    if (!np?.id) throw new MaimemoApiError(500, '创建云词本未返回 id');
    return np;
  }

  /** 更新云词本（content 全量替换，⚠️ 不是追加） */
  async updateNotepad(id: string, params: { title?: string; content?: string }): Promise<NotepadData> {
    const data = await this.request<{ data?: { notepad?: NotepadData }; notepad?: NotepadData }>(
      `/api/v1/notepads/${id}`,
      { method: 'POST', body: JSON.stringify({ notepad: params }) },
    );
    return data.data?.notepad ?? data.notepad ?? { id };
  }

  // —— 单词 vocabulary ——

  /** 批量查单词 ID（spellings → vocId 映射）。caller 按 VOCAB_QUERY_BATCH 分批。
   *  ⚠️ 实测墨墨返回字段是 data.voc（单数，值是数组），非 data.vocs。 */
  async queryVocabularyBatch(spellings: string[]): Promise<{ vocIdBySpelling: Map<string, string>; missing: string[] }> {
    const vocIdBySpelling = new Map<string, string>();
    const data = await this.request<{
      data?: { voc?: Array<{ id: string; spelling: string }> };
    }>('/api/v1/vocabulary/query', {
      method: 'POST',
      body: JSON.stringify({ spellings }),
    });
    const vocs = data.data?.voc ?? [];
    const found = new Set<string>();
    for (const v of vocs) {
      // 墨墨 spelling 可能与查询大小写不同，统一小写匹配
      vocIdBySpelling.set(v.spelling.toLowerCase(), v.id);
      found.add(v.spelling.toLowerCase());
    }
    const missing = spellings.filter(s => !found.has(s.toLowerCase()));
    return { vocIdBySpelling, missing };
  }

  // —— 学习计划 study ——

  /** 加入学习计划（words 已是 vocId 数组）。caller 按 ADD_WORDS_BATCH 分批。返回新增数。 */
  async addWordsBatch(vocIds: string[], advance = false): Promise<{ addedCount: number }> {
    const data = await this.request<{
      data?: { added_count?: number };
      added_count?: number;
    }>('/api/v1/study/add_words', {
      method: 'POST',
      body: JSON.stringify({ words: vocIds.map(id => ({ id })), advance }),
    });
    return { addedCount: data.data?.added_count ?? data.added_count ?? 0 };
  }

  /** 账号级今日学习进度（含其他词库，展示须标注） */
  async getStudyProgress(): Promise<{ finished: number; total: number; studyTime: number }> {
    const data = await this.request<{
      data?: { progress?: { finished?: number; total?: number; study_time?: number } };
    }>('/api/v1/study/get_study_progress', { method: 'POST', body: '{}' });
    const p = data.data?.progress ?? {};
    return {
      finished: p.finished ?? 0,
      total: p.total ?? 0,
      studyTime: p.study_time ?? 0,
    };
  }

  /** 批量查学习记录。caller 按 STUDY_RECORDS_BATCH 分批。返回逐词记录（防御式解析）。
   *  ⚠️ 字段据 2026-08-05 实测：voc_spelling/study_count/last_study_date/next_study_date/last_response。
   *  墨墨不返回 familiarity，故掌握度改由服务层据 next_study_date 间隔推断。 */
  async queryStudyRecordsBatch(spellings: string[]): Promise<MaimemoWordStudyRecord[]> {
    const data = await this.request<{
      data?: { records?: any[] };
    }>('/api/v1/study/query_study_records', {
      method: 'POST',
      body: JSON.stringify({ spellings, limit: spellings.length || 20 }),
    });
    const raw = data.data?.records ?? [];
    return raw.map((r: any): MaimemoWordStudyRecord => ({
      spelling: r.voc_spelling ?? r.spelling ?? '',
      status: r.last_response ?? r.status,
      reviewCount: r.study_count ?? r.review_count,
      lastReviewAt: r.last_study_date ?? r.last_review_at,
      nextReviewAt: r.next_study_date ?? r.next_review_at,
    })).filter(r => r.spelling);
  }
}

/** 墨墨 API 错误（带状态码，便于服务层映射为用户文案） */
export class MaimemoApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'MaimemoApiError';
  }
}
