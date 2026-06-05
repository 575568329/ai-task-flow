// backend/src/infrastructure/di/container.ts
import 'reflect-metadata';
import { container } from 'tsyringe';
import { WorktreeManager } from '../git/WorktreeManager.js';

/**
 * 依赖注入容器配置
 * 使用 tsyringe 管理依赖
 */

// 注册基础设施服务
container.registerSingleton('WorktreeManager', WorktreeManager);

// 导出容器实例
export { container };
