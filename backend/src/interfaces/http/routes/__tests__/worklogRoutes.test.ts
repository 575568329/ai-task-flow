// backend/src/interfaces/http/routes/__tests__/worklogRoutes.test.ts
// worklog HTTP API 集成测试:CRUD 全路径 + partial 语义(diff 不丢) + rename 冲突 + 删除产生备份。
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
  let service: WorklogService;

  beforeEach(async () => {
    const { nanoid } = await import('nanoid');
    tmpDir = path.join(os.tmpdir(), `worklog-routes-${nanoid()}`);
    service = new WorklogService(
      new JsonWorklogRepository(path.join(tmpDir, 'worklog.json'), path.join(tmpDir, 'worklog-backups')),
    );
    app = Fastify();
    await registerWorklogRoutes(app, service);
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('GET /api/worklog should return full tree after record', async () => {
    await app.inject({
      method: 'POST', url: '/api/worklog/entries',
      payload: { project: 'p', version: 'v1', title: '标题', detail: '详情' },
    });
    const res = await app.inject({ method: 'GET', url: '/api/worklog' });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.projects).toHaveLength(1);
    expect(data.projects[0].versions[0].entries[0].title).toBe('标题');
  });

  it('POST entries should create with auto layering and echo created flags', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/worklog/entries',
      payload: { project: 'p', version: 'v1', title: 't', detail: 'd', tags: ['feat'] },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.createdProject).toBe(true);
    expect(body.createdVersion).toBe(true);
    expect(body.entryId).toBeTruthy();

    // 参数缺失 → 400
    const bad = await app.inject({
      method: 'POST', url: '/api/worklog/entries',
      payload: { project: 'p', version: 'v1' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('PUT partial update should keep diff/files when only title sent', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/worklog/entries',
      payload: { project: 'p', version: 'v1', title: '旧标题', detail: 'd', diff: 'diff --git a', files: [{ path: 'a.ts' }] },
    });
    const { entryId } = JSON.parse(created.body);

    const res = await app.inject({
      method: 'PUT', url: `/api/worklog/entries/${entryId}`,
      payload: { title: '新标题' }, // 表单场景:只传 title
    });
    expect(res.statusCode).toBe(200);

    const tree = await app.inject({ method: 'GET', url: '/api/worklog' });
    const entry = tree.json().projects[0].versions[0].entries[0];
    expect(entry.title).toBe('新标题');
    expect(entry.diff).toBe('diff --git a');  // partial:diff 不丢(红灯守护)
    expect(entry.files).toEqual([{ path: 'a.ts' }]);

    // 不存在的条目 → 404
    const missing = await app.inject({
      method: 'PUT', url: '/api/worklog/entries/e_nonexist',
      payload: { title: 'x' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('DELETE entry should remove it and produce a backup snapshot', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/worklog/entries',
      payload: { project: 'p', version: 'v1', title: 't', detail: 'd' },
    });
    const { entryId } = JSON.parse(created.body);

    const del = await app.inject({ method: 'DELETE', url: `/api/worklog/entries/${entryId}` });
    expect(del.statusCode).toBe(200);

    const tree = await app.inject({ method: 'GET', url: '/api/worklog' });
    expect(tree.json().projects[0].versions[0].entries).toHaveLength(0);

    const backups = await fs.readdir(path.join(tmpDir, 'worklog-backups'));
    expect(backups.filter((n) => n.startsWith('backup-'))).toHaveLength(1);
  });

  it('DELETE versions should require query params and map missing to 404', async () => {
    await app.inject({
      method: 'POST', url: '/api/worklog/entries',
      payload: { project: 'p', version: 'v1', title: 't', detail: 'd' },
    });
    const noParams = await app.inject({ method: 'DELETE', url: '/api/worklog/versions' });
    expect(noParams.statusCode).toBe(400);

    const ok = await app.inject({ method: 'DELETE', url: '/api/worklog/versions?project=p&version=v1' });
    expect(ok.statusCode).toBe(200);

    const missing = await app.inject({ method: 'DELETE', url: '/api/worklog/versions?project=p&version=vX' });
    expect(missing.statusCode).toBe(404);
  });

  it('rename endpoints should map conflict to 409', async () => {
    await app.inject({ method: 'POST', url: '/api/worklog/entries', payload: { project: 'p', version: 'v1', title: 't', detail: 'd' } });
    await app.inject({ method: 'POST', url: '/api/worklog/entries', payload: { project: 'p', version: 'v2', title: 't', detail: 'd' } });

    const conflict = await app.inject({
      method: 'POST', url: '/api/worklog/versions/rename',
      payload: { project: 'p', version: 'v1', newName: 'v2' },
    });
    expect(conflict.statusCode).toBe(409);

    const ok = await app.inject({
      method: 'POST', url: '/api/worklog/versions/rename',
      payload: { project: 'p', version: 'v1', newName: 'v1.0' },
    });
    expect(ok.statusCode).toBe(200);

    const projOk = await app.inject({
      method: 'POST', url: '/api/worklog/projects/p/rename',
      payload: { newName: 'p2' },
    });
    expect(projOk.statusCode).toBe(200);

    const projDel = await app.inject({ method: 'DELETE', url: '/api/worklog/projects/p2' });
    expect(projDel.statusCode).toBe(200);
    const tree = await app.inject({ method: 'GET', url: '/api/worklog' });
    expect(tree.json().projects).toHaveLength(0);
  });
});
