// backend/src/infrastructure/di/container.ts
import 'reflect-metadata';
import { container } from 'tsyringe';
import { JsonTaskRepository } from '../persistence/JsonTaskRepository.js';
import { KnowledgeService } from '../../application/knowledge/KnowledgeService.js';
import { knowledgeDirPath } from '../../config/dataDir.js';

/**
 * 依赖注入容器配置
 * 使用 tsyringe 管理依赖
 *
 * 注意: WorktreeManager 未在此注册——会话化改造后任务不再自动创建 worktree,
 * WorktreeManager 降为可选工具能力,当前无调用方。如需启用,按需加回即可。
 */

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
