// frontend/src/api/worklog.ts
// 工作记录 API 客户端(端点契约见 backend worklogRoutes)。
// 全部 silent:http 层不弹 toast,由 WorklogView 各 handler 统一提示(避免双重 toast)。
import type {
  WorklogData,
  WorklogRecordRequest,
  WorklogRecordResponse,
  WorklogUpdateRequest,
} from '@ai-task-flow/shared';
import { http } from './http';

export const worklogApi = {
  /** 全树(读不缓存,每次操作后重拉) */
  getTree: () => http.get<WorklogData>('/worklog', true),

  /** 新增条目(项目/版本自动建层) */
  create: (data: WorklogRecordRequest) =>
    http.post<WorklogRecordResponse>('/worklog/entries', data, true),

  /** partial 更新(表单外字段不传即保留——diff/files 不会被抹掉) */
  update: (id: string, patch: WorklogUpdateRequest) =>
    http.put<{ id: string; path: string }>(`/worklog/entries/${id}`, patch, true),

  deleteEntry: (id: string) => http.delete<{ ok: boolean }>(`/worklog/entries/${id}`, true),

  deleteVersion: (project: string, version: string) =>
    http.delete<{ ok: boolean }>(`/worklog/versions?project=${encodeURIComponent(project)}&version=${encodeURIComponent(version)}`, true),

  renameVersion: (project: string, version: string, newName: string) =>
    http.post<{ ok: boolean }>('/worklog/versions/rename', { project, version, newName }, true),

  deleteProject: (project: string) =>
    http.delete<{ ok: boolean }>(`/worklog/projects/${encodeURIComponent(project)}`, true),

  renameProject: (project: string, newName: string) =>
    http.post<{ ok: boolean }>(`/worklog/projects/${encodeURIComponent(project)}/rename`, { newName }, true),
};
