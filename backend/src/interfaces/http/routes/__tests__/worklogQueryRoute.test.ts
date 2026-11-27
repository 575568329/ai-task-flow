// backend/src/interfaces/http/routes/__tests__/worklogQueryRoute.test.ts
// POST /api/worklog/query:uTools tools / 外部调用方的轻量查询入口(与 MCP query_work 同 Service)。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import os from 'node:os';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { JsonWorklogRepository } from '../../../../infrastructure/persistence/JsonWorklogRepository.js';
import { WorklogService } from '../../../../application/worklog/WorklogService.js';
import { registerWorklogRoutes } from '../worklogRoutes.js';

describe('POST /api/worklog/query', () => {
  let server: FastifyInstance;
  let service: WorklogService;

  beforeEach(async () => {
    const id = nanoid();
    service = new WorklogService(
      new JsonWorklogRepository(
        path.join(os.tmpdir(), `test-query-worklog-${id}.json`),
        path.join(os.tmpdir(), `test-query-worklog-backups-${id}`),
      ),
    );
    const program = await service.createProgram({ name: '建设主题' });
    const version = await service.createVersion({ name: 'V1', programId: program.id });
    await service.record({
      versionId: version.id,
      title: '相似题排序',
      detail: '按得分重排',
      stage: 'dev',
      tags: ['feat'],
      diff: 'diff --git a/x b/x',
    });
    await service.record({
      versionId: version.id,
      title: '登录页记住密码',
      detail: '本地存储',
      stage: 'review',
      tags: ['feat'],
    });

    server = Fastify();
    await registerWorklogRoutes(server, service);
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it('should filter by keyword and omit diff by default', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/worklog/query',
      payload: { keyword: '排序' },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveLength(1);
    expect(body[0].title).toBe('相似题排序');
    expect(body[0].diff).toBeUndefined();
  });

  it('should return diff only when includeDiff=true', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/worklog/query',
      payload: { keyword: '排序', includeDiff: true },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)[0].diff).toContain('diff --git');
  });

  it('should filter by stage and tags', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/worklog/query',
      payload: { stage: 'review', tags: ['feat'] },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.map((item: { title: string }) => item.title)).toEqual(['登录页记住密码']);
  });

  it('should reject invalid field types with 400 instead of 500', async () => {
    for (const payload of [
      { keyword: 123 },
      { tags: 'feat' },
      { limit: '10' },
      { includeDiff: 'yes' },
    ]) {
      const response = await server.inject({
        method: 'POST',
        url: '/api/worklog/query',
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
  });
});
