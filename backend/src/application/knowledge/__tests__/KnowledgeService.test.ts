// backend/src/application/knowledge/__tests__/KnowledgeService.test.ts
// KnowledgeService 写入能力单测:命名规则、sanitize、越界、tags frontmatter、原子写、覆盖更新
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { KnowledgeService } from '../KnowledgeService.js';

describe('KnowledgeService 写入', () => {
  let root: string;
  let service: KnowledgeService;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-test-'));
    service = new KnowledgeService(root);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  describe('createDoc', () => {
    it('should generate filename as <timestamp>_<sanitizedTitle>.md', async () => {
      const { path: relPath } = await service.createDoc({
        title: '测试标题',
        content: '# 正文\n内容',
      });
      expect(relPath).toMatch(/^\d{14}_测试标题\.md$/);
    });

    it('should strip illegal filesystem characters from title', async () => {
      const { path: relPath } = await service.createDoc({
        title: 'a/b:c*d?e"f<g>h|i',
        content: 'x',
      });
      const name = path.basename(relPath);
      expect(name).not.toMatch(/[\/\\:\*\?"<>\|]/);
    });

    it('should truncate title to at most 60 chars', async () => {
      const { path: relPath } = await service.createDoc({
        title: 'a'.repeat(100),
        content: 'x',
      });
      const name = path.basename(relPath).replace(/^\d{14}_/, '').replace(/\.md$/, '');
      expect(name.length).toBeLessThanOrEqual(60);
    });

    it('should fallback to untitled when title is all illegal chars', async () => {
      const { path: relPath } = await service.createDoc({
        title: '///',
        content: 'x',
      });
      expect(path.basename(relPath)).toMatch(/^\d{14}_untitled\.md$/);
    });

    it('should reject empty or whitespace-only title', async () => {
      await expect(service.createDoc({ title: '', content: 'x' })).rejects.toThrow();
      await expect(service.createDoc({ title: '   ', content: 'x' })).rejects.toThrow();
    });

    it('should write content with tags frontmatter', async () => {
      const { path: relPath } = await service.createDoc({
        title: '带标签',
        content: '正文',
        tags: ['foo', 'bar'],
      });
      const doc = await service.getDoc(relPath);
      expect(doc.content).toMatch(/^---\n/);
      expect(doc.content).toContain('tags:');
      expect(doc.content).toContain('foo');
      expect(doc.content).toContain('bar');
      expect(doc.content).toContain('正文');
    });

    it('should write content as-is when no tags', async () => {
      const { path: relPath } = await service.createDoc({
        title: '无标签',
        content: '纯正文',
      });
      const doc = await service.getDoc(relPath);
      expect(doc.content).toBe('纯正文');
    });

    it('should write to subdir and create it if missing', async () => {
      const { path: relPath } = await service.createDoc({
        title: '子目录笔记',
        content: 'x',
        dir: '调研笔记',
      });
      expect(relPath).toMatch(/^调研笔记\/\d{14}_子目录笔记\.md$/);
    });

    it('should reject path traversal in dir', async () => {
      await expect(
        service.createDoc({ title: '越界', content: 'x', dir: '../../etc' }),
      ).rejects.toThrow(/路径越界/);
    });

    it('should refresh manifest after create', async () => {
      const { path: relPath } = await service.createDoc({
        title: 'manifest 刷新',
        content: 'x',
      });
      const manifest = await service.getManifest();
      expect(manifest.flatDocs.some(d => d.path === relPath)).toBe(true);
    });

    it('should not leave .tmp file after write', async () => {
      const { path: relPath } = await service.createDoc({
        title: '原子写',
        content: 'x',
      });
      const abs = path.join(root, relPath);
      const dir = path.dirname(abs);
      const entries = await fs.readdir(dir);
      expect(entries.some(e => e.endsWith('.tmp'))).toBe(false);
    });
  });

  describe('saveDoc', () => {
    it('should overwrite existing file content', async () => {
      const { path: relPath } = await service.createDoc({
        title: '原内容',
        content: 'old',
      });
      await service.saveDoc(relPath, 'new content');
      const doc = await service.getDoc(relPath);
      expect(doc.content).toBe('new content');
    });

    it('should reject non-existent path', async () => {
      await expect(service.saveDoc('nonexistent.md', 'x')).rejects.toThrow();
    });

    it('should reject path traversal', async () => {
      await expect(service.saveDoc('../../etc/passwd', 'x')).rejects.toThrow(/路径越界/);
    });
  });
});
