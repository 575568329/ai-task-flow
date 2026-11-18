import type {
  Conclusion,
  ConclusionAppendRequest,
  ConclusionAppendResponse,
  ConclusionCreateRequest,
  ConclusionCreateResponse,
  ConclusionPatchRequest,
  ConclusionQueryRequest,
  ConclusionSummary,
} from '@ai-task-flow/shared';
import { http } from './http';

function queryString(input: ConclusionQueryRequest): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export const conclusionApi = {
  list: (input: ConclusionQueryRequest = {}) =>
    http.get<{ conclusions: ConclusionSummary[] }>(`/conclusions${queryString(input)}`, true),

  get: (id: string) => http.get<Conclusion>(`/conclusions/${id}`, true),

  create: (input: ConclusionCreateRequest) =>
    http.post<ConclusionCreateResponse>('/conclusions', input, true),

  append: (id: string, input: ConclusionAppendRequest) =>
    http.post<ConclusionAppendResponse>(`/conclusions/${id}/revisions`, input, true),

  patch: (id: string, input: ConclusionPatchRequest) =>
    http.patch<Conclusion>(`/conclusions/${id}`, input, true),

  remove: (id: string) => http.delete<{ deleted: boolean }>(`/conclusions/${id}`, true),
};
