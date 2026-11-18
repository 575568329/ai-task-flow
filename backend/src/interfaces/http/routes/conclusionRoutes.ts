// backend/src/interfaces/http/routes/conclusionRoutes.ts
// 结论卡 REST API(与 MCP 工具共享同一 ConclusionService,业务规则单点)。
//
// 路由只做三件事:HTTP 参数整形、body 类型防御、错误到状态码的映射。
// body 类型防御是必需的:领域校验用 `value.trim()` / 数组方法,若 HTTP 传来
// `decision: 123` 这类错误类型会抛 TypeError → 500;这里提前拦成 400。
import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  ConclusionAppendRequest,
  ConclusionCreateRequest,
  ConclusionPatchRequest,
  ConclusionQueryRequest,
  ProblemScope,
} from '@ai-task-flow/shared';
import type { ConclusionService } from '../../../application/conclusion/ConclusionService.js';
import { DomainError } from '../../../domain/_shared/DomainError.js';
import { ConclusionValidationError } from '../../../domain/conclusion/errors.js';
import { resolveManualSource } from '../../source.js';

/** Service 抛的业务错映射:DomainError 带精准 httpStatus;锁竞争 ELOCKED → 503;未知 → 500。 */
function statusForError(err: unknown): number {
  if (err instanceof DomainError) return err.httpStatus;
  if ((err as NodeJS.ErrnoException)?.code === 'ELOCKED') return 503;
  return 500;
}

function sendError(reply: FastifyReply, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return reply.status(statusForError(err)).send({ error: message });
}

function parseTags(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.split(',').map((tag) => tag.trim()).filter(Boolean);
}

/** limit 非数字 → undefined,由 Service 回落默认 50;数字则交给 Service 夹取 [1,200]。
 *  不能把 NaN 传下去:slice(0, NaN) 会静默返回空列表。 */
function parseLimit(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.trunc(parsed);
}

function queryFrom(raw: Record<string, unknown>): ConclusionQueryRequest {
  // includeHistory 只在 detail 模式有意义;本路由的列表查询不消费它,故不解析、不对外承诺。
  return {
    cardId: typeof raw.cardId === 'string' ? raw.cardId : undefined,
    scope: raw.scope === 'project' || raw.scope === 'personal'
      ? raw.scope as ProblemScope : undefined,
    project: typeof raw.project === 'string' ? raw.project : undefined,
    version: typeof raw.version === 'string' ? raw.version : undefined,
    keyword: typeof raw.keyword === 'string' ? raw.keyword : undefined,
    tags: parseTags(raw.tags),
    dateFrom: typeof raw.dateFrom === 'string' ? raw.dateFrom : undefined,
    dateTo: typeof raw.dateTo === 'string' ? raw.dateTo : undefined,
    limit: parseLimit(raw.limit),
  };
}

/** body 必须是普通对象(数组 / null / 标量一律 400) */
function asBodyObject(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ConclusionValidationError('请求体必须为 JSON 对象');
  }
  return body as Record<string, unknown>;
}

function assertStringFields(body: Record<string, unknown>, fields: readonly string[]): void {
  for (const field of fields) {
    const value = body[field];
    if (value !== undefined && typeof value !== 'string') {
      throw new ConclusionValidationError(`${field} 必须为字符串`);
    }
  }
}

function assertTags(body: Record<string, unknown>): void {
  const tags = body.tags;
  if (tags === undefined) return;
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string')) {
    throw new ConclusionValidationError('tags 必须为字符串数组');
  }
}

function assertCodeRefs(body: Record<string, unknown>): void {
  const refs = body.codeRefs;
  if (refs === undefined) return;
  if (!Array.isArray(refs)) throw new ConclusionValidationError('codeRefs 必须为数组');
  for (const ref of refs) {
    if (
      ref === null
      || typeof ref !== 'object'
      || typeof (ref as { path?: unknown }).path !== 'string'
    ) {
      throw new ConclusionValidationError('codeRefs 每项必须包含字符串 path');
    }
  }
}

function assertExpectedRev(body: Record<string, unknown>): void {
  const rev = body.expectedRev;
  if (rev === undefined) return;
  if (typeof rev !== 'number' || !Number.isInteger(rev) || rev < 1) {
    throw new ConclusionValidationError('expectedRev 必须为正整数');
  }
}

const CREATE_STRING_FIELDS = [
  'scope', 'project', 'version', 'title', 'decision', 'data', 'openItems',
  'date', 'changeNote', 'conversationName',
] as const;

const APPEND_STRING_FIELDS = [
  'scope', 'project', 'version', 'title', 'decision', 'data', 'openItems',
  'date', 'changeNote', 'conversationName',
] as const;

const PATCH_STRING_FIELDS = ['scope', 'project', 'version', 'title'] as const;

function validateCreateBody(body: unknown): ConclusionCreateRequest {
  const obj = asBodyObject(body);
  assertStringFields(obj, CREATE_STRING_FIELDS);
  assertTags(obj);
  assertCodeRefs(obj);
  return obj as unknown as ConclusionCreateRequest;
}

function validateAppendBody(body: unknown): ConclusionAppendRequest {
  const obj = asBodyObject(body);
  assertStringFields(obj, APPEND_STRING_FIELDS);
  assertTags(obj);
  assertCodeRefs(obj);
  assertExpectedRev(obj);
  return obj as unknown as ConclusionAppendRequest;
}

function validatePatchBody(body: unknown): ConclusionPatchRequest {
  // 仅「无 body」视为空 patch;显式 JSON null / 数组等非法形态一律 400。
  const obj = asBodyObject(body === undefined ? {} : body);
  assertStringFields(obj, PATCH_STRING_FIELDS);
  assertTags(obj);
  return obj as unknown as ConclusionPatchRequest;
}

export async function registerConclusionRoutes(
  fastify: FastifyInstance,
  conclusionService: ConclusionService,
) {
  // GET /api/conclusions - 列表(关键词可跨历史版本命中,matchedRev 提示命中版本)
  fastify.get('/api/conclusions', async (request, reply) => {
    try {
      const conclusions = await conclusionService.query(queryFrom(request.query as Record<string, unknown>));
      return { conclusions };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // GET /api/conclusions/:id - 详情(默认返回全部 revisions,history 语义已内建)
  fastify.get<{ Params: { id: string } }>('/api/conclusions/:id', async (request, reply) => {
    try {
      return await conclusionService.get(request.params.id);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // POST /api/conclusions - 新建(201)
  fastify.post('/api/conclusions', async (request, reply) => {
    try {
      const input = validateCreateBody(request.body);
      const result = await conclusionService.create(input, resolveManualSource());
      return reply.status(201).send(result);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // POST /api/conclusions/:id/revisions - 追加新版本(整版快照,未传字段沿用上一版)
  fastify.post<{ Params: { id: string } }>(
    '/api/conclusions/:id/revisions',
    async (request, reply) => {
      try {
        const input = validateAppendBody(request.body);
        return await conclusionService.append(
          request.params.id,
          input,
          resolveManualSource(),
        );
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  // PATCH /api/conclusions/:id - 只改元信息(scope/project/version/title/tags)
  fastify.patch<{ Params: { id: string } }>('/api/conclusions/:id', async (request, reply) => {
    try {
      const input = validatePatchBody(request.body);
      return await conclusionService.patch(request.params.id, input);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  // DELETE /api/conclusions/:id - 删除(Service 内部自动快照)
  fastify.delete<{ Params: { id: string } }>('/api/conclusions/:id', async (request, reply) => {
    try {
      return await conclusionService.delete(request.params.id);
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
