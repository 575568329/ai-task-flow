// backend/src/http-server.ts
import { startHttpServer } from './interfaces/http/server.js';
import { findAvailablePort } from './utils/port-finder.js';
import { resolveDataDir } from './config/dataDir.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonLlmConfigRepository } from './infrastructure/persistence/JsonLlmConfigRepository.js';
import { LlmConfigService } from './application/llm-config/LlmConfigService.js';
import { WebClipService } from './application/webclip/WebClipService.js';
import { KnowledgeService } from './application/knowledge/KnowledgeService.js';
import { JsonMindmapRepository } from './infrastructure/persistence/JsonMindmapRepository.js';
import { MindmapService } from './application/mindmap/MindmapService.js';
import { JsonWorklogRepository } from './infrastructure/persistence/JsonWorklogRepository.js';
import { WorklogService } from './application/worklog/WorklogService.js';
import { JsonConclusionRepository } from './infrastructure/persistence/JsonConclusionRepository.js';
import { ConclusionService } from './application/conclusion/ConclusionService.js';
import { runProjectIdMigration, shouldSuggestPathBinding } from './application/migration/ProjectIdMigration.js';
import {
  runFlatEntriesMigration,
  runProgramLayerMigration,
  runVersionTreeMigration,
} from './application/migration/VersionTreeMigration.js';
import {
  knowledgeDirPath,
  worklogFilePath,
  worklogBackupsDirPath,
  conclusionFilePath,
  conclusionBackupsDirPath,
} from './config/dataDir.js';

export interface StartAppOptions {
  /** HTTP 监听端口,默认 47821 */
  port?: number;
  /** HTTP 监听地址,默认 127.0.0.1 */
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
   * 自定义上传目录。默认 {dataDir}/uploads
   */
  uploadsDir?: string;
  /**
   * 自定义数据根目录。默认 ~/.ai-task-flow
   * 优先级最高,贯穿全部持久化模块。
   */
  dataDir?: string;
}

/**
 * 程序化启动入口。CLI 与脚手架直接调用此函数,不再 spawn 子进程。
 * 返回已就绪的 Fastify 实例,可用于优雅关闭。
 */
export async function startApp(options: StartAppOptions = {}) {
  // 先锁定数据根目录(优先级:显式参数 > 环境变量 > 默认 ~/.ai-task-flow),
  // 后续所有持久化模块都从 config/dataDir 读取同一份路径;迁移直接用此变量。
  const dataDir = resolveDataDir(options.dataDir);

  const llmConfigRepository = new JsonLlmConfigRepository();
  const llmConfigService = new LlmConfigService(llmConfigRepository);
  await llmConfigService.init();
  // 网页剪藏服务(存图 + LLM 拆解 + 回退),复用 LLM 配置
  const webClipService = new WebClipService(llmConfigService);
  // 知识库服务
  const knowledgeService = new KnowledgeService(knowledgeDirPath());

  // 思维导图服务（无外部依赖，repo + service 直接装配）
  const mindmapRepository = new JsonMindmapRepository();
  const mindmapService = new MindmapService(mindmapRepository);

  // 工作记录服务(项目→版本→功能点;写协议=进程内 mutex + 跨进程文件锁,见 JsonWorklogRepository)
  // 仓储提为局部变量:迁移要直接复用同一实例,避免访问 Service 私有字段
  const worklogRepository = new JsonWorklogRepository(
    worklogFilePath(options.dataDir),
    worklogBackupsDirPath(options.dataDir),
  );
  const worklogService = new WorklogService(worklogRepository);

  // 结论卡服务(项目/版本/个人 + 逐版完整快照;HTTP 与 MCP 共享同一存储协议)
  const conclusionRepository = new JsonConclusionRepository(
    conclusionFilePath(options.dataDir),
    conclusionBackupsDirPath(options.dataDir),
  );
  const conclusionService = new ConclusionService(conclusionRepository);

  // 一次性数据迁移:给缺 id 的旧项目补稳定身份,并把结论卡按项目名绑定到项目 id。
  // 只有 HTTP 进程执行(MCP 进程不接入);迁移自身幂等 + 跨进程锁。
  // 启动路径上失败一律降级跳过:迁移失败不应阻止后端启动,下次启动会重跑。
  try {
    const migration = await runProjectIdMigration({
      dataDir,
      worklogRepo: worklogRepository,
      conclusionRepo: conclusionRepository,
    });
    // 标记已到版本时通常无事可做;但只要本次自愈补了 id 也要留痕(便于排查)
    if (!migration.skipped || migration.assignedIds > 0) {
      console.log(
        `[migration] 补项目 id ${migration.assignedIds} 个；绑定结论卡 ${migration.boundConclusions} 张；` +
          `重名项目: ${migration.duplicateNames.join(', ') || '无'}；歧义跳过 ${migration.skippedAmbiguous} 张` +
          (migration.skipped ? '（结论卡绑定已迁移过，本次仅自愈补 id）' : ''),
      );
    }
    // 只在本次确实迁移了内容时提示,避免每次启动刷屏
    if (shouldSuggestPathBinding(migration)) {
      console.log('[migration] 建议在页面为项目绑定本地路径（工作记录 › 项目右键 › 绑定路径）');
    }
  } catch (error: unknown) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`[migration] 项目 id 迁移失败,已跳过(不影响启动): ${detail}`);
  }

  // 一次性数据迁移:旧结构「项目 → 版本 → 条目」归并为「版本 → 需求 → 条目」。
  // 放在项目 id 迁移之后(条目要带 projectId)、HTTP 启动之前;幂等,失败不阻塞启动。
  try {
    const vReport = await runVersionTreeMigration({ dataDir, worklogRepo: worklogRepository });
    if (!vReport.skipped && (vReport.versionsCreated || vReport.entriesMoved)) {
      console.log(`[migration] 版本归并 ${vReport.versionsCreated} 个、条目 ${vReport.entriesMoved} 条`);
    }
  } catch (error: unknown) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`[migration] 版本归并失败,已跳过(不影响启动): ${detail}`);
  }

  // 一次性数据迁移(续):把版本下「澳门底层数据建设」需求提升为顶层建设主题,并回填版本 programId。
  // 放在版本归并之后(需求已就位)、HTTP 启动之前;幂等,失败不阻塞启动。
  try {
    const pReport = await runProgramLayerMigration({ dataDir, worklogRepo: worklogRepository });
    if (!pReport.skipped && (pReport.programsCreated || pReport.versionsAssigned)) {
      console.log(
        `[migration] 建设主题 ${pReport.programsCreated} 个、归属版本 ${pReport.versionsAssigned} 个`,
      );
    }
  } catch (error: unknown) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`[migration] 建设主题迁移失败,已跳过(不影响启动): ${detail}`);
  }

  // 一次性数据迁移(续):把需求下的条目提升到版本,移除需求层。
  // 放在建设主题层之后(programId 已回填)、HTTP 启动之前;幂等,失败不阻塞启动。
  try {
    const fReport = await runFlatEntriesMigration({ dataDir, worklogRepo: worklogRepository });
    if (!fReport.skipped && (fReport.entriesMerged || fReport.versionsFlattened)) {
      console.log(
        `[migration] 条目扁平化:${fReport.versionsFlattened} 个版本、${fReport.entriesMerged} 条条目`,
      );
    }
  } catch (error: unknown) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`[migration] 条目扁平化失败,已跳过(不影响启动): ${detail}`);
  }

  const preferredPort = options.port ?? parseInt(process.env.PORT || '47821', 10);
  // 默认仅监听本机回环:服务无鉴权,0.0.0.0 会让同网段任意主机可调全部接口。
  // 需要局域网访问时显式 HOST=0.0.0.0 启动(仅限隔离网络)。
  const host = options.host ?? process.env.HOST ?? '127.0.0.1';
  if (host === '0.0.0.0' || host === '::') {
    console.warn(
      `⚠️  监听 ${host}:服务无鉴权,同网段可访问全部接口。仅限隔离网络。`,
    );
  }

  // 自动查找可用端口（开发模式需要，CLI 已在外层处理）
  const actualPort = await findAvailablePort(preferredPort, host);

  if (actualPort !== preferredPort) {
    console.log(`\n⚠ 端口 ${preferredPort} 被占用，已切换到 ${actualPort}\n`);
  }

  const config = {
    port: actualPort,
    host,
    corsOrigin: options.corsOrigin ?? process.env.CORS_ORIGIN ?? '*',
    frontendDist: options.frontendDist,
    uploadsDir: options.uploadsDir,
  };

  const server = await startHttpServer(config, llmConfigService, webClipService, knowledgeService, mindmapService, worklogService, conclusionService);

  // 仅 dev 模式(前后端分离, 无 frontendDist)需要把实际端口写给 vite 读。
  // 必须在 startHttpServer 返回后写:startHttpServer 可能因启动竞态(TOCTUU)进一步顺延端口,
  // 以 server 实际监听端口为准,否则 vite 代理会落到旧端口连不上。
  // 路径基于本模块位置解析到仓库根的 .logs/, 不依赖 process.cwd()——
  // 否则 `cd backend && npm run dev` 会把文件写到 backend/.logs, 而 vite 读的是根 .logs, 两边对不上。
  if (!options.frontendDist) {
    const addr = server.server.address();
    const listenedPort = typeof addr === 'object' && addr !== null ? addr.port : actualPort;
    if (listenedPort !== actualPort) {
      console.log(`⚠ 实际监听端口 ${listenedPort}(启动竞态顺延,vite 代理将跟随)\n`);
    }
    try {
      // backend/src/http-server.ts 或 backend/dist/http-server.js → 仓库根都是上溯两级
      const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
      const logsDir = path.join(repoRoot, '.logs');
      fs.mkdirSync(logsDir, { recursive: true });
      fs.writeFileSync(path.join(logsDir, 'backend-port.txt'), listenedPort.toString(), 'utf-8');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`! 写入端口文件失败(不影响后端, 仅 vite 代理可能落到默认端口): ${message}`);
    }
  }

  return server;
}

// 当作为脚本直接执行时(npm run http / dev),立即启动
const isDirectRun = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`
  || process.argv[1]?.endsWith('http-server.ts')
  || process.argv[1]?.endsWith('http-server.js');

if (isDirectRun) {
  startApp()
    .then((server) => {
      // 优雅关闭:Ctrl+C / kill 时先 server.close()(释放端口/连接)再 exit。
      let closing = false;
      const shutdown = async (sig: string) => {
        if (closing) return; // 防 Ctrl+C 连按重复触发
        closing = true;
        console.log(`\n${sig} 收到,正在优雅关闭...`);
        try {
          await server.close();
          console.log('✓ 已关闭');
        } catch (e) {
          console.error('关闭过程出错:', e);
        }
        process.exit(0);
      };
      process.on('SIGINT', () => void shutdown('SIGINT'));
      process.on('SIGTERM', () => void shutdown('SIGTERM'));
    })
    .catch((error) => {
      console.error('Failed to start HTTP server:', error);
      process.exit(1);
    });
}
