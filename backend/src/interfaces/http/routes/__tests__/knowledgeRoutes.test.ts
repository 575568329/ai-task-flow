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

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'kimp-routes-'));
    targetDir = path.join(root, 'dst');
    app = Fastify();
    await registerKnowledgeRoutes(app, new KnowledgeService(targetDir));
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

  it('should reject non-local callers', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/knowledge/import',
      remoteAddress: '10.0.0.9',
    });

    expect(res.statusCode).toBe(403);
  });
});
