// backend/src/interfaces/http/routes/mindmapRoutes.ts
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  MindmapConflictError,
  MindmapLimitExceededError,
  MindmapNotFoundError,
  MindmapService,
  MindmapValidationError,
} from '../../../application/mindmap/MindmapService.js';
import type { MindmapCreateDTO, MindmapUpdateDTO } from '@ai-task-flow/shared';
import { FileLogger } from '../../../infrastructure/logging/FileLogger.js';

const logger = new FileLogger('mindmap-route');

/**
 * 统一把领域错误映射到 HTTP 状态码（仿 maimemoRoutes 的 mapMaimemoError 模式）。
 * 错误体统一为 { error: string }，前端 http.ts 据此 toast。
 */
function mapMindmapError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof MindmapNotFoundError) return reply.status(404).send({ error: error.message });
  if (error instanceof MindmapConflictError) return reply.status(409).send({ error: error.message });
  if (error instanceof MindmapValidationError) return reply.status(400).send({ error: error.message });
  if (error instanceof MindmapLimitExceededError) return reply.status(400).send({ error: error.message });
  // 非预期错误：记录日志后 rethrow，交由 Fastify 兜底 500
  logger.error('mindmap 路由未预期错误', { error: error instanceof Error ? error.message : String(error) });
  throw error;
}

/**
 * 注册思维导图 REST 路由。
 * 前缀 /api/mindmaps，遵循项目约定：手动校验 body、错误体 { error }、无 envelope。
 */
export async function registerMindmapRoutes(fastify: FastifyInstance, mindmapService: MindmapService) {
  // GET /api/mindmaps - 列表（仅 meta，nodeCount 冗余存储不解析 nodes）
  fastify.get('/api/mindmaps', async () => {
    return mindmapService.listMindmaps();
  });

  // POST /api/mindmaps - 新建（含默认根节点）
  fastify.post<{ Body: MindmapCreateDTO }>('/api/mindmaps', async (request, reply) => {
    try {
      const doc = await mindmapService.createMindmap(request.body ?? {});
      return reply.status(201).send(doc);
    } catch (error) {
      return mapMindmapError(reply, error);
    }
  });

  // GET /api/mindmaps/:id - 获取完整文档（含 nodes/edges/viewport）
  fastify.get<{ Params: { id: string } }>('/api/mindmaps/:id', async (request, reply) => {
    try {
      return await mindmapService.getMindmap(request.params.id);
    } catch (error) {
      return mapMindmapError(reply, error);
    }
  });

  // PATCH /api/mindmaps/:id - 部分更新（乐观锁 + 图结构校验）
  fastify.patch<{ Params: { id: string }; Body: MindmapUpdateDTO }>('/api/mindmaps/:id', async (request, reply) => {
    try {
      return await mindmapService.updateMindmap(request.params.id, request.body ?? {});
    } catch (error) {
      return mapMindmapError(reply, error);
    }
  });

  // DELETE /api/mindmaps/:id - 硬删（前端配撤销 toast 兜底误删）
  fastify.delete<{ Params: { id: string } }>('/api/mindmaps/:id', async (request, reply) => {
    try {
      await mindmapService.deleteMindmap(request.params.id);
      return reply.status(204).send();
    } catch (error) {
      return mapMindmapError(reply, error);
    }
  });

  // POST /api/mindmaps/:id/duplicate - 复制（新 id / 标题加" 副本"）
  fastify.post<{ Params: { id: string } }>('/api/mindmaps/:id/duplicate', async (request, reply) => {
    try {
      const doc = await mindmapService.duplicateMindmap(request.params.id);
      return reply.status(201).send(doc);
    } catch (error) {
      return mapMindmapError(reply, error);
    }
  });
}
