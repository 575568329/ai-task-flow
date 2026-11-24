// 知识库多视图纯函数:按版本/项目/阶段分组、未关联收口、分类单组、关联统计。
import { describe, it, expect } from 'vitest';
import type { KnowledgeFileNode, WorklogData } from '@ai-task-flow/shared';
import {
  UNLINKED_GROUP_NAME,
  UNSET_REQUIREMENT_NAME,
  buildWorklogIndex,
  countDocsByLinkState,
  groupDocsByView,
} from '@/lib/knowledgeViews';

function doc(path: string, over: Partial<KnowledgeFileNode> = {}): KnowledgeFileNode {
  return {
    type: 'file',
    name: path.split('/').pop() ?? path,
    title: path,
    path,
    kind: 'md',
    mtime: 0,
    ...over,
  };
}

const worklogTree: WorklogData = {
  projects: [{ id: 'p1', name: 'ai-task-flow', createdAt: 0 }],
  programs: [{ id: 'g1', name: '建设主题', createdAt: 0 }],
  versions: [
    {
      id: 'v1',
      name: 'V8.0.8',
      programId: 'g1',
      createdAt: 0,
      requirements: [{ id: 'r1', title: '需求一', createdAt: 0, entries: [] }],
    },
  ],
};

const index = buildWorklogIndex(worklogTree);

describe('groupDocsByView', () => {
  it('groups docs by version → requirement and puts unlinked docs last', () => {
    const docs = [
      doc('a.md', { frontmatter: { versionId: 'v1', requirementId: 'r1' } }),
      doc('b.md', { frontmatter: { versionId: 'v1' } }),
      doc('c.md'),
    ];

    const groups = groupDocsByView(docs, 'version', index);

    expect(groups[0].name).toBe('V8.0.8');
    expect(groups[0].children?.map((child) => child.name)).toEqual([
      '需求一',
      UNSET_REQUIREMENT_NAME,
    ]);
    expect(groups[0].children?.[0].docs.map((d) => d.path)).toEqual(['a.md']);
    expect(groups[0].children?.[1].docs.map((d) => d.path)).toEqual(['b.md']);
    expect(groups[groups.length - 1].name).toBe(UNLINKED_GROUP_NAME);
    expect(groups[groups.length - 1].docs.map((d) => d.path)).toEqual(['c.md']);
  });

  it('falls back to raw ids when worklog names are missing', () => {
    const docs = [doc('a.md', { frontmatter: { versionId: 'v_unknown', requirementId: 'r_unknown' } })];
    const groups = groupDocsByView(docs, 'version', index);

    expect(groups[0].name).toBe('v_unknown');
    expect(groups[0].children?.[0].name).toBe('r_unknown');
  });

  it('groups docs by project name and unlinked bucket', () => {
    const docs = [
      doc('a.md', { frontmatter: { projectId: 'p1' } }),
      doc('b.md', { frontmatter: { projectId: 'p_unknown' } }),
      doc('c.md'),
    ];

    const groups = groupDocsByView(docs, 'project', index);

    expect(groups.map((group) => group.name)).toEqual([
      'ai-task-flow',
      'p_unknown',
      UNLINKED_GROUP_NAME,
    ]);
    expect(groups[0].docs.map((d) => d.path)).toEqual(['a.md']);
    expect(groups[2].docs.map((d) => d.path)).toEqual(['c.md']);
  });

  it('groups docs by stage label(unknown stage stays raw) and unlinked bucket', () => {
    const docs = [
      doc('a.md', { frontmatter: { stage: 'design' } }),
      doc('b.md', { frontmatter: { stage: 'custom-stage' } }),
      doc('c.md'),
    ];

    const groups = groupDocsByView(docs, 'stage', index);

    expect(groups.map((group) => group.name)).toEqual([
      '设计文档/实施计划',
      'custom-stage',
      UNLINKED_GROUP_NAME,
    ]);
  });

  it('returns a single all-docs group for category view', () => {
    const docs = [doc('a.md'), doc('b.md', { frontmatter: { stage: 'dev' } })];
    const groups = groupDocsByView(docs, 'category', index);

    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('全部文档');
    expect(groups[0].docs).toHaveLength(2);
  });
});

describe('countDocsByLinkState', () => {
  const docs = [
    doc('a.md', { frontmatter: { versionId: 'v1', projectId: 'p1' } }),
    doc('b.md', { frontmatter: { stage: 'dev' } }),
    doc('c.md'),
  ];

  it('counts by the view-specific field', () => {
    expect(countDocsByLinkState(docs, 'version')).toEqual({ linked: 1, unlinked: 2 });
    expect(countDocsByLinkState(docs, 'project')).toEqual({ linked: 1, unlinked: 2 });
    expect(countDocsByLinkState(docs, 'stage')).toEqual({ linked: 1, unlinked: 2 });
  });

  it('counts any association for category view', () => {
    expect(countDocsByLinkState(docs, 'category')).toEqual({ linked: 2, unlinked: 1 });
  });
});
