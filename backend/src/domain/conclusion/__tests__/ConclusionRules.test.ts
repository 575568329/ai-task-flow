import { describe, it, expect } from 'vitest';
import type { ConclusionSource } from '@ai-task-flow/shared';
import {
  appendRevision,
  createConclusion,
  ensureConversationOwner,
  patchConclusionMeta,
} from '../ConclusionRules.js';
import { ConclusionConflictError, ConclusionValidationError } from '../errors.js';

const source: ConclusionSource = {
  tool: 'claude-code',
  conversationId: 'sess-1',
  cwd: '/repo',
};

function make() {
  return createConclusion(
    {
      scope: 'project',
      project: 'ai-task-flow',
      version: 'v0.3',
      title: '全局搜索方案',
      decision: '采用服务端过滤',
      data: '接口耗时 10ms',
      tags: ['架构'],
    },
    source,
    1000,
  );
}

describe('createConclusion', () => {
  it('should create rev 1 with source and local date', () => {
    const c = make();
    expect(c.id).toMatch(/^c_/);
    expect(c.revisions).toHaveLength(1);
    expect(c.revisions[0].rev).toBe(1);
    expect(c.revisions[0].decision).toBe('采用服务端过滤');
    expect(c.revisions[0].source.conversationId).toBe('sess-1');
    expect(c.revisions[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(c.createdAt).toBe(1000);
    expect(c.conversationId).toBe('sess-1');
  });

  it('should reject personal scope with project or version', () => {
    expect(() => createConclusion(
      { scope: 'personal', project: 'p', title: 't', decision: 'd' },
      source,
    )).toThrow(ConclusionValidationError);
    expect(() => createConclusion(
      { scope: 'personal', version: 'v1', title: 't', decision: 'd' },
      source,
    )).toThrow(ConclusionValidationError);
  });

  it('should reject project scope without project', () => {
    expect(() => createConclusion(
      { scope: 'project', title: 't', decision: 'd' },
      source,
    )).toThrow(ConclusionValidationError);
  });

  it('should reject empty decision and invalid date', () => {
    expect(() => createConclusion(
      { scope: 'project', project: 'p', title: 't', decision: '  ' },
      source,
    )).toThrow(ConclusionValidationError);
    expect(() => createConclusion(
      { scope: 'project', project: 'p', title: 't', decision: 'd', date: '2026-02-30' },
      source,
    )).toThrow(ConclusionValidationError);
  });
});

describe('appendRevision', () => {
  it('should inherit omitted fields and increment rev', () => {
    const c = make();
    const rev = appendRevision(c, { data: '新数据', changeNote: '补充数据' }, source, 2000);
    expect(rev.rev).toBe(2);
    expect(rev.decision).toBe('采用服务端过滤');
    expect(rev.data).toBe('新数据');
    expect(c.updatedAt).toBe(2000);
  });

  it('should clear optional field when empty string is explicit', () => {
    const c = make();
    appendRevision(c, { data: '', changeNote: '去掉数据' }, source, 2000);
    expect(c.revisions[1].data).toBeUndefined();
  });

  it('should require changeNote', () => {
    const c = make();
    expect(() => appendRevision(c, { data: 'x', changeNote: '  ' }, source))
      .toThrow(ConclusionValidationError);
  });

  it('should reject no-op append', () => {
    const c = make();
    expect(() => appendRevision(c, { changeNote: '没变' }, source))
      .toThrow(ConclusionValidationError);
  });

  it('should reject stale expectedRev', () => {
    const c = make();
    expect(() => appendRevision(c, { data: 'x', changeNote: 'c', expectedRev: 9 }, source))
      .toThrow(ConclusionConflictError);
  });

  it('should reject append from a different conversation by default', () => {
    const c = make();
    expect(() => appendRevision(
      c,
      { data: 'x', changeNote: '跨对话' },
      { ...source, conversationId: 'sess-2' },
    )).toThrow(ConclusionConflictError);
  });

  it('should allow cross-conversation append with explicit flag', () => {
    const c = make();
    const rev = appendRevision(
      c,
      { data: 'x', changeNote: '跨对话', allowCrossConversation: true },
      { ...source, conversationId: 'sess-2' },
    );
    expect(rev.rev).toBe(2);
    expect(rev.source.conversationId).toBe('sess-2');
  });

  it('should allow manual append without conversationId', () => {
    const c = make();
    const rev = appendRevision(c, { data: 'x', changeNote: '人工修订' }, { tool: 'manual' });
    expect(rev.rev).toBe(2);
    expect(rev.source.tool).toBe('manual');
  });

  it('should keep card ownership after a manual revision', () => {
    const c = make();
    appendRevision(c, { data: 'manual', changeNote: '人工修订' }, { tool: 'manual' });
    expect(() => appendRevision(
      c,
      { data: 'B', changeNote: 'B' },
      { ...source, conversationId: 'sess-2' },
    )).toThrow(ConclusionConflictError);
  });

  it('should keep original owner after explicit cross-conversation append', () => {
    const c = make();
    appendRevision(
      c,
      { data: 'B', changeNote: 'B', allowCrossConversation: true },
      { ...source, conversationId: 'sess-2' },
    );
    const rev = appendRevision(c, { data: 'A2', changeNote: 'A again' }, source);
    expect(rev.rev).toBe(3);
    expect(c.conversationId).toBe('sess-1');
  });

  it('should backfill owner from the first revision with conversationId', () => {
    const c = make();
    delete c.conversationId;
    delete c.conversationName;
    ensureConversationOwner(c);
    expect(c.conversationId).toBe('sess-1');
  });

  it('should allow metadata-only append', () => {
    const c = make();
    const rev = appendRevision(c, { title: '新标题', changeNote: '改名' }, source, 2000);
    expect(rev.rev).toBe(2);
    expect(c.title).toBe('新标题');
  });
});

describe('patchConclusionMeta', () => {
  it('should clear project and version when switching to personal', () => {
    const c = make();
    patchConclusionMeta(c, { scope: 'personal' });
    expect(c.scope).toBe('personal');
    expect(c.project).toBeUndefined();
    expect(c.version).toBeUndefined();
  });

  it('should reject invalid title', () => {
    const c = make();
    expect(() => patchConclusionMeta(c, { title: '  ' })).toThrow(ConclusionValidationError);
  });
});
