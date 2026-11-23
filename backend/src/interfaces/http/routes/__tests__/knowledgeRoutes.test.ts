// backend/src/interfaces/http/routes/__tests__/knowledgeRoutes.test.ts
// 知识库导入端点:默认源目录导入、body.sourceDir 被忽略(安全回归)、非本机拒绝。
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
  let service: KnowledgeService;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'kimp-routes-'));
    targetDir = path.join(root, 'dst');
    service = new KnowledgeService(targetDir);
    app = Fastify();
    await registerKnowledgeRoutes(app, service);
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('should import default repo knowledge-base and return report', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/knowledge/import' });

    expect(res.statusCode).toBe(200);
    const report = res.json();
    expect(report.copied).toBeGreaterThan(0);
    expect(report.errors).toEqual([]);
    // 目标目录已落盘至少一个 md 文档
    const files = await fs.readdir(targetDir, { recursive: true });
    expect(files.some((f) => String(f).endsWith('.md'))).toBe(true);
  });

  it('should ignore sourceDir in body (no arbitrary local path import)', async () => {
    // 攻击者构造的敏感目录:若 body.sourceDir 被采纳,该文件会出现在目标根
    const evilDir = path.join(root, 'evil');
    await fs.mkdir(evilDir, { recursive: true });
    await fs.writeFile(path.join(evilDir, 'evil.md'), '# secret');

    const res = await app.inject({
      method: 'POST',
      url: '/api/knowledge/import',
      payload: { sourceDir: evilDir },
    });

    expect(res.statusCode).toBe(200);
    // 只导入了仓库内默认知识库,evil.md 不得落盘
    await expect(fs.stat(path.join(targetDir, 'evil.md'))).rejects.toThrow();
  });

  it('should report import suggestion when target is empty', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/knowledge/import/suggestion' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.suggested).toBe(true);
    expect(body.sourceCount).toBeGreaterThan(0);
    expect(body.targetCount).toBe(0);
  });

  it('should stop suggesting once target holds enough files', async () => {
    // 先导入一次,目标文件数与源一致 → 不再建议
    await app.inject({ method: 'POST', url: '/api/knowledge/import' });

    const res = await app.inject({ method: 'GET', url: '/api/knowledge/import/suggestion' });

    expect(res.json()).toMatchObject({ suggested: false });
  });

  it('should reject non-local callers', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/knowledge/import',
      remoteAddress: '10.0.0.9',
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('knowledgeRoutes 元数据', () => {
  let app: ReturnType<typeof Fastify>;
  let root: string;
  let service: KnowledgeService;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'kmeta-routes-'));
    service = new KnowledgeService(path.join(root, 'kb'));
    app = Fastify();
    await registerKnowledgeRoutes(app, service);
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('should update associations via PUT /api/knowledge/doc/meta', async () => {
    const { path: relPath } = await service.createDoc({
      title: '元数据',
      content: '正文',
      versionId: 'v_old',
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/knowledge/doc/meta',
      payload: { path: relPath, versionId: 'v_new', stage: 'dev' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, path: relPath });

    const doc = await service.getDoc(relPath);
    expect(doc.frontmatter).toEqual({ versionId: 'v_new', stage: 'dev' });
  });

  it('should reject missing path', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/knowledge/doc/meta',
      payload: { stage: 'dev' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('should reject non-string path/association values with a clear message', async () => {
    const { path: relPath } = await service.createDoc({ title: '类型校验', content: '正文' });

    const badPath = await app.inject({
      method: 'PUT',
      url: '/api/knowledge/doc/meta',
      payload: { path: 123, stage: 'dev' },
    });
    expect(badPath.statusCode).toBe(400);
    expect(badPath.json().error).toContain('path');

    const badValue = await app.inject({
      method: 'PUT',
      url: '/api/knowledge/doc/meta',
      payload: { path: relPath, versionId: { id: 'v1' } },
    });
    expect(badValue.statusCode).toBe(400);
    expect(badValue.json().error).toContain('versionId 必须是字符串');
  });

  it('should trim association values', async () => {
    const { path: relPath } = await service.createDoc({ title: 'trim', content: '正文' });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/knowledge/doc/meta',
      payload: { path: relPath, versionId: '  v_1  ', stage: ' dev ' },
    });

    expect(res.statusCode).toBe(200);
    const doc = await service.getDoc(relPath);
    expect(doc.frontmatter).toEqual({ versionId: 'v_1', stage: 'dev' });
  });

  it('should 404 when file does not exist', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/knowledge/doc/meta',
      payload: { path: 'nonexistent.md', stage: 'dev' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('should 403 on path traversal', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/knowledge/doc/meta',
      payload: { path: '../../etc/passwd', stage: 'dev' },
    });

    expect(res.statusCode).toBe(403);
  });
});
