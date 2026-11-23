// backend/src/interfaces/http/routes/__tests__/knowledgeRoutes.test.ts
// 知识库导入端点:成功返回报告、非本机拒绝、源目录缺失映射 400。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registerKnowledgeRoutes } from '../knowledgeRoutes.js';
import { KnowledgeService } from '../../../../application/knowledge/KnowledgeService.js';

describe('knowledgeRoutes 导入', () => {
  let app: ReturnType<typeof Fastify>;
  let root: string;
  let targetDir: string;
  let sourceDir: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'kimp-routes-'));
    targetDir = path.join(root, 'dst');
    sourceDir = path.join(root, 'src');
    app = Fastify();
    await registerKnowledgeRoutes(app, new KnowledgeService(targetDir));
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('should copy files and return import report', async () => {
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'a.md'), '# a');

    const res = await app.inject({
      method: 'POST',
      url: '/api/knowledge/import',
      payload: { sourceDir },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ copied: 1, conflicts: [], errors: [] });
    expect(await fs.readFile(path.join(targetDir, 'a.md'), 'utf-8')).toBe('# a');
  });

  it('should reject non-local callers', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/knowledge/import',
      remoteAddress: '10.0.0.9',
      payload: { sourceDir },
    });

    expect(res.statusCode).toBe(403);
  });

  it('should return 400 when source dir missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/knowledge/import',
      payload: { sourceDir: path.join(root, 'missing') },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('源目录不存在');
  });
});
