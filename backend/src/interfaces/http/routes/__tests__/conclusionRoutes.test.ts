// backend/src/interfaces/http/routes/__tests__/conclusionRoutes.test.ts
// 结论卡 HTTP API 集成测试:六端点全路径 + 参数类型防御(坏 body 不得变 500) + limit 兜底。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { registerConclusionRoutes } from '../conclusionRoutes.js';
import { ConclusionService } from '../../../../application/conclusion/ConclusionService.js';
import { JsonConclusionRepository } from '../../../../infrastructure/persistence/JsonConclusionRepository.js';
import { WorklogService } from '../../../../application/worklog/WorklogService.js';
import { JsonWorklogRepository } from '../../../../infrastructure/persistence/JsonWorklogRepository.js';

describe('conclusionRoutes', () => {
  let app: ReturnType<typeof Fastify>;
  let tmpDir: string;
  let worklogService: WorklogService;

  beforeEach(async () => {
    const { nanoid } = await import('nanoid');
    tmpDir = path.join(os.tmpdir(), `conclusion-routes-${nanoid()}`);
    const service = new ConclusionService(
      new JsonConclusionRepository(path.join(tmpDir, 'conclusions.json'), path.join(tmpDir, 'backups')),
    );
    worklogService = new WorklogService(
      new JsonWorklogRepository(
        path.join(tmpDir, 'worklog.json'),
        path.join(tmpDir, 'worklog-backups'),
      ),
    );
    app = Fastify();
    await registerConclusionRoutes(app, service, worklogService);
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  /** 造项目字典项(新模型 record 不再自动建项目;结论夹具只需项目名/id 可解析) */
  async function seedProjects(...names: string[]): Promise<void> {
    const version = await worklogService.createVersion({ name: 'v1' });
    const requirement = await worklogService.createRequirement({ versionId: version.id, title: 'R' });
    for (const name of names) {
      await worklogService.createProject({ name });
      await worklogService.record({
        versionId: version.id, requirementId: requirement.id,
        title: 't', detail: 'd', stage: 'dev', project: name,
      });
    }
  }

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

  it('should resolve projectId/related ids and warn on unknown related names', async () => {
    await seedProjects('题库');
    const projectId = (await worklogService.getTree()).projects[0].id;

    const res = await app.inject({
      method: 'POST',
      url: '/api/conclusions',
      payload: {
        scope: 'project', project: '题库', title: '联调', decision: 'd',
        relatedProjects: ['拼错的项目', '题库'],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.warnings?.[0]).toContain('拼错的项目');

    const detail = await app.inject({ method: 'GET', url: `/api/conclusions/${body.id}` });
    const card = JSON.parse(detail.body);
    expect(card.projectId).toBe(projectId);
    expect(card.relatedProjects).toEqual(['题库']);
    expect(card.relatedProjectIds).toEqual([projectId]);
  });

  it('should never trust a client-supplied projectId', async () => {
    await seedProjects('题库');
    const realId = (await worklogService.getTree()).projects[0].id;

    // 项目存在:服务端解析结果覆盖客户端伪造值
    const known = await app.inject({
      method: 'POST',
      url: '/api/conclusions',
      payload: {
        scope: 'project', project: '题库', title: '伪造引用', decision: 'd', projectId: 'p_forged',
      },
    });
    expect(known.statusCode).toBe(201);
    const knownBody = JSON.parse(known.body);
    const knownCard = JSON.parse((await app.inject({
      method: 'GET', url: `/api/conclusions/${knownBody.id}`,
    })).body);
    expect(knownCard.projectId).toBe(realId);
    expect(knownCard.projectId).not.toBe('p_forged');

    // 项目不存在:伪造值被清空,只保留名称快照
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/conclusions',
      payload: {
        scope: 'project', project: '不存在项目', title: '伪造引用2', decision: 'd', projectId: 'p_forged',
      },
    });
    expect(unknown.statusCode).toBe(201);
    const unknownBody = JSON.parse(unknown.body);
    const unknownCard = JSON.parse((await app.inject({
      method: 'GET', url: `/api/conclusions/${unknownBody.id}`,
    })).body);
    expect(unknownCard.project).toBe('不存在项目');
    expect(unknownCard.projectId).toBeUndefined();
  });

  it('should resolve project refs without probing project paths', async () => {
    await seedProjects('题库');
    const projectId = (await worklogService.getProjectRefs())[0].id;
    // 绑一个不存在的路径:若建卡走 getTree 就会触发 fs.access(可能拖慢/报错)
    await worklogService.bindProjectPaths('题库', [path.resolve('definitely-missing-repo')]);

    const getTreeSpy = vi.spyOn(worklogService, 'getTree');
    const res = await app.inject({
      method: 'POST',
      url: '/api/conclusions',
      payload: { scope: 'project', project: '题库', title: '快速建卡', decision: 'd' },
    });
    expect(res.statusCode).toBe(201);
    expect(getTreeSpy).not.toHaveBeenCalled();
    getTreeSpy.mockRestore();

    const body = JSON.parse(res.body);
    const card = JSON.parse((await app.inject({
      method: 'GET', url: `/api/conclusions/${body.id}`,
    })).body);
    expect(card.projectId).toBe(projectId);
  });

  it('should keep the name snapshot when the main project is unknown', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/conclusions',
      payload: { scope: 'project', project: '未登记项目', title: 't', decision: 'd' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.warnings?.[0]).toContain('未登记项目');

    const detail = await app.inject({ method: 'GET', url: `/api/conclusions/${body.id}` });
    const card = JSON.parse(detail.body);
    expect(card.project).toBe('未登记项目');
    expect(card.projectId).toBeUndefined();
  });

  it('should re-resolve projectId on PATCH rename/scope changes', async () => {
    await seedProjects('A', 'B');
    const tree = await worklogService.getTree();
    const idA = tree.projects.find((p) => p.name === 'A')!.id;
    const idB = tree.projects.find((p) => p.name === 'B')!.id;

    const created = await createCard({ project: 'A' });
    const initial = JSON.parse((await app.inject({
      method: 'GET', url: `/api/conclusions/${created.id}`,
    })).body);
    expect(initial.projectId).toBe(idA);

    // A→B:id 跟随名称重新解析
    const renamed = await app.inject({
      method: 'PATCH', url: `/api/conclusions/${created.id}`, payload: { project: 'B' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(JSON.parse(renamed.body).projectId).toBe(idB);

    // 改为不存在的项目:id 清空,名称快照保留,并带 warning
    const unmatched = await app.inject({
      method: 'PATCH', url: `/api/conclusions/${created.id}`, payload: { project: '不存在' },
    });
    expect(unmatched.statusCode).toBe(200);
    const unmatchedBody = JSON.parse(unmatched.body);
    expect(unmatchedBody.project).toBe('不存在');
    expect(unmatchedBody.projectId).toBeUndefined();
    expect(unmatchedBody.warnings?.[0]).toContain('不存在');

    // 改为个人域:projectId 被清空
    const personal = await app.inject({
      method: 'PATCH', url: `/api/conclusions/${created.id}`, payload: { scope: 'personal' },
    });
    expect(personal.statusCode).toBe(200);
    const personalBody = JSON.parse(personal.body);
    expect(personalBody.scope).toBe('personal');
    expect(personalBody.projectId).toBeUndefined();
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

  it('should filter list by relatedProject query param', async () => {
    // 关联项目名称必须能在 worklog 里解析到,否则建卡时会被丢弃
    await seedProjects('题库');
    await createCard({ title: '关联卡', relatedProjects: ['题库'] });
    await createCard({ title: '普通卡' });

    const hit = await app.inject({ method: 'GET', url: '/api/conclusions?relatedProject=题库' });
    expect(hit.statusCode).toBe(200);
    expect(JSON.parse(hit.body).conclusions.map((c: { title: string }) => c.title)).toEqual(['关联卡']);

    const miss = await app.inject({ method: 'GET', url: '/api/conclusions?relatedProject=不存在' });
    expect(JSON.parse(miss.body).conclusions).toHaveLength(0);
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
