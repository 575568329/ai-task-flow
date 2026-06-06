// backend/src/interfaces/http/server.ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import path from 'path';
import os from 'os';
import fs from 'fs';
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
  /** 前端打包产物目录(含 index.html)。传入则单端口托管 SPA。 */
  frontendDist?: string;
  /** 上传目录,默认 ~/.ai-task-flow/uploads */
  uploadsDir?: string;
}

/** 解析上传目录,默认放在用户数据目录下,与 tasks.json 同级 */
function resolveUploadsDir(custom?: string): string {
  if (custom) return custom;
  return path.join(os.homedir(), '.ai-task-flow', 'uploads');
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

  // 注册上传目录静态服务(decorateReply: true,首个 staticPlugin 装饰 reply.sendFile)
  const uploadsDir = resolveUploadsDir(config.uploadsDir);
  // 提前创建,避免 @fastify/static 因目录不存在而报错
  fs.mkdirSync(uploadsDir, { recursive: true });
  await fastify.register(staticPlugin, {
    root: uploadsDir,
    prefix: '/api/uploads/',
  });

  // 健康检查
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // 注册业务路由
  await registerTaskRoutes(fastify, taskRepository, worktreeManager);
  await registerSSERoutes(fastify, eventBus);
  await registerUploadRoutes(fastify, uploadsDir);
  await registerProjectRoutes(fastify);

  // 生产模式:单端口托管前端 SPA(可选)
  if (config.frontendDist && fs.existsSync(path.join(config.frontendDist, 'index.html'))) {
    await fastify.register(staticPlugin, {
      root: config.frontendDist,
      prefix: '/',
      decorateReply: false, // 已被首个 staticPlugin 装饰过
      wildcard: false,      // 由 setNotFoundHandler 实现 SPA fallback
    });

    // SPA fallback: 非 /api/* 的 GET 兜底返回 index.html,让 React Router 接管
    fastify.setNotFoundHandler((request, reply) => {
      if (request.method !== 'GET' || request.url.startsWith('/api/') || request.url === '/health') {
        return reply.status(404).send({ error: 'Not Found' });
      }
      return reply.type('text/html').sendFile('index.html', config.frontendDist!);
    });
  }

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
    const url = `http://localhost:${config.port}`;
    if (config.frontendDist) {
      console.log('\n========================================');
      console.log(`✓ AI Task Flow ready: ${url}`);
      console.log(`  - Web UI:  ${url}`);
      console.log(`  - API:     ${url}/api`);
      console.log('========================================\n');
    } else {
      console.log('\n========================================');
      console.log(`✓ Backend ready: ${url}`);
      console.log(`  (Frontend served separately via Vite at http://localhost:5173)`);
      console.log('========================================\n');
    }
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }

  return server;
}
