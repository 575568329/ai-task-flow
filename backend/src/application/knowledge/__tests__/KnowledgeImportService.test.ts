// backend/src/application/knowledge/__tests__/KnowledgeImportService.test.ts
// 知识库合并导入单测:递归复制、同名改名保留、源目录保留、缺失源目录报错、隐藏文件跳过
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { importKnowledge, suggestImport } from '../KnowledgeImportService.js';

describe('importKnowledge', () => {
  let root: string;
  let sourceDir: string;
  let targetDir: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'kimp-'));
    sourceDir = path.join(root, 'src');
    targetDir = path.join(root, 'dst');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('should copy files recursively and keep both copies on conflict', async () => {
    await fs.mkdir(path.join(sourceDir, '技术方案'), { recursive: true });
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, '技术方案', 'a.md'), '# src a');
    await fs.writeFile(path.join(sourceDir, '技术方案', 'b.md'), '# src b');
    await fs.mkdir(path.join(targetDir, '技术方案'), { recursive: true });
    await fs.writeFile(path.join(targetDir, '技术方案', 'a.md'), '# existing a');

    const report = await importKnowledge({ sourceDir, targetDir });

    expect(report.copied).toBe(2);
    expect(report.skipped).toBe(0);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0].from).toBe('技术方案/a.md');
    expect(report.conflicts[0].to).toContain('-imported');
    expect(report.errors).toHaveLength(0);

    const files = await fs.readdir(path.join(targetDir, '技术方案'));
    // 原文件保留,新文件以 -imported 命名
    expect(files).toContain('a.md');
    expect(files.some((f) => f.startsWith('a-imported'))).toBe(true);
    expect(await fs.readFile(path.join(targetDir, '技术方案', 'a.md'), 'utf-8')).toBe('# existing a');
  });

  it('should keep source directory intact after import', async () => {
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'only.md'), '# only');

    await importKnowledge({ sourceDir, targetDir });

    // 源目录保留(回滚源),内容不被移动/删除
    expect((await fs.readdir(sourceDir))).toContain('only.md');
    expect(await fs.readFile(path.join(sourceDir, 'only.md'), 'utf-8')).toBe('# only');
  });

  it('should reject when target is inside source (recursive copy guard)', async () => {
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'a.md'), '# a');
    const nestedTarget = path.join(sourceDir, 'nested-target');

    await expect(importKnowledge({ sourceDir, targetDir: nestedTarget })).rejects.toThrow(
      /不能互相包含/,
    );
  });

  it('should reject when source is inside target (recursive copy guard)', async () => {
    await fs.mkdir(targetDir, { recursive: true });
    const nestedSource = path.join(targetDir, 'nested-source');
    await fs.mkdir(nestedSource, { recursive: true });
    await fs.writeFile(path.join(nestedSource, 'a.md'), '# a');

    await expect(importKnowledge({ sourceDir: nestedSource, targetDir })).rejects.toThrow(
      /不能互相包含/,
    );
  });

  it('should reject with readable error when source dir missing', async () => {
    await expect(
      importKnowledge({ sourceDir: path.join(root, 'missing'), targetDir }),
    ).rejects.toThrow(/源目录不存在/);
  });

  it('should skip hidden files, .git and node_modules', async () => {
    await fs.mkdir(path.join(sourceDir, '.git', 'objects'), { recursive: true });
    await fs.mkdir(path.join(sourceDir, 'node_modules', 'pkg'), { recursive: true });
    await fs.mkdir(path.join(sourceDir, 'docs'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, '.git', 'objects', 'x'), 'x');
    await fs.writeFile(path.join(sourceDir, 'node_modules', 'pkg', 'index.js'), 'x');
    await fs.writeFile(path.join(sourceDir, '.hidden.md'), 'x');
    await fs.writeFile(path.join(sourceDir, 'docs', 'visible.md'), '# visible');

    const report = await importKnowledge({ sourceDir, targetDir });

    expect(report.copied).toBe(1);
    expect(await fs.readdir(targetDir)).toEqual(['docs']);
    expect(await fs.readdir(path.join(targetDir, 'docs'))).toEqual(['visible.md']);
  });

  it('should skip all files on repeated import when content is identical', async () => {
    await fs.mkdir(path.join(sourceDir, 'docs'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'a.md'), '# a');
    await fs.writeFile(path.join(sourceDir, 'docs', 'b.md'), '# b');

    const first = await importKnowledge({ sourceDir, targetDir });
    expect(first.copied).toBe(2);
    expect(first.skipped).toBe(0);

    // 二次导入:目标已有内容相同的文件 → 全部跳过,不再生成 -imported 副本
    const second = await importKnowledge({ sourceDir, targetDir });
    expect(second.copied).toBe(0);
    expect(second.skipped).toBe(2);
    expect(second.conflicts).toHaveLength(0);
    expect((await fs.readdir(targetDir)).sort()).toEqual(['a.md', 'docs']);
    expect(await fs.readdir(path.join(targetDir, 'docs'))).toEqual(['b.md']);
  });

  it('should copy changed content as a new -imported copy', async () => {
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'a.md'), '# v1');

    await importKnowledge({ sourceDir, targetDir });
    // 内容改动后不再算「已存在」,按原冲突规则生成副本
    await fs.writeFile(path.join(sourceDir, 'a.md'), '# v2');

    const report = await importKnowledge({ sourceDir, targetDir });

    expect(report.skipped).toBe(0);
    expect(report.copied).toBe(1);
    expect(report.conflicts).toHaveLength(1);
    expect(await fs.readFile(path.join(targetDir, 'a-imported.md'), 'utf-8')).toBe('# v2');
    expect(await fs.readFile(path.join(targetDir, 'a.md'), 'utf-8')).toBe('# v1');
  });

  it('should not overwrite an existing -imported file on repeated import', async () => {
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'a.md'), '# src');
    await fs.writeFile(path.join(targetDir, 'a.md'), '# first');
    await fs.writeFile(path.join(targetDir, 'a-imported.md'), '# first imported');

    const report = await importKnowledge({ sourceDir, targetDir });

    expect(report.conflicts).toHaveLength(1);
    const files = await fs.readdir(targetDir);
    expect(files).toContain('a-imported.md');
    expect(files).toContain('a-imported-1.md');
    expect(await fs.readFile(path.join(targetDir, 'a-imported.md'), 'utf-8')).toBe('# first imported');
  });
});

describe('suggestImport', () => {
  let root: string;
  let sourceDir: string;
  let targetDir: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ksug-'));
    sourceDir = path.join(root, 'src');
    targetDir = path.join(root, 'dst');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('should not suggest when source dir is missing', async () => {
    const result = await suggestImport({ sourceDir: path.join(root, 'missing'), targetDir });

    expect(result).toEqual({ suggested: false, sourceCount: 0, targetCount: 0 });
  });

  it('should suggest when source has more importable files than target', async () => {
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'a.md'), '# a');
    await fs.writeFile(path.join(sourceDir, 'b.md'), '# b');
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, 'a.md'), '# a');

    const result = await suggestImport({ sourceDir, targetDir });

    expect(result).toEqual({ suggested: true, sourceCount: 2, targetCount: 1 });
  });

  it('should not suggest when target already has at least as many files', async () => {
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'a.md'), '# a');
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, 'a.md'), '# a');

    const result = await suggestImport({ sourceDir, targetDir });

    expect(result).toEqual({ suggested: false, sourceCount: 1, targetCount: 1 });
  });

  it('should ignore hidden files and node_modules when counting', async () => {
    await fs.mkdir(path.join(sourceDir, 'node_modules'), { recursive: true });
    await fs.mkdir(path.join(sourceDir, '.obsidian'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'node_modules', 'x.js'), 'x');
    await fs.writeFile(path.join(sourceDir, '.obsidian', 'y.json'), 'y');
    await fs.writeFile(path.join(sourceDir, '.secret.md'), 's');
    await fs.writeFile(path.join(sourceDir, 'a.md'), '# a');

    const result = await suggestImport({ sourceDir, targetDir });

    expect(result.sourceCount).toBe(1);
    expect(result.suggested).toBe(true);
  });
});
