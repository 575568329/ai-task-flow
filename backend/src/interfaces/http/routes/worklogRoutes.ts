// backend/src/interfaces/http/routes/worklogRoutes.ts
// worklog REST API(与 MCP 工具共享同一 WorklogService,业务规则单点;写协议见 JsonWorklogRepository)。
// 新模型:「版本 → 需求 → 条目」,项目降为字典(路径归属/筛选);版本/需求只能由页面显式创建。
import { FastifyInstance } from 'fastify';
import type {
  WorklogRecordRequest,
  WorklogUpdateRequest,
  WorklogVersionCreateRequest,
  WorklogRequirementCreateRequest,
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

/** body 必须是 JSON 对象(数组/null/标量一律拒绝),避免后续按字段读取时抛 TypeError → 500 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 读取必填字符串字段:非字符串/空串返回 undefined,由调用方统一 400。
 *  只做真值判断会放过 {name:123},到服务层 validateName 里 .trim() 抛 TypeError → 500。 */
function readRequiredString(body: unknown, field: string): string | undefined {
  if (!isPlainObject(body)) return undefined;
  const value = body[field];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** 可选字符串字段:非字符串时丢弃(不写坏数据),缺省返回 undefined */
function readOptionalString(body: unknown, field: string): string | undefined {
  if (!isPlainObject(body)) return undefined;
  const value = body[field];
  return typeof value === 'string' ? value : undefined;
}

export async function registerWorklogRoutes(
  fastify: FastifyInstance,
  worklogService: WorklogService,
) {
  // GET /api/worklog - 全树(工作记录页一次拉取渲染)
  fastify.get('/api/worklog', async () => {
    return worklogService.getTree();
  });

  // ------------------------------------------------------------------
  // 版本:创建 / 重命名 / 删除(名称全局唯一)
  // ------------------------------------------------------------------

  // POST /api/worklog/versions - 新建版本
  fastify.post<{ Body: WorklogVersionCreateRequest }>(
    '/api/worklog/versions',
    async (request, reply) => {
      const name = readRequiredString(request.body, 'name');
      if (!name) {
        return reply.status(400).send({ error: 'name 必须为非空字符串' });
      }
      try {
        const result = await worklogService.createVersion({
          name,
          description: readOptionalString(request.body, 'description'),
        });
        return reply.status(201).send(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(statusForError(err)).send({ error: message });
      }
    },
  );

  // POST /api/worklog/versions/:id/rename - 重命名版本(页面右键)
  fastify.post<{ Params: { id: string }; Body: { newName?: string } }>(
    '/api/worklog/versions/:id/rename',
    async (request, reply) => {
      const newName = readRequiredString(request.body, 'newName');
      if (!newName) {
        return reply.status(400).send({ error: 'newName 必须为非空字符串' });
      }
      try {
        await worklogService.renameVersion(request.params.id, newName);
        return { ok: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(statusForError(err)).send({ error: message });
      }
    },
  );

  // DELETE /api/worklog/versions/:id - 删整个版本(级联需求与条目,自动备份)
  fastify.delete<{ Params: { id: string } }>(
    '/api/worklog/versions/:id',
    async (request, reply) => {
      try {
        await worklogService.deleteVersion(request.params.id);
        return { ok: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(statusForError(err)).send({ error: message });
      }
    },
  );

  // ------------------------------------------------------------------
  // 需求:创建 / 重命名 / 删除(标题版本内唯一)
  // ------------------------------------------------------------------

  // POST /api/worklog/requirements - 新建需求(body 含 versionId)
  fastify.post<{ Body: WorklogRequirementCreateRequest }>(
    '/api/worklog/requirements',
    async (request, reply) => {
      const versionId = readRequiredString(request.body, 'versionId');
      const title = readRequiredString(request.body, 'title');
      if (!versionId || !title) {
        return reply.status(400).send({ error: 'versionId 与 title 必须为非空字符串' });
      }
      // projects 只接受字符串数组;非数组/元素非字符串直接 400,避免服务层按字符串逐字符迭代
      const rawProjects = isPlainObject(request.body) ? request.body.projects : undefined;
      if (
        rawProjects !== undefined &&
        (!Array.isArray(rawProjects) || rawProjects.some((item) => typeof item !== 'string'))
      ) {
        return reply.status(400).send({ error: 'projects 必须为字符串数组' });
      }
      try {
        const result = await worklogService.createRequirement({
          versionId,
          title,
          description: readOptionalString(request.body, 'description'),
          projects: rawProjects as string[] | undefined,
        });
        return reply.status(201).send(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(statusForError(err)).send({ error: message });
      }
    },
  );

  // POST /api/worklog/requirements/:id/rename - 重命名需求(body 含 versionId)
  fastify.post<{ Params: { id: string }; Body: { versionId?: string; newName?: string } }>(
    '/api/worklog/requirements/:id/rename',
    async (request, reply) => {
      const versionId = readRequiredString(request.body, 'versionId');
      const newName = readRequiredString(request.body, 'newName');
      if (!versionId || !newName) {
        return reply.status(400).send({ error: 'versionId 与 newName 必须为非空字符串' });
      }
      try {
        await worklogService.renameRequirement(versionId, request.params.id, newName);
        return { ok: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(statusForError(err)).send({ error: message });
      }
    },
  );

  // DELETE /api/worklog/requirements/:id?versionId=... - 删单个需求(级联条目,自动备份)
  // DELETE 请求体兼容性参差,版本优先取 query,其次 body。
  fastify.delete<{ Params: { id: string }; Querystring: { versionId?: string } }>(
    '/api/worklog/requirements/:id',
    async (request, reply) => {
      const bodyVersionId = readRequiredString(request.body, 'versionId');
      // 重复 query 参数(?versionId=a&versionId=b)时 Fastify 给数组,直接 trim 会 TypeError → 500;
      // 非字符串一律视为无效,回落 body 的 versionId;两者都无效 → 400。
      const rawQueryVersionId: unknown = request.query.versionId;
      const queryVersionId = typeof rawQueryVersionId === 'string' ? rawQueryVersionId : undefined;
      const versionId = queryVersionId ?? bodyVersionId;
      if (!versionId) {
        return reply.status(400).send({ error: 'versionId 必填(query 或 body,且必须为字符串)' });
      }
      try {
        await worklogService.deleteRequirement(versionId, request.params.id);
        return { ok: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(statusForError(err)).send({ error: message });
      }
    },
  );

  // ------------------------------------------------------------------
  // 条目:记录 / 更新 / 删除
  // ------------------------------------------------------------------

  // POST /api/worklog/entries - 记录条目到已存在的「版本 + 需求」(同 record_work)
  fastify.post<{ Body: WorklogRecordRequest }>(
    '/api/worklog/entries',
    async (request, reply) => {
      // title 必须是非空字符串;detail 给了就必须是字符串(缺失/空白交给服务层校验 → 400)。
      // 不做类型守卫会放过 {title:123} 到 validateTitle 的 .trim() 抛 TypeError → 500。
      const title = readRequiredString(request.body, 'title');
      if (!title) {
        return reply.status(400).send({ error: 'title 必须为非空字符串' });
      }
      const rawDetail = isPlainObject(request.body) ? request.body.detail : undefined;
      if (rawDetail !== undefined && typeof rawDetail !== 'string') {
        return reply.status(400).send({ error: 'detail 必须为字符串' });
      }
      try {
        // 无 body 时传空对象,让服务层走必填校验 → 400,而不是读 undefined.title 抛 TypeError → 500
        const result = await worklogService.record(
          request.body ?? ({} as WorklogRecordRequest),
        );
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

  // ------------------------------------------------------------------
  // 项目字典:创建 / 改名 / 删除 / 路径绑定
  // ------------------------------------------------------------------

  // POST /api/worklog/projects - 新建项目(全新环境的第一入口;paths 可选,与绑定同一套校验)
  fastify.post<{ Body: { name?: string; paths?: unknown } }>(
    '/api/worklog/projects',
    async (request, reply) => {
      const raw = request.body;
      if (!isPlainObject(raw)) {
        return reply.status(400).send({ error: '请求体必须为 JSON 对象' });
      }
      const name = typeof raw.name === 'string' ? raw.name : '';
      if (!name.trim()) {
        return reply.status(400).send({ error: 'name 必填' });
      }
      // paths 可缺省;一旦提供必须是字符串数组,否则 Service 内 paths.map 会抛 TypeError → 500
      if (raw.paths !== undefined) {
        const paths = raw.paths;
        if (!Array.isArray(paths) || paths.some((item) => typeof item !== 'string')) {
          return reply.status(400).send({ error: 'paths 必须为字符串数组' });
        }
      }
      try {
        const result = await worklogService.createProject({
          name,
          paths: raw.paths as string[] | undefined,
        });
        return reply.status(201).send(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(statusForError(err)).send({ error: message });
      }
    },
  );

  // DELETE /api/worklog/projects/:name - 删项目(只移除字典项,自动备份)
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
      const newName = readRequiredString(request.body, 'newName');
      if (!newName) {
        return reply.status(400).send({ error: 'newName 必须为非空字符串' });
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

  // PUT /api/worklog/projects/:name/paths - 绑定项目路径(整体替换,自动备份)
  fastify.put<{ Params: { name: string }; Body: { paths?: string[] } }>(
    '/api/worklog/projects/:name/paths',
    async (request, reply) => {
      // 整体替换语义:body 缺 paths 时静默当 [] 会清空全部绑定,必须显式 400;
      // 只有显式传空数组才表示「解绑全部」。
      const raw = request.body;
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return reply.status(400).send({ error: '请求体必须为 JSON 对象' });
      }
      const paths = (raw as { paths?: unknown }).paths;
      if (!Array.isArray(paths) || paths.some((item) => typeof item !== 'string')) {
        return reply.status(400).send({ error: 'paths 必须为字符串数组（清空绑定请显式传 []）' });
      }
      try {
        await worklogService.bindProjectPaths(request.params.name, paths);
        return { ok: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(statusForError(err)).send({ error: message });
      }
    },
  );

  // DELETE /api/worklog/projects/:name/paths?path=... - 解绑单个路径(自动备份)
  fastify.delete<{ Params: { name: string }; Querystring: { path?: string } }>(
    '/api/worklog/projects/:name/paths',
    async (request, reply) => {
      const target = request.query.path?.trim();
      if (!target) {
        return reply.status(400).send({ error: 'path 不能为空' });
      }
      try {
        await worklogService.unbindProjectPath(request.params.name, target);
        return { ok: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(statusForError(err)).send({ error: message });
      }
    },
  );
}
