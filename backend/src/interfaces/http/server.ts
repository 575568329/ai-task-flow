// backend/src/interfaces/http/server.ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { uploadsDirPath } from '../../config/dataDir.js';
import { findAvailablePort } from '../../utils/port-finder.js';
import { registerUploadRoutes } from './routes/uploadRoutes.js';
import { registerFileRoutes } from './routes/fileRoutes.js';
import { registerKnowledgeRoutes } from './routes/knowledgeRoutes.js';
import { registerSystemRoutes } from './routes/system.js';
import { isLocalAccess } from '../../utils/localAccess.js';
import { DomainError } from '../../domain/_shared/DomainError.js';
import type { LlmConfigService } from '../../application/llm-config/LlmConfigService.js';
import type { WebClipService } from '../../application/webclip/WebClipService.js';
import type { KnowledgeService } from '../../application/knowledge/KnowledgeService.js';
import type { MindmapService } from '../../application/mindmap/MindmapService.js';
import type { WorklogService } from '../../application/worklog/WorklogService.js';
import type { ConclusionService } from '../../application/conclusion/ConclusionService.js';
import { registerLlmConfigRoutes } from './routes/llmConfigRoutes.js';
import { registerWebClipRoutes } from './routes/webClipRoutes.js';
import { registerClaudeProfileRoutes } from './routes/claudeProfileRoutes.js';
import { registerMindmapRoutes } from './routes/mindmapRoutes.js';
import { registerWorklogRoutes } from './routes/worklogRoutes.js';
import { registerConclusionRoutes } from './routes/conclusionRoutes.js';
import { HANDLERS } from '../mcp/tools/index.js';
import type { ToolDeps } from '../mcp/tools/types.js';
import { ClaudeProfileService } from '../../application/claude-profile/ClaudeProfileService.js';
import { JsonClaudeProfileRepository } from '../../infrastructure/persistence/JsonClaudeProfileRepository.js';

/** Claude Code settings.json 多套配置切换(无外部依赖,模块级单例即可) */
const claudeProfileService = new ClaudeProfileService(new JsonClaudeProfileRepository());

/** 请求体上限。扩展网页剪藏会把多张图片以 base64 编码塞进请求体，远超 Fastify 默认 1MB，
 *  否则后端返回 413 Payload Too Large。25MB 覆盖常见多图场景；图片传输优化后可调小。 */
const BODY_LIMIT_BYTES = 25 * 1024 * 1024;

export interface HttpServerConfig {
  port: number;
  host: string;
  /**
   * 允许跨域/跨站的来源白名单。`false`(默认)= 完全不放开跨站访问。
   * uTools 插件、桌面版、dev 代理都是同源,无需配置;
   * 只有浏览器扩展等真正跨域场景才显式配置(CORS_ORIGIN)。
   */
  corsOrigin: string | string[] | false;
  /** 前端打包产物目录(含 index.html)。传入则单端口托管 SPA。 */
  frontendDist?: string;
  /** 上传目录,默认 ~/.ai-task-flow/uploads */
  uploadsDir?: string;
}

/** 浏览器发起的同源本地页面(桌面版/dev/插件)来源主机名 */
const LOCAL_ORIGIN_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** 把配置的来源声明归一成字符串数组(支持逗号分隔与数组) */
function normalizeOrigins(value: string | string[] | false): string[] {
  if (value === false) return [];
  const list = Array.isArray(value) ? value : value.split(',');
  return list.map((item) => item.trim()).filter(Boolean);
}

/**
 * 跨站请求是否放行。
 * 无 Origin 头 = 非浏览器调用(curl / CLI / MCP 子进程),照旧放行;
 * 浏览器请求必须来自本机同源页面,或命中显式白名单(如 chrome-extension://<id>)。
 */
function isAllowedOrigin(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return true;
  if (allowed.includes('*') || allowed.includes(origin)) return true;
  try {
    return LOCAL_ORIGIN_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/** 解析上传目录,默认放在用户数据目录下 */
function resolveUploadsDir(custom?: string): string {
  if (custom) return custom;
  return uploadsDirPath();
}

export async function createHttpServer(
  config: HttpServerConfig,
  llmConfigService: LlmConfigService,
  webClipService: WebClipService,
  knowledgeService: KnowledgeService,
  mindmapService: MindmapService,
  worklogService: WorklogService,
  conclusionService: ConclusionService,
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
  // 默认关闭:本产品所有前端(uTools 插件/桌面版/vite 代理)都与后端同源,不需要 CORS。
  // 历史默认 '*' + PNA 放行等于允许任意网页读取本机数据(一条 /api/knowledge/export 就能导出
  // 整个知识库),因此改为「显式配置才放开」。
  const allowedOrigins = normalizeOrigins(config.corsOrigin);
  await fastify.register(cors, {
    origin: allowedOrigins.length > 0 ? config.corsOrigin : false,
    credentials: false,
  });

  // 跨站写保护:CORS 只拦"能否读响应",拦不住 text/plain / 表单这类简单请求直接写数据。
  // 这里再按 Origin 头拦一道(浏览器一定会带 Origin),把「公网页面 → 本机 API」整类请求挡掉。
  fastify.addHook('onRequest', async (request, reply) => {
    if (request.method === 'OPTIONS') return; // 预检交给 CORS 插件
    if (!isAllowedOrigin(request.headers.origin, allowedOrigins)) {
      return reply.status(403).send({ error: '拒绝跨站访问:来源不在白名单内' });
    }
  });

  // Private Network Access(PNA):仅在显式放开跨站时补头,否则浏览器不该允许公网页面访问本机。
  // Chrome 142+ 对"扩展页/公网页 → localhost(私有网络)"做 PNA 预检,
  // 要求预检响应 access-control-allow-private-network: true,否则实际请求被拦截。
  if (allowedOrigins.length > 0) {
    fastify.addHook('onSend', async (request, reply, payload) => {
      if (request.headers['access-control-request-private-network'] === 'true') {
        reply.header('access-control-allow-private-network', 'true');
      }
      return payload;
    });
  }

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
    const localAccess = isLocalAccess(request.ip);
    return {
      status: 'ok',
      service: 'ai-task-flow',
      web: hasWeb,
      localAccess,
      // uTools 插件用它判断"端口上跑的是不是同一份构建":版本不同就不复用旧实例,
      // 否则升级插件后页面仍会连到旧 backend,看到的是旧界面。
      buildId: process.env.AI_TASK_FLOW_BUILD_ID ?? '',
      timestamp: new Date().toISOString(),
    };
  });

  // 注册业务路由(worklog 转型 Step1:任务/聊天/SSE/项目选择/usage 路由已砍除)
  await registerUploadRoutes(fastify, uploadsDir);
  await registerLlmConfigRoutes(fastify, llmConfigService);
  await registerWebClipRoutes(fastify, webClipService);
  await registerFileRoutes(fastify);
  await registerKnowledgeRoutes(fastify, knowledgeService);
  await registerMindmapRoutes(fastify, mindmapService);
  await registerWorklogRoutes(fastify, worklogService);
  await registerConclusionRoutes(fastify, conclusionService, worklogService);
  await registerSystemRoutes(fastify);
  await registerClaudeProfileRoutes(fastify, claudeProfileService);

  // uTools 内置 MCP 的桥接端点:复用 stdio MCP 的同一套 handler,避免两套业务逻辑漂移。
  // 只接受白名单工具名;仅本机调用;args 由 handler 内各自校验。
  fastify.post<{
    Params: { name: string };
    Body: { args?: Record<string, unknown>; conversationId?: string; sourcePath?: string };
  }>('/api/tools/:name', async (request, reply) => {
    if (!isLocalAccess(request.ip)) {
      return reply.status(403).send({ error: '仅允许本机调用工具' });
    }
    const handler = HANDLERS[request.params.name];
    if (!handler) {
      return reply.status(404).send({ error: `未知工具: ${request.params.name}` });
    }
    const body = request.body ?? {};
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return reply.status(400).send({ error: '请求体必须为 JSON 对象' });
    }
    const args = body.args ?? {};
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      return reply.status(400).send({ error: 'args 必须为 JSON 对象' });
    }
    const deps: ToolDeps = {
      knowledgeService,
      worklogService,
      conclusionService,
      mcpSource: {
        tool: 'utools',
        ...(typeof body.conversationId === 'string' && body.conversationId.trim()
          ? { conversationId: body.conversationId.trim() }
          : {}),
        ...(typeof body.sourcePath === 'string' && body.sourcePath.trim()
          ? { cwd: body.sourcePath.trim() }
          : {}),
      },
    };
    // handler 自己把异常包成 isError:true 的 MCP 文本结果;原样返回给 preload 判断
    return handler(args, deps);
  });

  // 全局错误处理(P1-16 + P2-20):未捕获的抛错统一转 JSON。
  // 优先级:DomainError.httpStatus(业务 4xx/5xx 精准) > Fastify statusCode(校验 4xx) > 默认 500。
  fastify.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    const statusCode =
      error instanceof DomainError
        ? error.httpStatus
        : typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 600
          ? error.statusCode
          : 500;
    if (statusCode >= 500) {
      fastify.log.error(error, `未处理错误 ${request.method} ${request.url}`);
    } else {
      fastify.log.warn({ statusCode, url: request.url }, error.message);
    }
    reply.status(statusCode).send({ error: error.message || 'Internal Server Error', statusCode });
  });

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
    console.error('  小于 1024 的端口需要管理员权限,建议换 47821 / 8080 等');
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
  llmConfigService: LlmConfigService,
  webClipService: WebClipService,
  knowledgeService: KnowledgeService,
  mindmapService: MindmapService,
  worklogService: WorklogService,
  conclusionService: ConclusionService,
) {
  // currentConfig 在重试中会被替换为顺延后的端口;config 保留原始值用于日志。
  let currentConfig = config;

  for (let attempt = 0; attempt < LISTEN_RETRY_ATTEMPTS; attempt++) {
    const server = await createHttpServer(currentConfig, llmConfigService, webClipService, knowledgeService, mindmapService, worklogService, conclusionService);
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
