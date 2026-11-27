// backend/src/application/knowledge/__tests__/KnowledgeImportService.test.ts
// 知识库导入单测:保留相对路径、内容级幂等、冲突改名不覆盖、路径穿越拦截
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { importKnowledgeFiles } from '../KnowledgeImportService.js';

describe('importKnowledgeFiles', () => {
  let targetDir: string;

  beforeEach(async () => {
    targetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kfiles-'));
  });

  afterEach(async () => {
    await fs.rm(targetDir, { recursive: true, force: true });
  });

  it('should preserve relative paths and skip identical content', async () => {
    const report = await importKnowledgeFiles(targetDir, [
      { path: '技术方案/架构.md', content: '# 架构' },
      { path: 'README.md', content: '# readme' },
    ]);
    expect(report.copied).toBe(2);
    expect(await fs.readFile(path.join(targetDir, '技术方案', '架构.md'), 'utf-8')).toBe('# 架构');

    const again = await importKnowledgeFiles(targetDir, [
      { path: '技术方案/架构.md', content: '# 架构' },
    ]);
    expect(again.copied).toBe(0);
    expect(again.skipped).toBe(1);
  });

  it('should create -imported copy when same path has different content without overwriting', async () => {
    await importKnowledgeFiles(targetDir, [{ path: 'a.md', content: '# old' }]);
    const report = await importKnowledgeFiles(targetDir, [{ path: 'a.md', content: '# new' }]);
    expect(report.copied).toBe(1);
    expect(report.conflicts).toEqual([{ from: 'a.md', to: 'a-imported.md' }]);
    expect(await fs.readFile(path.join(targetDir, 'a.md'), 'utf-8')).toBe('# old');
    expect(await fs.readFile(path.join(targetDir, 'a-imported.md'), 'utf-8')).toBe('# new');
  });

  it('should not overwrite an existing -imported file on repeated import', async () => {
    await fs.writeFile(path.join(targetDir, 'a.md'), '# first');
    await fs.writeFile(path.join(targetDir, 'a-imported.md'), '# first imported');

    const report = await importKnowledgeFiles(targetDir, [{ path: 'a.md', content: '# src' }]);

    expect(report.conflicts).toHaveLength(1);
    const files = await fs.readdir(targetDir);
    expect(files).toContain('a-imported-1.md');
    expect(await fs.readFile(path.join(targetDir, 'a-imported.md'), 'utf-8')).toBe('# first imported');
  });

  it('should reject traversal and hidden paths without writing outside target', async () => {
    const report = await importKnowledgeFiles(targetDir, [
      { path: '../escape.md', content: 'x' },
      { path: '.git/config', content: 'x' },
    ]);

    expect(report.copied).toBe(0);
    expect(report.errors).toHaveLength(2);
    expect(report.errors[0].message).toBe('非法文件路径');
    const escaped = path.join(path.dirname(targetDir), 'escape.md');
    expect(await fs.access(escaped).then(() => true, () => false)).toBe(false);
  });

  it('should decode base64 payloads so binary files round-trip byte-exact', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);

    const report = await importKnowledgeFiles(targetDir, [
      { path: 'img/logo.png', content: bytes.toString('base64'), encoding: 'base64' },
    ]);

    expect(report.copied).toBe(1);
    const written = await fs.readFile(path.join(targetDir, 'img', 'logo.png'));
    expect(written.equals(bytes)).toBe(true);

    // 同内容再次导入:按字节哈希判定为已存在
    const again = await importKnowledgeFiles(targetDir, [
      { path: 'img/logo.png', content: bytes.toString('base64'), encoding: 'base64' },
    ]);
    expect(again.skipped).toBe(1);
  });

  it('should normalize windows separators and leading slashes', async () => {
    const report = await importKnowledgeFiles(targetDir, [
      { path: '\\docs\\a.md', content: '# a' },
    ]);

    expect(report.copied).toBe(1);
    expect(await fs.readFile(path.join(targetDir, 'docs', 'a.md'), 'utf-8')).toBe('# a');
  });
});
