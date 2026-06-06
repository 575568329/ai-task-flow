// backend/src/interfaces/http/server.ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import path from 'path';
import { TaskRepository } from '../../domain/workflow/repositories/TaskRepository.js';
import { EventBus } from '../../infrastructure/pubsub/EventBus.js';
import { WorktreeManager } from '../../infrastructure/git/WorktreeManager.js';
import { registerTaskRoutes } from './routes/taskRoutes.js';
import { registerSSERoutes } from './routes/sseRoutes.js';
import { registerUploadRoutes } from './routes/uploadRoutes.js';
import { registerProjectRoutes } from './routes/projectRoutes.js';

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

  // 注册文件上传插件
  await fastify.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB
    },
  });

  // 注册静态文件服务
  await fastify.register(staticPlugin, {
    root: path.join(process.cwd(), 'uploads'),
    prefix: '/api/uploads/',
  });

  // 健康检查
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // 注册任务路由
  await registerTaskRoutes(fastify, taskRepository, worktreeManager);

  // 注册 SSE 路由
  await registerSSERoutes(fastify, eventBus);

  // 注册上传路由
  await registerUploadRoutes(fastify);

  // 注册项目检查路由
  await registerProjectRoutes(fastify);

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
