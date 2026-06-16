// backend/src/interfaces/http/routes/webClipRoutes.ts
import { FastifyInstance } from 'fastify';
import type { WebClipService } from '../../../application/webclip/WebClipService.js';
import type { ClipRequest } from '@ai-task-flow/shared';

/**
 * 网页剪藏路由:浏览器扩展 → POST /api/tasks/clip → AI 拆解 → 返回任务草案。
 * 草案不落库,等用户在前端确认后,再走 POST /api/tasks 正式建任务。
 */
export async function registerWebClipRoutes(
  fastify: FastifyInstance,
  webClipService: WebClipService,
) {
  fastify.post<{ Body: ClipRequest }>('/api/tasks/clip', async (request, reply) => {
    const { sourceUrl, title, content, images } = request.body;
    if (!sourceUrl || !content?.text) {
      return reply.status(400).send({ error: 'sourceUrl 和 content.text 必填' });
    }
    try {
      const result = await webClipService.clip({ sourceUrl, title, content, images });
      return reply.send(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      // 未配置 LLM 等业务错误 → 400;其余 → 500
      const status = /API Key/.test(message) ? 400 : 500;
      return reply.status(status).send({ error: message });
    }
  });
}
