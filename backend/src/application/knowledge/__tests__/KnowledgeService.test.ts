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

    it('should write tags frontmatter and return body without frontmatter', async () => {
      const { path: relPath } = await service.createDoc({
        title: '带标签',
        content: '正文',
        tags: ['foo', 'bar'],
      });
      const doc = await service.getDoc(relPath);
      expect(doc.content).toBe('正文');
      expect(doc.frontmatter?.tags).toEqual(['foo', 'bar']);
    });

    it('should write content as-is when no tags', async () => {
      const { path: relPath } = await service.createDoc({
        title: '无标签',
        content: '纯正文',
      });
      const doc = await service.getDoc(relPath);
      expect(doc.content).toBe('纯正文');
      expect(doc.frontmatter).toBeUndefined();
    });

    it('should write version/requirement/project/stage into frontmatter', async () => {
      const { path: relPath } = await service.createDoc({
        title: '设计',
        content: '# x',
        dir: '技术方案',
        versionId: 'v_1',
        requirementId: 'r_1',
        projectId: 'p_1',
        stage: 'design',
      });
      const doc = await service.getDoc(relPath);
      expect(doc.frontmatter).toEqual({
        versionId: 'v_1',
        requirementId: 'r_1',
        projectId: 'p_1',
        stage: 'design',
      });
      expect(doc.content).toBe('# x');
      expect(doc.content).not.toContain('---');
    });

    it('should merge tags and association metadata in one frontmatter block', async () => {
      const { path: relPath } = await service.createDoc({
        title: '合并',
        content: '正文',
        tags: ['调研'],
        versionId: 'v_1',
        stage: 'req',
      });
      const doc = await service.getDoc(relPath);
      expect(doc.frontmatter).toEqual({ tags: ['调研'], versionId: 'v_1', stage: 'req' });
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

    it('should keep old frontmatter when incoming content has none', async () => {
      const { path: relPath } = await service.createDoc({
        title: '保留元数据',
        content: '旧正文',
        tags: ['调研'],
        versionId: 'v_1',
      });
      await service.saveDoc(relPath, '新正文');
      const doc = await service.getDoc(relPath);
      expect(doc.content).toBe('新正文');
      expect(doc.frontmatter).toEqual({ tags: ['调研'], versionId: 'v_1' });
    });

    it('should preserve unknown old frontmatter keys when incoming content has none', async () => {
      const abs = path.join(root, 'external.md');
      await fs.writeFile(abs, '---\ntitle: 外部标题\nversionId: v_1\n---\n旧正文', 'utf-8');
      await service.saveDoc('external.md', '新正文');
      const raw = await fs.readFile(abs, 'utf-8');
      expect(raw).toContain('title: 外部标题');
      const doc = await service.getDoc('external.md');
      expect(doc.content).toBe('新正文');
      expect(doc.frontmatter).toEqual({ versionId: 'v_1' });
    });

    it('should keep incoming frontmatter as-is when content carries its own', async () => {
      const { path: relPath } = await service.createDoc({
        title: '换元数据',
        content: '旧正文',
        versionId: 'v_old',
      });
      await service.saveDoc(relPath, '---\nversionId: v_new\nstage: dev\n---\n新正文');
      const doc = await service.getDoc(relPath);
      expect(doc.content).toBe('新正文');
      expect(doc.frontmatter).toEqual({ versionId: 'v_new', stage: 'dev' });
    });

    it('should reject non-existent path', async () => {
      await expect(service.saveDoc('nonexistent.md', 'x')).rejects.toThrow();
    });

    it('should reject path traversal', async () => {
      await expect(service.saveDoc('../../etc/passwd', 'x')).rejects.toThrow(/路径越界/);
    });
  });
});
