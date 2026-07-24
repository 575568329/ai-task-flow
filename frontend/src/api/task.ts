// frontend/src/api/task.ts
import type {
  TaskDTO,
  CreateTaskRequest,
  UpdateTaskRequest,
  StorageInfo,
  StorageClearResponse,
  StorageCategoryKey,
  OpenClaudeRequest,
  OpenClaudeResponse,
  ClaudeSessionListResponse,
} from '@ai-task-flow/shared';
import { http } from './http';

export const taskApi = {
  getAll: () => http.get<TaskDTO[]>('/tasks'),
  getById: (id: string) => http.get<TaskDTO>(`/tasks/${id}`),
  create: (data: CreateTaskRequest) => http.post<TaskDTO>('/tasks', data),
  update: (id: string, data: UpdateTaskRequest) => http.patch<TaskDTO>(`/tasks/${id}`, data),
  remove: (id: string) => http.delete<void>(`/tasks/${id}`),
  /** 静默更新(拖拽乐观更新用,失败由调用方回滚) */
  updateSilent: (id: string, data: UpdateTaskRequest) =>
    http.patch<TaskDTO>(`/tasks/${id}`, data, true),
  /** 获取任务转换好的 Markdown 文本(后端 buildTaskMarkdown 生成) */
  getMarkdown: (id: string) =>
    http.get<{ markdown: string }>(`/tasks/${id}/markdown`),
};

export const systemApi = {
  /** 打开系统文件夹选择器 */
  selectDirectory: () => http.post<{ path: string | null }>('/system/select-directory', {}),

  /** 获取数据目录各项占用 + 总占用 + 告警标志(silent:启动时拉取,后端未就绪不弹错) */
  getStorage: () => http.get<StorageInfo>('/system/storage', true),

  /** 按类别清理(仅 clearable 项生效),返回每类释放字节 + 清理后最新占用 */
  clearStorage: (categories: StorageCategoryKey[]) =>
    http.post<StorageClearResponse>('/system/storage/clear', { categories }),

  /** 扫描某项目工作目录下的 Claude 历史会话(OpenClaudeDialog 列表用,silent) */
  listClaudeSessions: (repoPath: string) =>
    http.get<ClaudeSessionListResponse>(
      `/system/claude-sessions?repoPath=${encodeURIComponent(repoPath)}`,
      true,
    ),

  /** 打开终端启动 claude(可选 resume) */
  openClaudeSession: (data: OpenClaudeRequest) =>
    http.post<OpenClaudeResponse>('/system/claude-sessions/open', data),

  /** 一键把本项目 MCP 挂载到 Claude Code(backend spawn setup-mcp.mjs) */
  mcpSetup: () =>
    http.post<{ ok: boolean; code: number; output: string }>('/system/mcp/setup', {}),
};

/**
 * 健康检查 + 访问上下文。
 * /health 不在 /api 前缀下,故用原生 fetch 而非 http 封装。
 * 失败时按"本机访问"兜底(不误屏蔽设置入口)。
 */
export async function fetchHealth(): Promise<{ localAccess: boolean }> {
  try {
    const res = await fetch('/health');
    if (!res.ok) return { localAccess: true };
    const data = await res.json();
    return { localAccess: data?.localAccess ?? true };
  } catch {
    return { localAccess: true };
  }
}
