// backend/src/interfaces/http/server.ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { TaskRepository } from '../../domain/workflow/repositories/TaskRepository.js';
import { EventBus } from '../../infrastructure/pubsub/EventBus.js';
import { WorktreeManager } from '../../infrastructure/git/WorktreeManager.js';
import { registerTaskRoutes } from './routes/taskRoutes.js';
import { registerSSERoutes } from './routes/sseRoutes.js';

export interface HttpServerConfig {
  port: number;
  host: string;
  corsOrigin: string | string[];
}

export async function createHttpServer(
  config: HttpServerConfig,
  taskRepository: TaskRepository,
  eventBus: EventBus,
  worktreeManager: WorktreeManager
) {
  const fastify = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : {
      level: 'info',
    },
  });

  // 注册 CORS
  await fastify.register(cors, {
    origin: config.corsOrigin,
    credentials: true,
  });

  // 健康检查
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // 注册任务路由
  await registerTaskRoutes(fastify, taskRepository, worktreeManager);

  // 注册 SSE 路由
  await registerSSERoutes(fastify, eventBus);

  return fastify;
}

export async function startHttpServer(
  config: HttpServerConfig,
  taskRepository: TaskRepository,
  eventBus: EventBus,
  worktreeManager: WorktreeManager
) {
  const server = await createHttpServer(config, taskRepository, eventBus, worktreeManager);

  try {
    await server.listen({ port: config.port, host: config.host });
    console.log(`HTTP Server listening on http://${config.host}:${config.port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }

  return server;
}
