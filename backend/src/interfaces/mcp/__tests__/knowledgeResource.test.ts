// backend/src/interfaces/mcp/__tests__/knowledgeResource.test.ts
// 知识库 MCP resource 文本:正文前附关联元数据摘要(仅在有值时),让 AI 读到软关联。
import { describe, it, expect } from 'vitest';
import { formatKnowledgeResourceText } from '../knowledgeResource.js';

describe('formatKnowledgeResourceText', () => {
  it('should prefix a meta line when frontmatter has associations', () => {
    const text = formatKnowledgeResourceText({
      path: '技术方案/a.md',
      kind: 'md',
      content: '# 正文',
      frontmatter: {
        versionId: 'v_1',
        projectId: 'p_3',
        stage: 'dev',
        tags: ['架构设计', 'worklog'],
      },
    });
    expect(text).toBe(
      '<!-- meta: versionId=v_1 projectId=p_3 stage=dev tags=架构设计,worklog -->\n# 正文',
    );
  });

  it('should ignore legacy requirementId from old documents', () => {
    const text = formatKnowledgeResourceText({
      path: 'a.md',
      kind: 'md',
      content: '正文',
      frontmatter: { requirementId: 'r_2', projectId: 'p_3' },
    });
    expect(text).toBe('<!-- meta: projectId=p_3 -->\n正文');
  });

  it('should only include fields that have values', () => {
    const text = formatKnowledgeResourceText({
      path: 'a.md',
      kind: 'md',
      content: '正文',
      frontmatter: { versionId: 'v_1', tags: [] },
    });
    expect(text).toBe('<!-- meta: versionId=v_1 -->\n正文');
  });

  it('should return plain content when no frontmatter or no recognized fields', () => {
    expect(formatKnowledgeResourceText({ path: 'a.md', kind: 'md', content: '正文' })).toBe('正文');
    expect(formatKnowledgeResourceText({
      path: 'a.md', kind: 'md', content: '正文', frontmatter: {},
    })).toBe('正文');
    // 非 md 没有 content 时返回空串,不产生孤立 meta 头
    expect(formatKnowledgeResourceText({ path: 'a.pdf', kind: 'pdf' })).toBe('');
  });
});
