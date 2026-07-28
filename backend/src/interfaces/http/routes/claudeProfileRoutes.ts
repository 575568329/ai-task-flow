// backend/src/interfaces/http/routes/claudeProfileRoutes.ts
// Claude Code settings.json 多套配置一键切换的 REST API。
//
// 安全边界:GET 一律返回脱敏摘要(settings 明文含 ANTHROPIC_AUTH_TOKEN,不下发);
// 明文只允许「进」(POST 粘贴 JSON)与「后端内部流转」(import 直接读文件 → 存储)。
// 故不提供「读取 profile 原文」的接口——想看内容请直接打开 settings.json。
import type { FastifyInstance } from 'fastify';
import {
  ClaudeProfileNotFoundError,
  ClaudeProfileService,
  ClaudeProfileValidationError,
} from '../../../application/claude-profile/ClaudeProfileService.js';
import type {
  ClaudeProfileCreateRequest,
  ClaudeProfileImportRequest,
  ClaudeProfileUpdateRequest,
} from '@ai-task-flow/shared';

export async function registerClaudeProfileRoutes(
  fastify: FastifyInstance,
  service: ClaudeProfileService,
) {
  // GET /api/claude-profiles/targets — 探测到的 settings.json 目标列表
  fastify.get('/api/claude-profiles/targets', async () => {
    return { targets: service.listTargets() };
  });

  // GET /api/claude-profiles?target=<key> — profile 列表(脱敏)+ 当前生效项
  fastify.get<{ Querystring: { target?: string } }>('/api/claude-profiles', async (request, reply) => {
    try {
      return await service.list(request.query?.target);
    } catch (error) {
      if (error instanceof ClaudeProfileNotFoundError) {
        return reply.status(404).send({ error: error.message });
      }
      if (error instanceof ClaudeProfileValidationError) {
        return reply.status(400).send({ error: error.message });
      }
      throw error;
    }
  });

  // POST /api/claude-profiles — 粘贴整份 settings JSON 新建
  fastify.post<{ Body: ClaudeProfileCreateRequest }>('/api/claude-profiles', async (request, reply) => {
    const { name, settings } = request.body ?? {};
    try {
      const created = await service.create(name, settings);
      return reply.status(201).send(created);
    } catch (error) {
      if (error instanceof ClaudeProfileValidationError) {
        return reply.status(400).send({ error: error.message });
      }
      throw error;
    }
  });

  // POST /api/claude-profiles/import — 从目标现有 settings.json 导入(明文不经前端)
  fastify.post<{ Body: ClaudeProfileImportRequest }>(
    '/api/claude-profiles/import',
    async (request, reply) => {
      const { name, targetKey } = request.body ?? {};
      try {
        const created = await service.importFromTarget(name, targetKey);
        return reply.status(201).send(created);
      } catch (error) {
        if (error instanceof ClaudeProfileValidationError) {
          return reply.status(400).send({ error: error.message });
        }
        if (error instanceof ClaudeProfileNotFoundError) {
          return reply.status(404).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  // PUT /api/claude-profiles/:id — 改名 / 换内容
  fastify.put<{ Params: { id: string }; Body: ClaudeProfileUpdateRequest }>(
    '/api/claude-profiles/:id',
    async (request, reply) => {
      try {
        return await service.update(request.params.id, request.body ?? {});
      } catch (error) {
        if (error instanceof ClaudeProfileNotFoundError) {
          return reply.status(404).send({ error: error.message });
        }
        if (error instanceof ClaudeProfileValidationError) {
          return reply.status(400).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  // DELETE /api/claude-profiles/:id
  fastify.delete<{ Params: { id: string } }>('/api/claude-profiles/:id', async (request, reply) => {
    try {
      await service.remove(request.params.id);
      return reply.status(204).send();
    } catch (error) {
      if (error instanceof ClaudeProfileNotFoundError) {
        return reply.status(404).send({ error: error.message });
      }
      throw error;
    }
  });

  // POST /api/claude-profiles/:id/apply — 备份 + 整份覆盖写入目标
  fastify.post<{ Params: { id: string }; Body: { targetKey?: string } }>(
    '/api/claude-profiles/:id/apply',
    async (request, reply) => {
      const targetKey = request.body?.targetKey;
      if (!targetKey) {
        return reply.status(400).send({ error: 'targetKey 必填' });
      }
      try {
        return await service.applyProfile(request.params.id, targetKey);
      } catch (error) {
        if (error instanceof ClaudeProfileNotFoundError) {
          return reply.status(404).send({ error: error.message });
        }
        if (error instanceof ClaudeProfileValidationError) {
          return reply.status(400).send({ error: error.message });
        }
        throw error;
      }
    },
  );
}
