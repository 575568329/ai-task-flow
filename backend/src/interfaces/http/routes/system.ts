// backend/src/interfaces/http/routes/system.ts
// system 路由(worklog 转型 Step1 裁剪后):仅保留存储占用监控 + 按类清理。
// select-directory/claude-sessions/open/mcp-setup/agent-runtime 端点已随
// 看板/聊天链路砍除(其唯一前端消费者 board/floating/McpHelpPanel 均已删)。
import { FastifyInstance } from 'fastify';
import { StorageService } from '../../../application/system/StorageService.js';
import type { StorageClearRequest } from '@ai-task-flow/shared';

export async function registerSystemRoutes(fastify: FastifyInstance) {
  // ===== 存储占用监控 + 按类清理 =====
  // StorageService 无状态、无依赖,直接实例化。
  const storageService = new StorageService();

  // GET /api/system/storage — 各数据文件/目录占用 + 总占用 + 告警标志
  fastify.get('/api/system/storage', async () => {
    return storageService.getStorage();
  });

  // POST /api/system/storage/clear — 按类别清理(仅 clearable 项生效;业务数据被忽略)
  fastify.post<{ Body: StorageClearRequest }>(
    '/api/system/storage/clear',
    async (request, reply) => {
      const { categories } = request.body ?? {};
      if (!Array.isArray(categories)) {
        return reply.status(400).send({ error: 'categories 必须为数组' });
      }
      const { results, storage } = await storageService.clearCategories(categories);
      return { results, storage };
    },
  );
}
