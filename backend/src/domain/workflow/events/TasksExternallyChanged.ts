// backend/src/domain/workflow/events/TasksExternallyChanged.ts
import { DomainEvent } from '../../_shared/DomainEvent.js';

/**
 * tasks.json 被外部进程(如 MCP stdio server)直接修改后,HTTP 进程通过文件轮询发现。
 *
 * 与普通领域事件不同:它不描述单个聚合的状态迁移,而是「磁盘与本进程内存已不同步」。
 * 因此外端收到后应「全量重拉」(fetchAll),而非按 aggregateId 拉单个任务——
 * 外部写入可能涉及任意多个任务,单事件无法表达。
 */
export class TasksExternallyChanged extends DomainEvent {
  constructor() {
    // aggregateId 用固定标识:本事件不针对单个任务
    super('tasks-file');
  }
}
