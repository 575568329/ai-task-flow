// backend/src/interfaces/http/routes/usageRoutes.ts
// Token 用量面板的 HTTP 接口。
import type { FastifyInstance } from 'fastify';
import type { UsageService } from '../../../application/usage/UsageService.js';
import type { UsageSummaryQuery } from '@ai-task-flow/shared';

export async function registerUsageRoutes(fastify: FastifyInstance, usageService: UsageService) {
  // GET /api/usage/summary - 五维度用量聚合(模型/任务/项目/天/会话)
  //   query: project(repoPath 精确匹配) / taskId / from / to(YYYY-MM-DD 本地日期,含端点)
  fastify.get<{ Querystring: Record<string, string | undefined> }>(
    '/api/usage/summary',
    async (request, reply) => {
      const q = request.query;
      const query: UsageSummaryQuery = {
        project: q.project,
        taskId: q.taskId,
        from: q.from,
        to: q.to,
      };
      try {
        return reply.send(await usageService.getSummary(query));
      } catch (error) {
        const message = error instanceof Error ? error.message : '用量聚合失败';
        request.log.error({ err: error }, '[usageRoutes] getSummary 失败');
        return reply.status(500).send({ error: message });
      }
    },
  );
}
