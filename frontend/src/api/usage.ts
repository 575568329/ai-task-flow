// frontend/src/api/usage.ts
// Token 用量面板 API。复用 http 统一拦截器。
import { http } from './http';
import type { UsageSummary, UsageSummaryQuery } from '@ai-task-flow/shared';

function buildQuery(q: UsageSummaryQuery): string {
  const params = new URLSearchParams();
  if (q.project) params.set('project', q.project);
  if (q.taskId) params.set('taskId', q.taskId);
  if (q.from) params.set('from', q.from);
  if (q.to) params.set('to', q.to);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const usageApi = {
  /** 五维度用量聚合 */
  summary: (q: UsageSummaryQuery = {}) => http.get<UsageSummary>(`/usage/summary${buildQuery(q)}`),
};
