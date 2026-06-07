// backend/src/http-server.ts
import 'reflect-metadata';
import { startHttpServer } from './interfaces/http/server.js';
import { JsonTaskRepository } from './infrastructure/persistence/JsonTaskRepository.js';
import { InMemoryEventBus } from './infrastructure/pubsub/EventBus.js';
import { JsonEventStore } from './infrastructure/pubsub/EventStore.js';
import { WorktreeManager } from './infrastructure/git/WorktreeManager.js';
import { findAvailablePort } from './utils/port-finder.js';
import { resolveDataDir, taskDocPath } from './config/dataDir.js';
import { writeTaskDoc } from './infrastructure/persistence/taskDoc.js';
import fs from 'node:fs';
import path from 'node:path';

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
   * 自定义上传目录。默认 {dataDir}/uploads
   */
  uploadsDir?: string;
  /**
   * 自定义数据根目录。默认 ~/.ai-task-flow
   * 优先级最高,会贯穿 tasks.json / events.jsonl / uploads / tasks 存档。
   */
  dataDir?: string;
}

/**
 * 程序化启动入口。CLI 与脚手架直接调用此函数,不再 spawn 子进程。
 * 返回已就绪的 Fastify 实例,可用于优雅关闭。
 */
export async function startApp(options: StartAppOptions = {}) {
  // 先锁定数据根目录(优先级:显式参数 > 环境变量 > 默认 ~/.ai-task-flow),
  // 后续所有持久化模块都从 config/dataDir 读取同一份路径。
  const dataDir = resolveDataDir(options.dataDir);

  const eventBus = new InMemoryEventBus();
  const eventStore = new JsonEventStore();
  const taskRepository = new JsonTaskRepository(options.dataFile, eventBus, eventStore);
  const worktreeManager = new WorktreeManager();

  // 一次性补齐:给历史任务(本次改动前创建、还没 md 存档的)补写 markdown 文件,
  // 让它们的派发指令也能指向真实存在的文件。只补缺失,不覆盖已有。
  try {
    const existing = await taskRepository.findAll();
    for (const task of existing) {
      if (!fs.existsSync(taskDocPath(task.id.value))) {
        await writeTaskDoc(task);
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`! 任务 markdown 存档补齐失败(不影响启动): ${message}`);
  }

  const preferredPort = options.port ?? parseInt(process.env.PORT || '3000', 10);
  const host = options.host ?? process.env.HOST ?? '0.0.0.0';

  // 自动查找可用端口（开发模式需要，CLI 已在外层处理）
  const actualPort = await findAvailablePort(preferredPort, host);

  if (actualPort !== preferredPort) {
    console.log(`\n⚠ 端口 ${preferredPort} 被占用，已切换到 ${actualPort}\n`);
  }

  // 将实际端口写入临时文件，供 frontend vite.config.ts 读取
  const logsDir = path.join(process.cwd(), '.logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  fs.writeFileSync(path.join(logsDir, 'backend-port.txt'), actualPort.toString(), 'utf-8');

  const config = {
    port: actualPort,
    host,
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
