// backend/src/interfaces/http/routes/__tests__/conclusionRoutes.test.ts
// 结论卡 HTTP API 集成测试:六端点全路径 + 参数类型防御(坏 body 不得变 500) + limit 兜底。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { registerConclusionRoutes } from '../conclusionRoutes.js';
import { ConclusionService } from '../../../../application/conclusion/ConclusionService.js';
import { JsonConclusionRepository } from '../../../../infrastructure/persistence/JsonConclusionRepository.js';

describe('conclusionRoutes', () => {
  let app: ReturnType<typeof Fastify>;
  let tmpDir: string;

  beforeEach(async () => {
    const { nanoid } = await import('nanoid');
    tmpDir = path.join(os.tmpdir(), `conclusion-routes-${nanoid()}`);
    const service = new ConclusionService(
      new JsonConclusionRepository(path.join(tmpDir, 'conclusions.json'), path.join(tmpDir, 'backups')),
    );
    app = Fastify();
    await registerConclusionRoutes(app, service);
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function createCard(over: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/conclusions',
      payload: {
        scope: 'project', project: 'ai-task-flow', title: '全局搜索方案',
        decision: '旧结论', data: '旧数据', ...over,
      },
    });
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.body) as { id: string; rev: number };
  }

  it('should create, list, detail, append, patch and delete', async () => {
    const created = await createCard();
    expect(created.rev).toBe(1);

    const list = await app.inject({ method: 'GET', url: '/api/conclusions' });
    expect(list.statusCode).toBe(200);
    expect(JSON.parse(list.body).conclusions).toHaveLength(1);

    const detail = await app.inject({ method: 'GET', url: `/api/conclusions/${created.id}` });
    expect(detail.statusCode).toBe(200);
    expect(JSON.parse(detail.body).revisions).toHaveLength(1);

    const append = await app.inject({
      method: 'POST', url: `/api/conclusions/${created.id}/revisions`,
      payload: { expectedRev: 1, data: '新数据', changeNote: '补充数据' },
    });
    expect(append.statusCode).toBe(200);
    expect(JSON.parse(append.body).rev).toBe(2);

    const detail2 = await app.inject({ method: 'GET', url: `/api/conclusions/${created.id}` });
    const body2 = JSON.parse(detail2.body);
    expect(body2.revisions[1].decision).toBe('旧结论');
    expect(body2.revisions[1].data).toBe('新数据');
    expect(body2.revisions[1].source.tool).toBe('manual');

    const patch = await app.inject({
      method: 'PATCH', url: `/api/conclusions/${created.id}`,
      payload: { title: '新标题' },
    });
    expect(patch.statusCode).toBe(200);
    expect(JSON.parse(patch.body).title).toBe('新标题');

    const del = await app.inject({ method: 'DELETE', url: `/api/conclusions/${created.id}` });
    expect(del.statusCode).toBe(200);
    expect(JSON.parse(del.body)).toEqual({ deleted: true });
  });

  it('should return 400 when append has no changeNote', async () => {
    const created = await createCard();
    const res = await app.inject({
      method: 'POST', url: `/api/conclusions/${created.id}/revisions`,
      payload: { data: 'x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('should return 409 on stale expectedRev', async () => {
    const created = await createCard();
    await app.inject({
      method: 'POST', url: `/api/conclusions/${created.id}/revisions`,
      payload: { data: 'v2', changeNote: 'v2' },
    });
    const res = await app.inject({
      method: 'POST', url: `/api/conclusions/${created.id}/revisions`,
      payload: { expectedRev: 1, data: 'stale', changeNote: 'stale' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('should filter by keyword across history and expose matchedRev', async () => {
    const created = await createCard({ decision: '旧结论：前端过滤' });
    await app.inject({
      method: 'POST', url: `/api/conclusions/${created.id}/revisions`,
      payload: { decision: '新结论：服务端过滤', changeNote: '改方案' },
    });
    const res = await app.inject({ method: 'GET', url: '/api/conclusions?keyword=前端过滤' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.conclusions).toHaveLength(1);
    expect(body.conclusions[0].matchedRev).toBe(1);
  });

  it('should return 404 for unknown card', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/conclusions/c_none' });
    expect(res.statusCode).toBe(404);
  });

  // 风险 2:HTTP body 类型错误必须是 400(可读错误),不能被领域字符串方法炸成 500 TypeError。
  it('should return 400 (not 500) for malformed body types', async () => {
    const cases: Array<{ label: string; payload: Record<string, unknown> }> = [
      { label: 'decision', payload: { decision: 123 } },
      { label: 'title', payload: { title: ['x'] } },
      { label: 'tags', payload: { tags: 'x' } },
      { label: 'codeRefs', payload: { codeRefs: {} } },
    ];
    for (const { label, payload } of cases) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/conclusions',
        payload: { scope: 'personal', title: 't', decision: 'd', ...payload },
      });
      expect(res.statusCode, `${label} 类型错误应返回 400`).toBe(400);
      expect(JSON.parse(res.body).error).toBeTruthy();
    }

    const created = await createCard();
    const badRev = await app.inject({
      method: 'POST',
      url: `/api/conclusions/${created.id}/revisions`,
      payload: { expectedRev: '1', data: 'x', changeNote: 'y' },
    });
    expect(badRev.statusCode).toBe(400);
    expect(JSON.parse(badRev.body).error).toContain('expectedRev');

    const badPatch = await app.inject({
      method: 'PATCH',
      url: `/api/conclusions/${created.id}`,
      payload: { tags: 123 },
    });
    expect(badPatch.statusCode).toBe(400);
  });

  // 风险 3:limit 非数字不能变 NaN(否则 slice(0, NaN) 返回空列表),应回落默认 50。
  it('should fall back to default limit for non-numeric limit', async () => {
    await createCard();
    await createCard({ title: '第二张' });

    const res = await app.inject({ method: 'GET', url: '/api/conclusions?limit=abc' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).conclusions).toHaveLength(2);

    const empty = await app.inject({ method: 'GET', url: '/api/conclusions?limit=' });
    expect(empty.statusCode).toBe(200);
    expect(JSON.parse(empty.body).conclusions).toHaveLength(2);
  });
});
