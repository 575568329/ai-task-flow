// backend/src/interfaces/http/routes/worklogRoutes.ts
// worklog REST API(与 MCP 工具共享同一 WorklogService,业务规则单点;写协议见 JsonWorklogRepository)。
import { FastifyInstance } from 'fastify';
import type {
  WorklogRecordRequest,
  WorklogUpdateRequest,
  WorklogRenameRequest,
} from '@ai-task-flow/shared';
import type { WorklogService } from '../../../application/worklog/WorklogService.js';
import { DomainError } from '../../../domain/_shared/DomainError.js';

/** 把 Service 抛的业务错映射为 HTTP 状态码:
 *  DomainError 带精准 httpStatus(P1 修复:替代 message 字符串匹配,文案微调不再错位);
 *  锁竞争 ELOCKED → 503;未知系统错误 → 500(不再误判为请求问题)。 */
function statusForError(err: unknown): number {
  if (err instanceof DomainError) return err.httpStatus;
  if ((err as NodeJS.ErrnoException)?.code === 'ELOCKED') return 503;
  return 500;
}

export async function registerWorklogRoutes(
  fastify: FastifyInstance,
  worklogService: WorklogService,
) {
  // GET /api/worklog - 全树(工作记录页一次拉取渲染)
  fastify.get('/api/worklog', async () => {
    return worklogService.getTree();
  });

  // POST /api/worklog/entries - 新增条目(项目/版本自动建层,同 record_work)
  fastify.post<{ Body: WorklogRecordRequest }>(
    '/api/worklog/entries',
    async (request, reply) => {
      try {
        const result = await worklogService.record(request.body);
        return reply.status(201).send(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(statusForError(err)).send({ error: message });
      }
    },
  );

  // PUT /api/worklog/entries/:id - partial 更新(只改传入字段;严禁全量替换实现,
  // 表单无 diff 字段,全量会把 AI 记录的 diff 抹掉)
  fastify.put<{ Params: { id: string }; Body: WorklogUpdateRequest }>(
    '/api/worklog/entries/:id',
    async (request, reply) => {
      try {
        const result = await worklogService.update(request.params.id, request.body ?? {});
        return result;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(statusForError(err)).send({ error: message });
      }
    },
  );

  // DELETE /api/worklog/entries/:id - 删单条(自动备份)
  fastify.delete<{ Params: { id: string } }>(
    '/api/worklog/entries/:id',
    async (request, reply) => {
      try {
        await worklogService.deleteEntry(request.params.id);
        return { ok: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(statusForError(err)).send({ error: message });
      }
    },
  );

  // DELETE /api/worklog/versions?project=&version= - 删版本(可删非空,自动备份)
  fastify.delete<{ Querystring: { project?: string; version?: string } }>(
    '/api/worklog/versions',
    async (request, reply) => {
      const { project, version } = request.query;
      if (!project || !version) {
        return reply.status(400).send({ error: 'project 与 version 必填' });
      }
      try {
        await worklogService.deleteVersion(project, version);
        return { ok: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(statusForError(err)).send({ error: message });
      }
    },
  );

  // POST /api/worklog/versions/rename - 重命名版本(页面右键)
  fastify.post<{ Body: WorklogRenameRequest }>(
    '/api/worklog/versions/rename',
    async (request, reply) => {
      const { project, version, newName } = request.body ?? {};
      if (!project || !version || !newName) {
        return reply.status(400).send({ error: 'project/version/newName 必填' });
      }
      try {
        await worklogService.renameVersion(project, version, newName);
        return { ok: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(statusForError(err)).send({ error: message });
      }
    },
  );

  // DELETE /api/worklog/projects/:name - 删项目(自动备份)
  fastify.delete<{ Params: { name: string } }>(
    '/api/worklog/projects/:name',
    async (request, reply) => {
      try {
        await worklogService.deleteProject(request.params.name);
        return { ok: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(statusForError(err)).send({ error: message });
      }
    },
  );

  // POST /api/worklog/projects/:name/rename - 重命名项目
  fastify.post<{ Params: { name: string }; Body: { newName: string } }>(
    '/api/worklog/projects/:name/rename',
    async (request, reply) => {
      const newName = request.body?.newName;
      if (!newName) {
        return reply.status(400).send({ error: 'newName 必填' });
      }
      try {
        await worklogService.renameProject(request.params.name, newName);
        return { ok: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(statusForError(err)).send({ error: message });
      }
    },
  );
}
