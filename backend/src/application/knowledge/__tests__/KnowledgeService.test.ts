// backend/src/application/knowledge/__tests__/KnowledgeService.test.ts
// KnowledgeService 写入能力单测:命名规则、sanitize、越界、tags frontmatter、原子写、覆盖更新
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

    it('should write version/project/stage into frontmatter', async () => {
      const { path: relPath } = await service.createDoc({
        title: '设计',
        content: '# x',
        dir: '技术方案',
        versionId: 'v_1',
        projectId: 'p_1',
        stage: 'design',
      });
      const doc = await service.getDoc(relPath);
      expect(doc.frontmatter).toEqual({
        versionId: 'v_1',
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

    it('should not prepend a second block when content already has a frontmatter block', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { path: relPath } = await service.createDoc({
        title: '自带块',
        content: '---\ntitle: 外部\n---\n正文',
        versionId: 'v_1',
      });
      warn.mockRestore();

      const raw = await fs.readFile(path.join(root, relPath), 'utf-8');
      expect(raw).toBe('---\ntitle: 外部\n---\n正文');
      expect(raw.match(/^---$/gm)).toHaveLength(2);
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

  describe('getManifest frontmatter', () => {
    it('should attach tags + associations to flatDocs', async () => {
      const { path: relPath } = await service.createDoc({
        title: '关联文档',
        content: '正文',
        tags: ['调研'],
        versionId: 'v_1',
        projectId: 'p_1',
        stage: 'design',
      });
      const manifest = await service.getManifest(true);
      const doc = manifest.flatDocs.find((d) => d.path === relPath);
      expect(doc?.frontmatter).toEqual({
        tags: ['调研'],
        versionId: 'v_1',
        projectId: 'p_1',
        stage: 'design',
      });
    });

    it('should leave frontmatter undefined when doc has none', async () => {
      const { path: relPath } = await service.createDoc({
        title: '纯正文',
        content: '正文',
      });
      const manifest = await service.getManifest(true);
      expect(manifest.flatDocs.find((d) => d.path === relPath)?.frontmatter).toBeUndefined();
    });
  });

  describe('updateDocMeta', () => {
    it('should replace association fields and preserve other frontmatter keys + body', async () => {
      const abs = path.join(root, 'meta.md');
      await fs.writeFile(abs, '---\ntitle: 外部标题\ntags: [调研]\nversionId: v_old\n---\n正文', 'utf-8');

      await service.updateDocMeta('meta.md', {
        versionId: 'v_new',
        projectId: 'p_new',
        stage: 'dev',
      });

      const raw = await fs.readFile(abs, 'utf-8');
      expect(raw).toContain('title: 外部标题');
      expect(raw).toContain('tags: [调研]');
      expect(raw).toContain('versionId: v_new');
      expect(raw).not.toContain('v_old');
      expect(raw).toMatch(/\n正文$/);

      const doc = await service.getDoc('meta.md');
      expect(doc.content).toBe('正文');
      expect(doc.frontmatter).toEqual({
        tags: ['调研'],
        versionId: 'v_new',
        projectId: 'p_new',
        stage: 'dev',
      });
    });

    it('should clear association fields with empty strings but keep external keys', async () => {
      const abs = path.join(root, 'clear.md');
      await fs.writeFile(abs, '---\ntitle: 保留\nversionId: v_1\nstage: dev\n---\n正文', 'utf-8');

      await service.updateDocMeta('clear.md', {
        versionId: '',
        projectId: '',
        stage: '',
      });

      const raw = await fs.readFile(abs, 'utf-8');
      expect(raw).toContain('title: 保留');
      expect(raw).not.toContain('versionId');
      expect(raw).not.toContain('stage');
      // 只剩外部键:本项目不识别,整块按正文返回(与 getDoc 既有规则一致)
      const doc = await service.getDoc('clear.md');
      expect(doc.frontmatter).toBeUndefined();
      expect(doc.content).toContain('title: 保留');
    });

    it('should remove the whole block when clearing all fields and no other keys', async () => {
      const { path: relPath } = await service.createDoc({
        title: '清空',
        content: '正文',
        versionId: 'v_1',
        stage: 'dev',
      });
      await service.updateDocMeta(relPath, { versionId: '', stage: '' });

      const raw = await fs.readFile(path.join(root, relPath), 'utf-8');
      expect(raw).toBe('正文');
    });

    it('should keep legacy requirementId readable and preserved when editing meta', async () => {
      // 旧文档:requirementId 仍可读取(兼容),但编辑关联只写三项,旧行原样保留且不再展示
      const abs = path.join(root, 'legacy.md');
      await fs.writeFile(abs, '---\nrequirementId: r_old\n---\n正文', 'utf-8');

      const before = await service.getDoc('legacy.md');
      expect(before.frontmatter).toEqual({ requirementId: 'r_old' });
      expect(before.content).toBe('正文');

      await service.updateDocMeta('legacy.md', { versionId: 'v_new', stage: 'design' });

      const raw = await fs.readFile(abs, 'utf-8');
      expect(raw).toContain('requirementId: r_old');
      expect(raw).toContain('versionId: v_new');
      expect(raw).toContain('stage: design');

      const after = await service.getDoc('legacy.md');
      expect(after.frontmatter).toEqual({
        requirementId: 'r_old',
        versionId: 'v_new',
        stage: 'design',
      });
      expect(after.content).toBe('正文');
    });

    it('should add a frontmatter block when doc has none', async () => {
      const { path: relPath } = await service.createDoc({
        title: '无块',
        content: '正文',
      });
      await service.updateDocMeta(relPath, { stage: 'review' });

      const doc = await service.getDoc(relPath);
      expect(doc.frontmatter).toEqual({ stage: 'review' });
      expect(doc.content).toBe('正文');
    });

    it('should refresh manifest after update', async () => {
      const { path: relPath } = await service.createDoc({
        title: 'manifest',
        content: '正文',
      });
      await service.updateDocMeta(relPath, { projectId: 'p_1' });

      const manifest = await service.getManifest();
      expect(manifest.flatDocs.find((d) => d.path === relPath)?.frontmatter).toEqual({
        projectId: 'p_1',
      });
    });

    it('should reject non-markdown docs', async () => {
      await fs.writeFile(path.join(root, 'note.pdf'), 'x', 'utf-8');
      await expect(service.updateDocMeta('note.pdf', { stage: 'dev' })).rejects.toThrow(
        /仅支持编辑 Markdown/,
      );
    });

    it('should reject non-existent path', async () => {
      await expect(service.updateDocMeta('nonexistent.md', { stage: 'dev' })).rejects.toThrow(
        /文件不存在/,
      );
    });

    it('should reject path traversal', async () => {
      await expect(service.updateDocMeta('../../etc/passwd', { stage: 'dev' })).rejects.toThrow(
        /路径越界/,
      );
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

    it('should keep frontmatter when old file ends with --- without trailing newline', async () => {
      const abs = path.join(root, 'no-newline.md');
      await fs.writeFile(abs, '---\ntags: [a]\n---', 'utf-8');
      await service.saveDoc('no-newline.md', '新正文');
      const doc = await service.getDoc('no-newline.md');
      expect(doc.frontmatter).toEqual({ tags: ['a'] });
      expect(doc.content).toBe('新正文');
    });

    it('should keep old frontmatter block that only has unknown keys', async () => {
      const abs = path.join(root, 'external-only.md');
      await fs.writeFile(abs, '---\ntitle: 外部标题\ndate: 2026-01-01\n---\n旧正文', 'utf-8');
      await service.saveDoc('external-only.md', '新正文');

      const raw = await fs.readFile(abs, 'utf-8');
      expect(raw).toBe('---\ntitle: 外部标题\ndate: 2026-01-01\n---\n新正文');
      const doc = await service.getDoc('external-only.md');
      // 无可识别键:块不算本项目 frontmatter,整段按正文返回(与 getDoc 既有规则一致)
      expect(doc.frontmatter).toBeUndefined();
      expect(doc.content).toBe('---\ntitle: 外部标题\ndate: 2026-01-01\n---\n新正文');
    });

    it('should recognize frontmatter in files prefixed with BOM', async () => {
      const abs = path.join(root, 'bom.md');
      await fs.writeFile(abs, '﻿---\ntags: [a]\n---\n正文', 'utf-8');
      const doc = await service.getDoc('bom.md');
      expect(doc.frontmatter).toEqual({ tags: ['a'] });
      expect(doc.content).toBe('正文');
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
