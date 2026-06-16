// backend/src/interfaces/http/server.ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { uploadsDirPath } from '../../config/dataDir.js';
import { TaskRepository } from '../../domain/workflow/repositories/TaskRepository.js';
import { EventBus } from '../../infrastructure/pubsub/EventBus.js';
import { WorktreeManager } from '../../infrastructure/git/WorktreeManager.js';
import { registerTaskRoutes } from './routes/taskRoutes.js';
import { registerSSERoutes } from './routes/sseRoutes.js';
import { registerUploadRoutes } from './routes/uploadRoutes.js';
import { registerProjectRoutes } from './routes/projectRoutes.js';
import { registerChatRoutes } from './routes/chatRoutes.js';
import { registerFileRoutes } from './routes/fileRoutes.js';
import systemRoutes from './routes/system.js';
import type { ChatRepository } from '../../domain/research/repositories/ChatRepository.js';
import type { ChatService } from '../../application/research/ChatService.js';
import type { LlmConfigService } from '../../application/llm-config/LlmConfigService.js';
import { registerLlmConfigRoutes } from './routes/llmConfigRoutes.js';

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
  return uploadsDirPath();
}

export async function createHttpServer(
  config: HttpServerConfig,
  taskRepository: TaskRepository,
  eventBus: EventBus,
  worktreeManager: WorktreeManager,
  chatRepository: ChatRepository,
  chatService: ChatService,
  llmConfigService: LlmConfigService,
) {
  // 默认 warn 级别(生产/CLI 用户友好);设 NODE_ENV=development 或 LOG_LEVEL=info 看详细
  // test 环境完全静默,避免 vitest 输出被日志淹没
  const logLevel = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'development' ? 'info' : 'warn');
  const fastify = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : {
      level: logLevel,
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

  // 健康检查 + 服务身份标识(供 CLI probe 是否同应用,避免重复启动/冲突)
  // - service: 标识"这是 ai-task-flow"
  // - web: 标识"这个实例是否托管了前端 SPA",false 表示纯 API(dev 模式),CLI 不应 reuse
  const hasWeb = !!(config.frontendDist && fs.existsSync(path.join(config.frontendDist, 'index.html')));
  fastify.get('/health', async (request) => {
    // 判断请求是否来自本机回环:前端据此控制敏感页面(设置/存储管理)的可见性。
    // 本机浏览器访问 => true(看得到设置);同网段其他设备访问 => false(屏蔽设置入口)。
    // key 明文本身在任何情况下都不会下发(GET /api/llm-config 已脱敏),此处仅用于页面可见性。
    const ip = request.ip;
    const localAccess =
      ip === '127.0.0.1' ||
      ip === '::1' ||
      ip === '::ffff:127.0.0.1' ||
      ip === 'localhost';
    return {
      status: 'ok',
      service: 'ai-task-flow',
      web: hasWeb,
      localAccess,
      timestamp: new Date().toISOString(),
    };
  });

  // 注册业务路由
  await registerTaskRoutes(fastify, taskRepository, worktreeManager);
  await registerSSERoutes(fastify, eventBus);
  await registerUploadRoutes(fastify, uploadsDir);
  await registerProjectRoutes(fastify);
  await registerChatRoutes(fastify, chatRepository, chatService);
  await registerLlmConfigRoutes(fastify, llmConfigService);
  await registerFileRoutes(fastify);
  await fastify.register(systemRoutes);

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
  worktreeManager: WorktreeManager,
  chatRepository: ChatRepository,
  chatService: ChatService,
  llmConfigService: LlmConfigService,
) {
  const server = await createHttpServer(config, taskRepository, eventBus, worktreeManager, chatRepository, chatService, llmConfigService);

  try {
    await server.listen({ port: config.port, host: config.host });
    const url = `http://localhost:${config.port}`;
    if (config.frontendDist) {
      console.log('========================================');
      console.log(`✓ AI Task Flow ready: ${url}`);
      console.log(`  - Web UI:  ${url}`);
      console.log(`  - API:     ${url}/api`);
      console.log('========================================');
    } else {
      console.log('========================================');
      console.log(`✓ Backend ready: ${url}`);
      console.log(`  (Frontend served separately via Vite at http://localhost:5678)`);
      console.log('========================================');
    }
  } catch (err) {
    // 把常见错误翻译成友好提示;不再 dump 整个 fastify JSON 日志
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'EADDRINUSE') {
      console.error('');
      console.error(`✗ 端口 ${config.port} 已被占用`);
      console.error('');
      console.error('  解决办法(任选一个):');
      console.error(`    1. 用其他端口:   ai-task-flow --port 8080`);
      console.error(`    2. 释放该端口后重试`);
      console.error('');
    } else if (code === 'EACCES') {
      console.error('');
      console.error(`✗ 没有权限监听端口 ${config.port}`);
      console.error('  小于 1024 的端口需要管理员权限,建议换 3000 / 8080 等');
      console.error('');
    } else {
      console.error('');
      console.error(`✗ 启动失败: ${(err as Error)?.message ?? String(err)}`);
      console.error('');
    }
    process.exit(1);
  }

  return server;
}
