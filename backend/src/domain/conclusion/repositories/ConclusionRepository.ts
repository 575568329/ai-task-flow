import type { ConclusionData } from '@ai-task-flow/shared';

export interface ConclusionMutateOptions {
  /** 破坏性操作前快照，默认 false */
  backup?: boolean;
}

export interface ConclusionRepository {
  /** 每次直读磁盘，不缓存 */
  load(): Promise<ConclusionData>;
  /** 在写协议保护下执行读-改-写事务 */
  mutate<T>(
    fn: (data: ConclusionData) => T | Promise<T>,
    options?: ConclusionMutateOptions,
  ): Promise<T>;
}
