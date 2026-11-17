// frontend/src/api/system.ts
// system 相关 API(worklog 转型 Step5 自 api/task.ts 迁出——task API 已随看板砍除,
// 仅保留保留功能在用的健康检查与存储管理)。
import type {
  StorageInfo,
  StorageClearResponse,
  StorageCategoryKey,
} from '@ai-task-flow/shared';
import { http } from './http';

export const systemApi = {
  /** 获取数据目录各项占用 + 总占用 + 告警标志(silent:启动时拉取,后端未就绪不弹错) */
  getStorage: () => http.get<StorageInfo>('/system/storage', true),

  /** 按类别清理(仅 clearable 项生效),返回每类释放字节 + 清理后最新占用 */
  clearStorage: (categories: StorageCategoryKey[]) =>
    http.post<StorageClearResponse>('/system/storage/clear', { categories }),
};

/** 健康检查:定 localAccess(设置/存储管理页的可见性) */
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
