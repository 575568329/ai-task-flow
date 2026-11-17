// frontend/src/api/worklog.ts
// 工作记录 API 客户端(端点契约见 backend worklogRoutes)。
import type {
  WorklogData,
  WorklogRecordRequest,
  WorklogRecordResponse,
  WorklogUpdateRequest,
  WorklogProjectSummary,
} from '@ai-task-flow/shared';
import { http } from './http';

export const worklogApi = {
  /** 全树(读不缓存,每次操作后重拉) */
  getTree: () => http.get<WorklogData>('/worklog'),

  /** 新增条目(项目/版本自动建层) */
  create: (data: WorklogRecordRequest) =>
    http.post<WorklogRecordResponse>('/worklog/entries', data),

  /** partial 更新(表单外字段不传即保留——diff/files 不会被抹掉) */
  update: (id: string, patch: WorklogUpdateRequest) =>
    http.put<{ id: string; path: string }>(`/worklog/entries/${id}`, patch),

  deleteEntry: (id: string) => http.delete<{ ok: boolean }>(`/worklog/entries/${id}`),

  deleteVersion: (project: string, version: string) =>
    http.delete<{ ok: boolean }>(`/worklog/versions?project=${encodeURIComponent(project)}&version=${encodeURIComponent(version)}`),

  renameVersion: (project: string, version: string, newName: string) =>
    http.post<{ ok: boolean }>('/worklog/versions/rename', { project, version, newName }),

  deleteProject: (project: string) =>
    http.delete<{ ok: boolean }>(`/worklog/projects/${encodeURIComponent(project)}`),

  renameProject: (project: string, newName: string) =>
    http.post<{ ok: boolean }>(`/worklog/projects/${encodeURIComponent(project)}/rename`, { newName }),

  /** 项目/版本汇总(AI 指南旁的概览亦可复用) */
  listProjects: () => http.get<WorklogProjectSummary[]>('/worklog', true),
};
