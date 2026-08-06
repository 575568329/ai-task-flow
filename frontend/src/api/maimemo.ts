// frontend/src/api/maimemo.ts
// 墨墨同步 API 封装。复用 http 统一拦截器(失败自动 toast)。
import { http } from './http';
import type {
  MaimemoConfigDTO,
  SaveMaimemoConfigDTO,
  MaimemoTestResultDTO,
  StudySyncResultDTO,
  NotepadSyncResultDTO,
  StudyProgressDTO,
} from '@ai-task-flow/shared';

export const maimemoApi = {
  /** 获取脱敏配置 */
  getConfig: () => http.get<MaimemoConfigDTO>('/maimemo/config'),
  /** 保存 token（空=保持原值） */
  saveConfig: (dto: SaveMaimemoConfigDTO) => http.put<MaimemoConfigDTO>('/maimemo/config', dto),
  /** 测试连接 */
  test: () => http.post<MaimemoTestResultDTO>('/maimemo/config/test'),
  /** 同步云词本（全量替换） */
  syncNotepad: () => http.post<NotepadSyncResultDTO>('/maimemo/sync/notepad'),
  /** 加入学习计划 */
  syncStudy: () => http.post<StudySyncResultDTO>('/maimemo/sync/study'),
  /** 学习进度（force=1 强制刷新） */
  getProgress: (force = false) =>
    http.get<StudyProgressDTO>(`/maimemo/progress${force ? '?force=1' : ''}`),
};
