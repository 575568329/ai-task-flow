// backend/src/interfaces/http/server.ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { uploadsDirPath } from '../../config/dataDir.js';
import { findAvailablePort } from '../../utils/port-finder.js';
import { TaskRepository } from '../../domain/workflow/repositories/TaskRepository.js';
import { EventBus } from '../../infrastructure/pubsub/EventBus.js';
import { WorktreeManager } from '../../infrastructure/git/WorktreeManager.js';
import { registerTaskRoutes } from './routes/taskRoutes.js';
import { registerSSERoutes } from './routes/sseRoutes.js';
import { registerUploadRoutes } from './routes/uploadRoutes.js';
import { registerProjectRoutes } from './routes/projectRoutes.js';
import { registerChatRoutes } from './routes/chatRoutes.js';
import { registerFileRoutes } from './routes/fileRoutes.js';
import { registerKnowledgeRoutes } from './routes/knowledgeRoutes.js';
import systemRoutes from './routes/system.js';
import type { ChatRepository } from '../../domain/research/repositories/ChatRepository.js';
import type { ChatService } from '../../application/research/ChatService.js';
import type { LlmConfigService } from '../../application/llm-config/LlmConfigService.js';
import type { WebClipService } from '../../application/webclip/WebClipService.js';
import type { KnowledgeService } from '../../application/knowledge/KnowledgeService.js';
import type { VocabService } from '../../application/vocab/VocabService.js';
import { registerLlmConfigRoutes } from './routes/llmConfigRoutes.js';
import { registerWebClipRoutes } from './routes/webClipRoutes.js';
import { registerVocabRoutes } from './routes/vocabRoutes.js';

/** 请求体上限。扩展网页剪藏会把多张图片以 base64 编码塞进请求体，远超 Fastify 默认 1MB，
 *  否则后端返回 413 Payload Too Large。25MB 覆盖常见多图场景；图片传输优化后可调小。 */
const BODY_LIMIT_BYTES = 25 * 1024 * 1024;

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
  webClipService: WebClipService,
  knowledgeService: KnowledgeService,
  vocabService: VocabService,
) {
  // 默认 warn 级别(生产/CLI 用户友好);设 NODE_ENV=development 或 LOG_LEVEL=info 看详细
  // test 环境完全静默,避免 vitest 输出被日志淹没
  const logLevel = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'development' ? 'info' : 'warn');
  const fastify = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : {
      level: logLevel,
    },
    bodyLimit: BODY_LIMIT_BYTES,
  });

  // 注册 CORS
  // 不启用 credentials:跨域调用方(扩展 side panel/service worker、vite 代理后的前端)
  // 均走同源或请求时不带 cookie,无需跨域凭证。关键:credentials:true 与 origin:'*' 组合
  // 违反 CORS 规范——带凭证时 allow-origin 必须是具体值而非通配 *,否则浏览器拒绝预检,
  // 表现为扩展 POST(触发预检)Failed to fetch,而 GET(简单请求无预检)正常通过。
  await fastify.register(cors, {
    origin: config.corsOrigin,
    credentials: false,
  });

  // Private Network Access(PNA):允许扩展(chrome-extension:// origin)跨域访问本地后端。
  // Chrome 142+ 的 Local Network Access 对"扩展页/公网页 → localhost(私有网络)"做 PNA 预检,
  // 要求预检响应 access-control-allow-private-network: true,否则实际请求被浏览器拦截
  // (表现为 Failed to fetch,请求不到达后端)。@fastify/cors 不处理此头,故用 onSend hook 补上。
  fastify.addHook('onSend', async (request, reply, payload) => {
    if (request.headers['access-control-request-private-network'] === 'true') {
      reply.header('access-control-allow-private-network', 'true');
    }
    return payload;
  });

  // 接受扩展以 text/plain 发送 JSON。扩展(chrome-extension://)经 service worker 访问 localhost,
  // 若用 application/json 会触发 CORS 预检,而 PNA(Private Network Access)会拦截到私有网络
  // (localhost)的预检请求 → Failed to fetch。改用 text/plain:CORS 简单请求不触发预检,
  // 从而不被 PNA 拦(和 GET 同层,GET 能过是铁证)。Chrome 官方文档:PNA 只 gate 触发预检的请求。
  fastify.addContentTypeParser('text/plain', { parseAs: 'string' }, (_request, body, done) => {
    try {
      const text = typeof body === 'string' ? body : body.toString('utf-8');
      done(null, JSON.parse(text));
    } catch (err) {
      done(err instanceof Error ? err : new Error('text/plain body 不是合法 JSON'));
    }
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
  await registerWebClipRoutes(fastify, webClipService);
  await registerFileRoutes(fastify);
  await registerKnowledgeRoutes(fastify, knowledgeService);
  await registerVocabRoutes(fastify, vocabService);
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

/** 打印 ready 横幅(成功监听后) */
function printReady(config: HttpServerConfig) {
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
}

/** 把 listen 阶段的非 EADDRINUSE 错误翻译成友好提示(EADDRINUSE 由重试逻辑接管) */
function reportListenError(code: string | undefined, config: HttpServerConfig, err: unknown) {
  if (code === 'EACCES') {
    console.error('');
    console.error(`✗ 没有权限监听端口 ${config.port}`);
    console.error('  小于 1024 的端口需要管理员权限,建议换 3000 / 8080 等');
    console.error('');
  } else {
    console.error('');
    console.error(`✗ 启动失败: ${(err as Error)?.message ?? String(err)}`);
    console.error('');
  }
}

/** listen 被抢占时的最大重试次数(每次顺延一个端口) */
const LISTEN_RETRY_ATTEMPTS = 5;

export async function startHttpServer(
  config: HttpServerConfig,
  taskRepository: TaskRepository,
  eventBus: EventBus,
  worktreeManager: WorktreeManager,
  chatRepository: ChatRepository,
  chatService: ChatService,
  llmConfigService: LlmConfigService,
  webClipService: WebClipService,
  knowledgeService: KnowledgeService,
  vocabService: VocabService,
) {
  // currentConfig 在重试中会被替换为顺延后的端口;config 保留原始值用于日志。
  let currentConfig = config;

  for (let attempt = 0; attempt < LISTEN_RETRY_ATTEMPTS; attempt++) {
    const server = await createHttpServer(currentConfig, taskRepository, eventBus, worktreeManager, chatRepository, chatService, llmConfigService, webClipService, knowledgeService, vocabService);
    try {
      await server.listen({ port: currentConfig.port, host: currentConfig.host });
      printReady(currentConfig);
      return server;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      // 非端口占用(权限不足等):不重试,直接友好报错退出
      if (code !== 'EADDRINUSE') {
        reportListenError(code, currentConfig, err);
        process.exit(1);
      }
      // EADDRINUSE:TOCTOU 竞态(startApp 探测端口空闲 → fastify 初始化期间被其他进程抢占)。
      // 关闭当前 server,顺延到下一个空闲端口重建重试,避免直接退出。
      await server.close().catch(() => {});
      let nextPort: number;
      try {
        nextPort = await findAvailablePort(currentConfig.port + 1, currentConfig.host, 20);
      } catch {
        console.error('');
        console.error(`✗ 端口 ${currentConfig.port} 被占,且后续 20 个端口均无空闲`);
        console.error('  建议清理残留进程(taskkill /IM node.exe /F)后重试');
        console.error('');
        process.exit(1);
      }
      if (attempt === 0) {
        console.log(`⚠ 端口 ${config.port} 在 listen 时被占用(启动竞态),自动顺延重试`);
      }
      console.log(`  重试 ${attempt + 1}/${LISTEN_RETRY_ATTEMPTS}: ${currentConfig.port} → ${nextPort}`);
      currentConfig = { ...currentConfig, port: nextPort };
    }
  }

  console.error('');
  console.error(`✗ 连续 ${LISTEN_RETRY_ATTEMPTS} 次监听都被抢占(端口 ${config.port} 附近持续竞争)`);
  console.error('  这通常意味着机器上有大量残留 node 进程轮流抢端口');
  console.error('  建议:taskkill /IM node.exe /F 清理后重试');
  console.error('');
  process.exit(1);
}
