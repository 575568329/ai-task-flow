// backend/src/interfaces/http/routes/__tests__/worklogRoutes.test.ts
// worklog HTTP API 集成测试(新模型 版本 → 需求 → 条目):
// 版本/需求 CRUD 按 id、条目 record/update/delete、项目创建与路径校验、partial 语义(diff 不丢)、
// rename 冲突 409、删除产生备份。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { registerWorklogRoutes } from '../worklogRoutes.js';
import { WorklogService } from '../../../../application/worklog/WorklogService.js';
import { JsonWorklogRepository } from '../../../../infrastructure/persistence/JsonWorklogRepository.js';

describe('worklogRoutes', () => {
  let app: ReturnType<typeof Fastify>;
  let tmpDir: string;

  beforeEach(async () => {
    const { nanoid } = await import('nanoid');
    tmpDir = path.join(os.tmpdir(), `worklog-routes-${nanoid()}`);
    const service = new WorklogService(
      new JsonWorklogRepository(path.join(tmpDir, 'worklog.json'), path.join(tmpDir, 'worklog-backups')),
    );
    app = Fastify();
    await registerWorklogRoutes(app, service);
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function createProject(name: string, paths?: string[]): Promise<string> {
    const res = await app.inject({
      method: 'POST', url: '/api/worklog/projects',
      payload: paths ? { name, paths } : { name },
    });
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.body).id as string;
  }

  async function createVersion(name: string): Promise<string> {
    const res = await app.inject({
      method: 'POST', url: '/api/worklog/versions', payload: { name },
    });
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.body).id as string;
  }

  async function createRequirement(versionId: string, title: string): Promise<string> {
    const res = await app.inject({
      method: 'POST', url: '/api/worklog/requirements', payload: { versionId, title },
    });
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.body).id as string;
  }

  async function recordEntry(versionId: string, requirementId: string, over: Record<string, unknown> = {}) {
    return app.inject({
      method: 'POST', url: '/api/worklog/entries',
      payload: { versionId, requirementId, title: '标题', detail: '详情', ...over },
    });
  }

  it('GET /api/worklog should return version → requirement → entry tree', async () => {
    await createProject('p');
    const versionId = await createVersion('v1');
    const requirementId = await createRequirement(versionId, '需求A');
    const rec = await recordEntry(versionId, requirementId, { project: 'p' });
    expect(rec.statusCode).toBe(201);

    const res = await app.inject({ method: 'GET', url: '/api/worklog' });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.projects).toHaveLength(1);
    expect(data.versions).toHaveLength(1);
    expect(data.versions[0].name).toBe('v1');
    expect(data.versions[0].requirements[0].title).toBe('需求A');
    expect(data.versions[0].requirements[0].entries[0].title).toBe('标题');
    expect(data.versions[0].requirements[0].entries[0].project).toBe('p');
  });

  it('POST entries should record into existing ids and echo compat flags false', async () => {
    const versionId = await createVersion('v1');
    const requirementId = await createRequirement(versionId, 'R');

    const res = await recordEntry(versionId, requirementId, { tags: ['feat'], stage: 'dev' });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.entryId).toBeTruthy();
    expect(body.createdProject).toBe(false);
    expect(body.createdVersion).toBe(false);
    expect(body.path).toBe(`v1/R/${body.entryId}`);

    // 版本/需求不存在 → 404(不再自动建层;文案提示页面复制 id)
    const unknown = await recordEntry('v_nope', 'r_nope');
    expect(unknown.statusCode).toBe(404);
    expect(JSON.parse(unknown.body).error).toContain('请让用户在页面创建并复制 id');

    // 必填字段缺失 → 400(在查树之前校验),不会 500
    const bad = await app.inject({ method: 'POST', url: '/api/worklog/entries', payload: { title: 't' } });
    expect(bad.statusCode).toBe(400);
  });

  it('PUT partial update should keep diff/files when only title sent', async () => {
    const versionId = await createVersion('v1');
    const requirementId = await createRequirement(versionId, 'R');
    const created = await recordEntry(versionId, requirementId, {
      title: '旧标题', diff: 'diff --git a', files: [{ path: 'a.ts' }],
    });
    const { entryId } = JSON.parse(created.body);

    const res = await app.inject({
      method: 'PUT', url: `/api/worklog/entries/${entryId}`,
      payload: { title: '新标题' }, // 表单场景:只传 title
    });
    expect(res.statusCode).toBe(200);

    const tree = await app.inject({ method: 'GET', url: '/api/worklog' });
    const entry = tree.json().versions[0].requirements[0].entries[0];
    expect(entry.title).toBe('新标题');
    expect(entry.diff).toBe('diff --git a'); // partial:diff 不丢(红灯守护)
    expect(entry.files).toEqual([{ path: 'a.ts' }]);

    // 不存在的条目 → 404
    const missing = await app.inject({
      method: 'PUT', url: '/api/worklog/entries/e_nonexist',
      payload: { title: 'x' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('DELETE entry should remove it and produce a backup snapshot', async () => {
    const versionId = await createVersion('v1');
    const requirementId = await createRequirement(versionId, 'R');
    const created = await recordEntry(versionId, requirementId);
    const { entryId } = JSON.parse(created.body);

    const del = await app.inject({ method: 'DELETE', url: `/api/worklog/entries/${entryId}` });
    expect(del.statusCode).toBe(200);

    const tree = await app.inject({ method: 'GET', url: '/api/worklog' });
    expect(tree.json().versions[0].requirements[0].entries).toHaveLength(0);

    const backups = await fs.readdir(path.join(tmpDir, 'worklog-backups'));
    expect(backups.filter((n) => n.startsWith('backup-'))).toHaveLength(1);

    // 重复删除 → 404
    const again = await app.inject({ method: 'DELETE', url: `/api/worklog/entries/${entryId}` });
    expect(again.statusCode).toBe(404);
  });

  it('version CRUD should operate by id and map conflict to 409', async () => {
    const v1 = await createVersion('v1');
    const v2 = await createVersion('v2');

    // 全局重名 → 409
    const dup = await app.inject({
      method: 'POST', url: '/api/worklog/versions', payload: { name: 'v1' },
    });
    expect(dup.statusCode).toBe(409);

    // 改名:缺 newName → 400;重名 → 409;正常 → 200
    const noName = await app.inject({
      method: 'POST', url: `/api/worklog/versions/${v1}/rename`, payload: {},
    });
    expect(noName.statusCode).toBe(400);

    const conflict = await app.inject({
      method: 'POST', url: `/api/worklog/versions/${v1}/rename`, payload: { newName: 'v2' },
    });
    expect(conflict.statusCode).toBe(409);

    const ok = await app.inject({
      method: 'POST', url: `/api/worklog/versions/${v1}/rename`, payload: { newName: 'v1.0' },
    });
    expect(ok.statusCode).toBe(200);

    // 删除:v2 已知 / v_nope 未知 404
    const del = await app.inject({ method: 'DELETE', url: `/api/worklog/versions/${v2}` });
    expect(del.statusCode).toBe(200);

    const missing = await app.inject({ method: 'DELETE', url: '/api/worklog/versions/v_nope' });
    expect(missing.statusCode).toBe(404);

    const tree = await app.inject({ method: 'GET', url: '/api/worklog' });
    expect(tree.json().versions.map((v: { name: string }) => v.name)).toEqual(['v1.0']);
  });

  it('requirement CRUD should require versionId and map conflicts/unknown to 409/404', async () => {
    const v1 = await createVersion('v1');
    const r1 = await createRequirement(v1, 'R1');
    const r2 = await createRequirement(v1, 'R2');

    // 同版本重名 → 409;未知版本 → 404
    const dup = await app.inject({
      method: 'POST', url: '/api/worklog/requirements', payload: { versionId: v1, title: 'R1' },
    });
    expect(dup.statusCode).toBe(409);

    const noVersion = await app.inject({
      method: 'POST', url: '/api/worklog/requirements', payload: { versionId: 'v_nope', title: 'R3' },
    });
    expect(noVersion.statusCode).toBe(404);

    // 改名:缺 versionId/newName → 400;重名 → 409;正常 → 200
    const badRename = await app.inject({
      method: 'POST', url: `/api/worklog/requirements/${r1}/rename`, payload: { newName: 'R2' },
    });
    expect(badRename.statusCode).toBe(400);

    const conflict = await app.inject({
      method: 'POST', url: `/api/worklog/requirements/${r1}/rename`,
      payload: { versionId: v1, newName: 'R2' },
    });
    expect(conflict.statusCode).toBe(409);

    const ok = await app.inject({
      method: 'POST', url: `/api/worklog/requirements/${r1}/rename`,
      payload: { versionId: v1, newName: 'R1.0' },
    });
    expect(ok.statusCode).toBe(200);

    // 删除:缺 versionId → 400;未知需求 → 404;正常 → 200
    const noVid = await app.inject({ method: 'DELETE', url: `/api/worklog/requirements/${r2}` });
    expect(noVid.statusCode).toBe(400);

    const unknown = await app.inject({
      method: 'DELETE', url: `/api/worklog/requirements/r_nope?versionId=${v1}`,
    });
    expect(unknown.statusCode).toBe(404);

    const del = await app.inject({
      method: 'DELETE', url: `/api/worklog/requirements/${r2}?versionId=${v1}`,
    });
    expect(del.statusCode).toBe(200);

    const tree = await app.inject({ method: 'GET', url: '/api/worklog' });
    expect(
      tree.json().versions[0].requirements.map((r: { title: string }) => r.title),
    ).toEqual(['R1.0']);
  });

  it('POST projects should validate body/paths and reject duplicate names', async () => {
    const id = await createProject('p', ['D:\\xunfei\\p']);
    expect(id).toMatch(/^p_/);

    // 重名 → 409
    const dup = await app.inject({
      method: 'POST', url: '/api/worklog/projects', payload: { name: 'p' },
    });
    expect(dup.statusCode).toBe(409);

    // paths 非数组 / 元素非字符串 → 400(否则 Service 内 map 抛 TypeError → 500)
    const badPaths = await app.inject({
      method: 'POST', url: '/api/worklog/projects', payload: { name: 'q', paths: 'D:\\x' },
    });
    expect(badPaths.statusCode).toBe(400);

    const badItem = await app.inject({
      method: 'POST', url: '/api/worklog/projects', payload: { name: 'q', paths: [1] },
    });
    expect(badItem.statusCode).toBe(400);

    // 相对路径由 Service 校验 → 400
    const relative = await app.inject({
      method: 'POST', url: '/api/worklog/projects', payload: { name: 'q', paths: ['relative/dir'] },
    });
    expect(relative.statusCode).toBe(400);

    // name 缺失 → 400
    const noName = await app.inject({ method: 'POST', url: '/api/worklog/projects', payload: {} });
    expect(noName.statusCode).toBe(400);
  });

  it('PUT project paths should reject missing/malformed paths and only clear on explicit []', async () => {
    await createProject('p');
    const bind = await app.inject({
      method: 'PUT', url: '/api/worklog/projects/p/paths',
      payload: { paths: ['D:\\xunfei\\p'] },
    });
    expect(bind.statusCode).toBe(200);

    // body 存在但缺 paths:整体替换语义下静默清空是数据事故,必须 400
    const missing = await app.inject({
      method: 'PUT', url: '/api/worklog/projects/p/paths', payload: {},
    });
    expect(missing.statusCode).toBe(400);

    const notArray = await app.inject({
      method: 'PUT', url: '/api/worklog/projects/p/paths', payload: { paths: 'D:\\xunfei\\p' },
    });
    expect(notArray.statusCode).toBe(400);

    const badItem = await app.inject({
      method: 'PUT', url: '/api/worklog/projects/p/paths', payload: { paths: ['D:\\ok', 1] },
    });
    expect(badItem.statusCode).toBe(400);

    // 以上 400 均不得改动既有绑定
    const tree = await app.inject({ method: 'GET', url: '/api/worklog' });
    expect(tree.json().projects[0].paths).toEqual(['D:\\xunfei\\p']);

    // 显式 [] 才允许清空
    const clear = await app.inject({
      method: 'PUT', url: '/api/worklog/projects/p/paths', payload: { paths: [] },
    });
    expect(clear.statusCode).toBe(200);
    const cleared = await app.inject({ method: 'GET', url: '/api/worklog' });
    expect(cleared.json().projects[0].paths).toEqual([]);
  });

  it('string fields should reject non-string values with 400 (not 500)', async () => {
    const versionId = await createVersion('v1');
    const requirementId = await createRequirement(versionId, 'R');

    const badVersionName = await app.inject({
      method: 'POST', url: '/api/worklog/versions', payload: { name: 123 },
    });
    expect(badVersionName.statusCode).toBe(400);

    const badRequirementVersion = await app.inject({
      method: 'POST', url: '/api/worklog/requirements',
      payload: { versionId: 123, title: 'R2' },
    });
    expect(badRequirementVersion.statusCode).toBe(400);

    const badRequirementTitle = await app.inject({
      method: 'POST', url: '/api/worklog/requirements',
      payload: { versionId, title: 123 },
    });
    expect(badRequirementTitle.statusCode).toBe(400);

    const badVersionRename = await app.inject({
      method: 'POST', url: `/api/worklog/versions/${versionId}/rename`, payload: { newName: 123 },
    });
    expect(badVersionRename.statusCode).toBe(400);

    const badRequirementRename = await app.inject({
      method: 'POST', url: `/api/worklog/requirements/${requirementId}/rename`,
      payload: { versionId, newName: 123 },
    });
    expect(badRequirementRename.statusCode).toBe(400);

    // 无 body 的 record:必填校验 → 400,不得因读 undefined.title 变 500
    const noBody = await app.inject({ method: 'POST', url: '/api/worklog/entries' });
    expect(noBody.statusCode).toBe(400);

    // record 的 title/detail 同样做类型守卫:{title:123} 不得在 validateTitle.trim() 炸成 500
    const badEntryTitle = await app.inject({
      method: 'POST', url: '/api/worklog/entries',
      payload: { versionId, requirementId, title: 123, detail: 'd' },
    });
    expect(badEntryTitle.statusCode).toBe(400);

    const badEntryDetail = await app.inject({
      method: 'POST', url: '/api/worklog/entries',
      payload: { versionId, requirementId, title: 't', detail: 123 },
    });
    expect(badEntryDetail.statusCode).toBe(400);

    // 项目改名 newName 非字符串 → 400
    await createProject('gp');
    const badProjectRename = await app.inject({
      method: 'POST', url: '/api/worklog/projects/gp/rename', payload: { newName: 123 },
    });
    expect(badProjectRename.statusCode).toBe(400);
  });

  it('DELETE requirement should treat duplicated query versionId as invalid and fall back to body', async () => {
    const versionId = await createVersion('v1');
    const r1 = await createRequirement(versionId, 'R1');
    const r2 = await createRequirement(versionId, 'R2');

    // 重复 query → Fastify 给数组:视为无效,回落 body;body 有效则正常删除
    const withBody = await app.inject({
      method: 'DELETE', url: `/api/worklog/requirements/${r1}?versionId=a&versionId=b`,
      payload: { versionId },
    });
    expect(withBody.statusCode).toBe(200);

    // 重复 query 且无 body → 400(不得 500)
    const noBody = await app.inject({
      method: 'DELETE', url: `/api/worklog/requirements/${r2}?versionId=a&versionId=b`,
    });
    expect(noBody.statusCode).toBe(400);
  });

  it('DELETE project should only remove the dictionary entry and keep entries', async () => {
    await createProject('p');
    const versionId = await createVersion('v1');
    const requirementId = await createRequirement(versionId, 'R');
    await recordEntry(versionId, requirementId, { project: 'p' });

    const del = await app.inject({ method: 'DELETE', url: '/api/worklog/projects/p' });
    expect(del.statusCode).toBe(200);

    const tree = await app.inject({ method: 'GET', url: '/api/worklog' });
    const data = tree.json();
    expect(data.projects).toHaveLength(0);
    // 条目属历史数据:项目名称快照保留,条目不被级联删除
    expect(data.versions[0].requirements[0].entries).toHaveLength(1);
    expect(data.versions[0].requirements[0].entries[0].project).toBe('p');
  });

  it('bind/unbind unknown project should map to 404', async () => {
    const bind = await app.inject({
      method: 'PUT', url: '/api/worklog/projects/ghost/paths',
      payload: { paths: ['D:\\xunfei\\ghost'] },
    });
    expect(bind.statusCode).toBe(404);

    const unbind = await app.inject({
      method: 'DELETE', url: '/api/worklog/projects/ghost/paths?path=D%3A%5Cx',
    });
    expect(unbind.statusCode).toBe(404);
  });

  it('entry record/update should reject wrong field types with 400 (not 500)', async () => {
    const versionId = await createVersion('v1');
    const requirementId = await createRequirement(versionId, 'R');

    // POST:project/sourcePath 非字符串、tags/relatedProjects 非字符串数组
    expect((await recordEntry(versionId, requirementId, { project: 123 })).statusCode).toBe(400);
    expect((await recordEntry(versionId, requirementId, { sourcePath: 123 })).statusCode).toBe(400);
    expect((await recordEntry(versionId, requirementId, { tags: 'feat' })).statusCode).toBe(400);
    expect((await recordEntry(versionId, requirementId, { tags: ['feat', 1] })).statusCode).toBe(400);
    expect((await recordEntry(versionId, requirementId, { relatedProjects: 'x' })).statusCode).toBe(400);
    expect((await recordEntry(versionId, requirementId, { diff: 123 })).statusCode).toBe(400);

    // 以上 400 均不得落库
    const tree = await app.inject({ method: 'GET', url: '/api/worklog' });
    expect(tree.json().versions[0].requirements[0].entries).toHaveLength(0);

    const created = await recordEntry(versionId, requirementId, { title: 'ok', detail: 'd' });
    const { entryId } = JSON.parse(created.body);

    // PUT:title/tags/relatedProjects/diff 类型不对同样 400
    const putCases: Array<Record<string, unknown>> = [
      { title: 123 },
      { tags: 'feat' },
      { tags: ['feat', 1] },
      { relatedProjects: 'x' },
      { diff: 123 },
    ];
    for (const payload of putCases) {
      const res = await app.inject({ method: 'PUT', url: `/api/worklog/entries/${entryId}`, payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }

    // 数组 body 不再静默无操作
    const arrayBody = await app.inject({
      method: 'PUT', url: `/api/worklog/entries/${entryId}`, payload: [1, 2],
    });
    expect(arrayBody.statusCode).toBe(400);

    const after = await app.inject({ method: 'GET', url: '/api/worklog' });
    const entry = after.json().versions[0].requirements[0].entries[0];
    expect(entry.title).toBe('ok'); // 400 均未改动条目
    expect(entry.tags).toBeUndefined();
  });

  it('unknown project errors should list existing projects as candidates', async () => {
    await createProject('甲项目');
    await createProject('乙项目');
    const versionId = await createVersion('v1');
    const requirementId = await createRequirement(versionId, 'R');

    // record 显式项目不存在 → 400 并列出候选(与版本/需求候选风格一致)
    const rec = await recordEntry(versionId, requirementId, { project: '拼错的' });
    expect(rec.statusCode).toBe(400);
    const recError = JSON.parse(rec.body).error as string;
    expect(recError).toContain('项目不存在:拼错的');
    expect(recError).toContain('现有项目');
    expect(recError).toContain('甲项目(');
    expect(recError).toContain('乙项目(');

    // createRequirement 关联项目不存在 → 同样列出候选
    const req = await app.inject({
      method: 'POST', url: '/api/worklog/requirements',
      payload: { versionId, title: 'R2', projects: ['拼错的'] },
    });
    expect(req.statusCode).toBe(400);
    const reqError = JSON.parse(req.body).error as string;
    expect(reqError).toContain('现有项目');
    expect(reqError).toContain('甲项目(');
  });

  it('project rename/delete endpoints should keep working', async () => {
    await createProject('p');

    const projOk = await app.inject({
      method: 'POST', url: '/api/worklog/projects/p/rename',
      payload: { newName: 'p2' },
    });
    expect(projOk.statusCode).toBe(200);

    const projDel = await app.inject({ method: 'DELETE', url: '/api/worklog/projects/p2' });
    expect(projDel.statusCode).toBe(200);

    const missing = await app.inject({ method: 'DELETE', url: '/api/worklog/projects/p2' });
    expect(missing.statusCode).toBe(404); // findProject 现抛 404,不再 500

    const tree = await app.inject({ method: 'GET', url: '/api/worklog' });
    expect(tree.json().projects).toHaveLength(0);
  });
});
