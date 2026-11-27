// backend/src/interfaces/http/routes/__tests__/knowledgeRoutes.test.ts
// 知识库导入/导出端点:多文件导入、zip 导出、非本机拒绝。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registerKnowledgeRoutes } from '../knowledgeRoutes.js';
import { KnowledgeService } from '../../../../application/knowledge/KnowledgeService.js';

describe('knowledgeRoutes 导入导出', () => {
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

  it('should import multiple picked files with relative paths', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/knowledge/import/files',
      payload: {
        files: [
          { path: '技术方案/a.md', content: '# a' },
          { path: 'b.md', content: '# b' },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ copied: 2, skipped: 0 });
    expect(await fs.readFile(path.join(targetDir, '技术方案', 'a.md'), 'utf-8')).toBe('# a');
  });

  it('should accept base64 binary files and keep bytes intact', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/knowledge/import/files',
      payload: {
        files: [{ path: 'img/a.png', content: bytes.toString('base64'), encoding: 'base64' }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ copied: 1 });
    const written = await fs.readFile(path.join(targetDir, 'img', 'a.png'));
    expect(written.equals(bytes)).toBe(true);
  });

  it('should reject unsupported extensions and unknown encoding', async () => {
    const badExt = await app.inject({
      method: 'POST',
      url: '/api/knowledge/import/files',
      payload: { files: [{ path: 'setup.exe', content: 'MZ' }] },
    });
    expect(badExt.statusCode).toBe(400);
    expect(badExt.json().error).toContain('不支持的文件类型');

    const badEncoding = await app.inject({
      method: 'POST',
      url: '/api/knowledge/import/files',
      payload: { files: [{ path: 'a.md', content: 'x', encoding: 'hex' }] },
    });
    expect(badEncoding.statusCode).toBe(400);
    expect(badEncoding.json().error).toContain('encoding');
  });

  it('should reject empty file list', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/knowledge/import/files',
      payload: { files: [] },
    });

    expect(res.statusCode).toBe(400);
  });

  it('should export knowledge base as zip with original paths', async () => {
    await fs.mkdir(path.join(targetDir, '技术方案'), { recursive: true });
    await fs.writeFile(path.join(targetDir, '技术方案', 'a.md'), '# a');
    await fs.writeFile(path.join(targetDir, 'b.md'), '# b');

    const res = await app.inject({ method: 'GET', url: '/api/knowledge/export' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(String(res.headers['content-disposition'])).toContain('knowledge-base-');
    // zip 以 PK\x03\x04 开头;文件名以明文存在头里,可直接断言路径被保留
    const payload = res.rawPayload;
    expect(payload.subarray(0, 4).toString('latin1')).toBe('PK\u0003\u0004');
    expect(payload.includes(Buffer.from('技术方案/a.md', 'utf8'))).toBe(true);
  });

  it('should 404 when exporting an empty knowledge base', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/knowledge/export' });

    expect(res.statusCode).toBe(404);
  });

  it('should reject non-local callers for import and export', async () => {
    const imported = await app.inject({
      method: 'POST',
      url: '/api/knowledge/import/files',
      remoteAddress: '10.0.0.9',
      payload: { files: [{ path: 'a.md', content: '# a' }] },
    });
    expect(imported.statusCode).toBe(403);

    const exported = await app.inject({
      method: 'GET',
      url: '/api/knowledge/export',
      remoteAddress: '10.0.0.9',
    });
    expect(exported.statusCode).toBe(403);
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
