// frontend/src/api/worklog.ts
// 工作记录 API 客户端(端点契约见 backend worklogRoutes)。
// 模型:建设主题 → 版本 → 条目(需求层已移除);项目降为字典(路径归属/筛选)。
// 全部 silent:http 层不弹 toast,由 WorklogView 各 handler 统一提示(避免双重 toast)。
import type {
  WorklogData,
  WorklogProgramCreateRequest,
  WorklogRecordRequest,
  WorklogRecordResponse,
  WorklogUpdateRequest,
  WorklogVersionCreateRequest,
} from '@ai-task-flow/shared';
import { http } from './http';

export const worklogApi = {
  /** 全树(读不缓存,每次操作后重拉) */
  getTree: () => http.get<WorklogData>('/worklog', true),

  /** 新增条目到已存在的版本(同 record_work) */
  record: (data: WorklogRecordRequest) =>
    http.post<WorklogRecordResponse>('/worklog/entries', data, true),

  /** partial 更新(表单外字段不传即保留——diff/files 不会被抹掉) */
  update: (id: string, patch: WorklogUpdateRequest) =>
    http.put<{ id: string; path: string; warnings?: string[] }>(`/worklog/entries/${id}`, patch, true),

  deleteEntry: (id: string) => http.delete<{ ok: boolean }>(`/worklog/entries/${id}`, true),

  // ------------------------------------------------------------------
  // 建设主题(顶层,版本通过 programId 归属)
  // ------------------------------------------------------------------
  createProgram: (data: WorklogProgramCreateRequest) =>
    http.post<{ id: string }>('/worklog/programs', data, true),

  renameProgram: (id: string, newName: string) =>
    http.post<{ ok: boolean }>(`/worklog/programs/${encodeURIComponent(id)}/rename`, { newName }, true),

  deleteProgram: (id: string) =>
    http.delete<{ ok: boolean }>(`/worklog/programs/${encodeURIComponent(id)}`, true),

  // ------------------------------------------------------------------
  // 版本(必须归属主题)
  // ------------------------------------------------------------------
  createVersion: (data: WorklogVersionCreateRequest) =>
    http.post<{ id: string }>('/worklog/versions', data, true),

  renameVersion: (id: string, newName: string) =>
    http.post<{ ok: boolean }>(`/worklog/versions/${encodeURIComponent(id)}/rename`, { newName }, true),

  deleteVersion: (id: string) =>
    http.delete<{ ok: boolean }>(`/worklog/versions/${encodeURIComponent(id)}`, true),

  // ------------------------------------------------------------------
  // 项目字典(路径归属与筛选;不再是树根)
  // ------------------------------------------------------------------
  createProject: (data: { name: string; paths?: string[] }) =>
    http.post<{ id: string }>('/worklog/projects', data, true),

  deleteProject: (project: string) =>
    http.delete<{ ok: boolean }>(`/worklog/projects/${encodeURIComponent(project)}`, true),

  renameProject: (project: string, newName: string) =>
    http.post<{ ok: boolean }>(`/worklog/projects/${encodeURIComponent(project)}/rename`, { newName }, true),

  /** 绑定项目路径(整体替换;后端校验绝对路径与跨项目冲突) */
  bindPaths: (project: string, paths: string[]) =>
    http.put<{ ok: boolean }>(`/worklog/projects/${encodeURIComponent(project)}/paths`, { paths }, true),

  /** 解绑单个已绑定路径 */
  unbindPath: (project: string, path: string) =>
    http.delete<{ ok: boolean }>(
      `/worklog/projects/${encodeURIComponent(project)}/paths?path=${encodeURIComponent(path)}`,
      true,
    ),
};
