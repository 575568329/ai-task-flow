// backend/src/application/knowledge/__tests__/frontmatter.test.ts
// 最小 frontmatter 解析/序列化:往返、固定顺序、空值、非法格式降级
import { describe, it, expect } from 'vitest';
import { extractFrontmatterBlock, parseFrontmatter, serializeFrontmatter } from '../frontmatter.js';
import type { KnowledgeFrontmatter } from '@ai-task-flow/shared';

describe('serializeFrontmatter', () => {
  it('should write keys in fixed order: tags → versionId → projectId → stage', () => {
    const data: KnowledgeFrontmatter = {
      stage: 'design',
      projectId: 'p_1',
      versionId: 'v_1',
      tags: ['架构设计', '知识库'],
    };
    expect(serializeFrontmatter(data)).toBe(
      '---\ntags: [架构设计, 知识库]\nversionId: v_1\nprojectId: p_1\nstage: design\n---\n',
    );
  });

  it('should not write legacy requirementId even when provided', () => {
    expect(serializeFrontmatter({ requirementId: 'r_1', versionId: 'v_1' })).toBe(
      '---\nversionId: v_1\n---\n',
    );
  });

  it('should omit empty fields', () => {
    expect(serializeFrontmatter({ versionId: 'v_1', stage: '' })).toBe('---\nversionId: v_1\n---\n');
    expect(serializeFrontmatter({ tags: [] })).toBe('');
    expect(serializeFrontmatter({})).toBe('');
  });

  it('should replace commas inside tags and collapse newlines in values', () => {
    const block = serializeFrontmatter({ tags: ['a,b'], versionId: 'v\n1' });
    expect(block).toContain('tags: [a b]');
    expect(block).toContain('versionId: v 1');
  });
});

describe('extractFrontmatterBlock', () => {
  it('should detect a block by syntax even when it has no recognized keys', () => {
    const raw = '---\ntitle: X\ndate: 2026-01-01\n---\n正文';
    expect(extractFrontmatterBlock(raw)).toEqual({
      hasBlock: true,
      raw: '---\ntitle: X\ndate: 2026-01-01\n---\n',
    });
  });

  it('should report no block for plain markdown', () => {
    expect(extractFrontmatterBlock('# 标题\n正文')).toEqual({ hasBlock: false, raw: '' });
  });
});

describe('parseFrontmatter', () => {
  it('should round-trip tags and Chinese values', () => {
    const data: KnowledgeFrontmatter = {
      tags: ['架构设计', '知识库'],
      versionId: 'v_abc',
      projectId: 'p_abc',
      stage: 'dev',
    };
    const parsed = parseFrontmatter(serializeFrontmatter(data) + '# 正文\n内容');
    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.data).toEqual(data);
    expect(parsed.body).toBe('# 正文\n内容');
  });

  it('should still parse legacy requirementId from old documents', () => {
    // 兼容旧文档:字段保留可读,前端展示与写入已不再使用
    const parsed = parseFrontmatter('---\nrequirementId: r_old\n---\n正文');
    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.data).toEqual({ requirementId: 'r_old' });
    expect(parsed.body).toBe('正文');
  });

  it('should return body as-is when document has no frontmatter', () => {
    const parsed = parseFrontmatter('# 标题\n正文');
    expect(parsed).toMatchObject({ data: {}, body: '# 标题\n正文', hasFrontmatter: false, raw: '' });
  });

  it('should treat unclosed frontmatter as no frontmatter', () => {
    const raw = '---\nversionId: v_1\n正文';
    const parsed = parseFrontmatter(raw);
    expect(parsed.hasFrontmatter).toBe(false);
    expect(parsed.body).toBe(raw);
  });

  it('should ignore unknown keys and multi-line values', () => {
    const raw = [
      '---',
      'title: 某方案',
      'versionId: v_1',
      'related:',
      '  - a',
      '  - b',
      'tags: [x, "y"]',
      '---',
      'body',
    ].join('\n');
    const parsed = parseFrontmatter(raw);
    expect(parsed.data).toEqual({ versionId: 'v_1', tags: ['x', 'y'] });
    expect(parsed.body).toBe('body');
  });

  it('should strip BOM before recognizing frontmatter', () => {
    const parsed = parseFrontmatter('﻿---\ntags: [a]\n---\n正文');
    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.data.tags).toEqual(['a']);
    expect(parsed.body).toBe('正文');
  });

  it('should treat a block without recognized keys as body, keeping it intact', () => {
    const raw = '---\n\n正文\n\n---\n后记';
    const parsed = parseFrontmatter(raw);
    expect(parsed.hasFrontmatter).toBe(false);
    expect(parsed.data).toEqual({});
    expect(parsed.body).toBe(raw);
    expect(parsed.raw).toBe('');
  });

  it('should treat empty frontmatter block as no frontmatter', () => {
    const parsed = parseFrontmatter('---\n---\nbody');
    expect(parsed.hasFrontmatter).toBe(false);
    expect(parsed.data).toEqual({});
    expect(parsed.body).toBe('---\n---\nbody');
  });

  it('should preserve raw block for round-trip writes', () => {
    const raw = '---\ntitle: 外部键\nversionId: v_1\n---\n正文';
    const parsed = parseFrontmatter(raw);
    expect(parsed.raw).toBe('---\ntitle: 外部键\nversionId: v_1\n---\n');
  });
});
