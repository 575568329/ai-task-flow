// backend/src/interfaces/http/routes/vocabRoutes.ts
import type { FastifyInstance } from 'fastify';
import {
  VocabService,
  VocabAlreadyExistsError,
  VocabNotFoundError,
} from '../../../application/vocab/VocabService.js';
import type { VocabCreateDTO, VocabListQuery, VocabUpdateDTO } from '@ai-task-flow/shared';

/** 把 Fastify 的 string query 转成 VocabListQuery（boolean/number 字段显式转换） */
function parseListQuery(raw: Record<string, string | undefined>): VocabListQuery {
  const toBool = (v: string | undefined): boolean | undefined =>
    v === 'true' ? true : v === 'false' ? false : undefined;
  return {
    kw: raw.kw,
    sourceLang: raw.sourceLang,
    mastered: toBool(raw.mastered),
    starred: toBool(raw.starred),
    page: raw.page ? Number(raw.page) : undefined,
    pageSize: raw.pageSize ? Number(raw.pageSize) : undefined,
  };
}

export async function registerVocabRoutes(fastify: FastifyInstance, vocabService: VocabService) {
  // POST /api/vocab - 新增生词（重复返回 409）
  fastify.post<{ Body: VocabCreateDTO }>('/api/vocab', async (request, reply) => {
    const body = request.body;
    if (!body?.word?.trim() || !body?.translation?.trim()) {
      return reply.status(400).send({ error: 'word 和 translation 必填' });
    }
    try {
      const vocab = await vocabService.saveVocab(body);
      return reply.status(201).send(vocab);
    } catch (error) {
      if (error instanceof VocabAlreadyExistsError) {
        return reply.status(409).send({ error: error.message });
      }
      throw error;
    }
  });

  // GET /api/vocab - 列表（搜索/筛选/分页）
  fastify.get<{ Querystring: Record<string, string | undefined> }>('/api/vocab', async (request) => {
    return vocabService.listVocab(parseListQuery(request.query as Record<string, string | undefined>));
  });

  // GET /api/vocab/:id
  fastify.get<{ Params: { id: string } }>('/api/vocab/:id', async (request, reply) => {
    try {
      return await vocabService.getVocab(request.params.id);
    } catch (error) {
      if (error instanceof VocabNotFoundError) {
        return reply.status(404).send({ error: error.message });
      }
      throw error;
    }
  });

  // PATCH /api/vocab/:id - 标记掌握/收藏
  fastify.patch<{ Params: { id: string }; Body: VocabUpdateDTO }>('/api/vocab/:id', async (request, reply) => {
    try {
      return await vocabService.updateVocab(request.params.id, request.body ?? {});
    } catch (error) {
      if (error instanceof VocabNotFoundError) {
        return reply.status(404).send({ error: error.message });
      }
      throw error;
    }
  });

  // DELETE /api/vocab/:id
  fastify.delete<{ Params: { id: string } }>('/api/vocab/:id', async (request, reply) => {
    try {
      await vocabService.deleteVocab(request.params.id);
      return reply.status(204).send();
    } catch (error) {
      if (error instanceof VocabNotFoundError) {
        return reply.status(404).send({ error: error.message });
      }
      throw error;
    }
  });
}
