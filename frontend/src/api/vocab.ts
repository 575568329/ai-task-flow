// frontend/src/api/vocab.ts
// 翻译生词本 API 封装。复用 http 统一拦截器(失败自动 toast)。
import { http } from './http';
import type {
  VocabDTO,
  VocabCreateDTO,
  VocabUpdateDTO,
  VocabListQuery,
  VocabListResponse,
  TranslateResponse,
} from '@ai-task-flow/shared';

/** 把列表查询参数拼成 query string(跳过空值) */
function buildQuery(query: VocabListQuery): string {
  const params = new URLSearchParams();
  if (query.kw) params.set('kw', query.kw);
  if (query.sourceLang) params.set('sourceLang', query.sourceLang);
  if (typeof query.mastered === 'boolean') params.set('mastered', String(query.mastered));
  if (typeof query.starred === 'boolean') params.set('starred', String(query.starred));
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const vocabApi = {
  /** 划词翻译 */
  translate: (text: string, targetLang?: string) =>
    http.post<TranslateResponse>('/vocab/translate', { text, targetLang }),
  /** 列表(搜索/筛选/分页) */
  list: (query: VocabListQuery) => http.get<VocabListResponse>(`/vocab${buildQuery(query)}`),
  /** 单条 */
  get: (id: string) => http.get<VocabDTO>(`/vocab/${id}`),
  /** 新增(重复返回 409,由 http 拦截器 toast) */
  save: (dto: VocabCreateDTO) => http.post<VocabDTO>('/vocab', dto),
  /** 更新收藏/掌握 */
  update: (id: string, dto: VocabUpdateDTO) => http.patch<VocabDTO>(`/vocab/${id}`, dto),
  /** 删除 */
  remove: (id: string) => http.delete<void>(`/vocab/${id}`),
};
