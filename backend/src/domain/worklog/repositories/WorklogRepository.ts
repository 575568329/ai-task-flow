// backend/src/domain/worklog/repositories/WorklogRepository.ts
// worklog 仓储接口:领域层只关心"取数/变更"两个原语。
// 变更协议(进程内串行 + 跨进程文件锁 + 锁内重读 + 原子写 + 破坏性前快照)由基础设施实现。
import type { WorklogData } from '@ai-task-flow/shared';

export interface WorklogMutateOptions {
  /** 破坏性操作(删除/重命名)前置快照,默认 false */
  backup?: boolean;
}

export interface WorklogRepository {
  /** 读最新数据(不缓存,每次读磁盘——MCP 进程写入后本进程立即可见) */
  load(): Promise<WorklogData>;
  /**
   * 在写协议保护下执行一段「读-改-写」事务:fn 直接突变 data,
   * 事务提交后原子写回;fn 抛错则不落盘。
   */
  mutate<T>(fn: (data: WorklogData) => T | Promise<T>, options?: WorklogMutateOptions): Promise<T>;
}
