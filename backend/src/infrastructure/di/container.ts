// backend/src/infrastructure/di/container.ts
import 'reflect-metadata';
import { container } from 'tsyringe';
import { WorktreeManager } from '../git/WorktreeManager.js';
import { JsonTaskRepository } from '../persistence/JsonTaskRepository.js';
import { KnowledgeService } from '../../application/knowledge/KnowledgeService.js';
import { knowledgeDirPath } from '../../config/dataDir.js';

/**
 * 依赖注入容器配置
 * 使用 tsyringe 管理依赖
 */

// 注册基础设施服务
// WorktreeManager:设计方案 §4.2 保留的任务级 git worktree 隔离能力。会话化改造后状态机
// 收敛为三态、打开终端不再创建 worktree,目前无 resolver 引用;但设计上仍保留为可选关联
// (任务可挂 worktree 元数据),故注册保留,留待后续按需启用,不在此删。
container.registerSingleton('WorktreeManager', WorktreeManager);

// 注册 Repository
// 用 useFactory 直接构造,绕过 tsyringe useClass 对 JsonTaskRepository 构造参数
// (customPath:string / eventBus / eventStore)的自动注入——基本类型 String 无法 resolve,
// 会抛 "TypeInfo not known for String"。MCP server 是唯一直接 resolve('TaskRepository')
// 的入口(HTTP 走 new),这里给默认实例(读默认 ~/.ai-task-flow/tasks.json)即可。
container.register('TaskRepository', {
  useFactory: () => new JsonTaskRepository(),
});

// 注册知识库服务(构造需 root 参数,用 useFactory 注入)
container.register('KnowledgeService', {
  useFactory: () => new KnowledgeService(knowledgeDirPath()),
});

// 导出容器实例
export { container };
