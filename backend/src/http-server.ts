// backend/src/http-server.ts
import 'reflect-metadata';
import { startHttpServer } from './interfaces/http/server.js';
import { JsonTaskRepository } from './infrastructure/persistence/JsonTaskRepository.js';
import { InMemoryEventBus } from './infrastructure/pubsub/EventBus.js';
import { JsonEventStore } from './infrastructure/pubsub/EventStore.js';
import { WorktreeManager } from './infrastructure/git/WorktreeManager.js';

export interface StartAppOptions {
  /** HTTP 监听端口,默认 3000 */
  port?: number;
  /** HTTP 监听地址,默认 0.0.0.0 */
  host?: string;
  /** CORS 允许源,默认 * */
  corsOrigin?: string | string[];
  /**
   * 前端打包产物目录(含 index.html)。
   * 传入则启用 SPA 静态托管 + 同源 API。生产模式由 CLI 注入。
   * dev 模式留空即可。
   */
  frontendDist?: string;
  /**
   * 自定义 tasks.json 路径。默认 ~/.ai-task-flow/tasks.json
   */
  dataFile?: string;
  /**
   * 自定义上传目录。默认 ~/.ai-task-flow/uploads
   */
  uploadsDir?: string;
}

/**
 * 程序化启动入口。CLI 与脚手架直接调用此函数,不再 spawn 子进程。
 * 返回已就绪的 Fastify 实例,可用于优雅关闭。
 */
export async function startApp(options: StartAppOptions = {}) {
  const eventBus = new InMemoryEventBus();
  const eventStore = new JsonEventStore();
  const taskRepository = new JsonTaskRepository(options.dataFile, eventBus, eventStore);
  const worktreeManager = new WorktreeManager();

  const config = {
    port: options.port ?? parseInt(process.env.PORT || '3000', 10),
    host: options.host ?? process.env.HOST ?? '0.0.0.0',
    corsOrigin: options.corsOrigin ?? process.env.CORS_ORIGIN ?? '*',
    frontendDist: options.frontendDist,
    uploadsDir: options.uploadsDir,
  };

  return startHttpServer(config, taskRepository, eventBus, worktreeManager);
}

// 当作为脚本直接执行时(npm run http / dev),立即启动
const isDirectRun = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`
  || process.argv[1]?.endsWith('http-server.ts')
  || process.argv[1]?.endsWith('http-server.js');

if (isDirectRun) {
  startApp().catch((error) => {
    console.error('Failed to start HTTP server:', error);
    process.exit(1);
  });
}
