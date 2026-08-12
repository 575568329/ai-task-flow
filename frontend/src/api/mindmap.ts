// frontend/src/api/mindmap.ts
// 思维导图模块 HTTP 客户端。复用 http 封装（自动 /api 前缀 + 错误 toast）。
import { http } from './http';
import type {
  MindmapCreateDTO,
  MindmapDocDTO,
  MindmapListResponse,
  MindmapUpdateDTO,
} from '@ai-task-flow/shared';

export const mindmapApi = {
  /** 列表（仅 meta，nodeCount 冗余存储不解析 nodes） */
  list: () => http.get<MindmapListResponse>('/mindmaps'),
  /** 新建（含默认根节点） */
  create: (dto: MindmapCreateDTO) => http.post<MindmapDocDTO>('/mindmaps', dto),
  /** 获取完整文档（含 nodes/edges/viewport） */
  get: (id: string) => http.get<MindmapDocDTO>(`/mindmaps/${id}`),
  /** 部分更新（乐观锁：传 expectedVersion；冲突 409 由 http 拦截器 toast） */
  update: (id: string, dto: MindmapUpdateDTO) => http.patch<MindmapDocDTO>(`/mindmaps/${id}`, dto),
  /** 硬删 */
  remove: (id: string) => http.delete<void>(`/mindmaps/${id}`),
  /** 复制（新 id + 标题加" 副本"） */
  duplicate: (id: string) => http.post<MindmapDocDTO>(`/mindmaps/${id}/duplicate`),
};
