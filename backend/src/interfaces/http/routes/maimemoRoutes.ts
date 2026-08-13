// backend/src/interfaces/http/routes/maimemoRoutes.ts
import type { FastifyInstance } from 'fastify';
import { MaimemoService, MaimemoNotConfiguredError } from '../../../application/maimemo/MaimemoService.js';
import type { SaveMaimemoConfigDTO } from '@ai-task-flow/shared';

/**
 * 墨墨同步 REST API
 * - GET    /api/maimemo/config         获取脱敏配置
 * - PUT    /api/maimemo/config         保存 token（空=保持原值）
 * - POST   /api/maimemo/config/test    测试连接（节流，固定文案）
 * - POST   /api/maimemo/sync/notepad   同步云词本（全量替换）
 * - POST   /api/maimemo/sync/study     加入学习计划
 * - GET    /api/maimemo/progress       学习进度（5min 缓存，?force=1 强制刷新）
 */
export async function registerMaimemoRoutes(fastify: FastifyInstance, maimemoService: MaimemoService) {
  // GET /api/maimemo/config - 脱敏配置
  fastify.get('/api/maimemo/config', async () => {
    return maimemoService.getMaskedConfig();
  });

  // PUT /api/maimemo/config - 保存 token
  fastify.put<{ Body: SaveMaimemoConfigDTO }>('/api/maimemo/config', async (request) => {
    const body = request.body ?? {};
    return maimemoService.saveConfig({ token: typeof body.token === 'string' ? body.token : undefined });
  });

  // POST /api/maimemo/config/test - 测试连接（固定文案，不回吐上游原文）
  fastify.post('/api/maimemo/config/test', async () => {
    return maimemoService.testConnection();
  });

  // POST /api/maimemo/sync/notepad - 同步云词本
  fastify.post('/api/maimemo/sync/notepad', async (request, reply) => {
    try {
      return await maimemoService.syncToNotepad();
    } catch (error) {
      return mapMaimemoError(reply, error);
    }
  });

  // POST /api/maimemo/sync/study - 加入学习计划
  fastify.post('/api/maimemo/sync/study', async (request, reply) => {
    try {
      return await maimemoService.syncToStudyPlan();
    } catch (error) {
      return mapMaimemoError(reply, error);
    }
  });

  // GET /api/maimemo/progress - 学习进度（?force=1 强制刷新）
  fastify.get<{ Querystring: { force?: string } }>('/api/maimemo/progress', async (request, reply) => {
    try {
      return await maimemoService.getStudyProgress(request.query.force === '1');
    } catch (error) {
      return mapMaimemoError(reply, error);
    }
  });
}

/** 统一映射墨墨错误到 HTTP 状态码 + 文案 */
function mapMaimemoError(reply: any, error: unknown): any {
  if (error instanceof MaimemoNotConfiguredError) {
    return reply.status(400).send({ error: error.message });
  }
  const message = error instanceof Error ? error.message : '墨墨同步失败';
  return reply.status(500).send({ error: message });
}
