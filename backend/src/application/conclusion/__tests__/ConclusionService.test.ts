import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { ConclusionSource } from '@ai-task-flow/shared';
import { ConclusionService } from '../ConclusionService.js';
import { JsonConclusionRepository } from '../../../infrastructure/persistence/JsonConclusionRepository.js';
import { ConclusionConflictError, ConclusionNotFoundError } from '../../../domain/conclusion/errors.js';

const source: ConclusionSource = { tool: 'claude-code', conversationId: 'sess-1' };

describe('ConclusionService', () => {
  let tmpDir: string;
  let service: ConclusionService;

  beforeEach(async () => {
    const { nanoid } = await import('nanoid');
    tmpDir = path.join(os.tmpdir(), `conclusion-service-${nanoid()}`);
    service = new ConclusionService(
      new JsonConclusionRepository(path.join(tmpDir, 'conclusions.json'), path.join(tmpDir, 'backups')),
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function createInput(over: Record<string, unknown> = {}) {
    return {
      scope: 'project' as const,
      project: 'ai-task-flow',
      title: '全局搜索方案',
      decision: '旧结论：前端过滤',
      data: '旧数据',
      ...over,
    };
  }

  it('should create a card and read it back', async () => {
    const res = await service.create(createInput(), source);
    expect(res.id).toMatch(/^c_/);
    expect(res.rev).toBe(1);
    expect(res.path).toBe('ai-task-flow/全局搜索方案#1');

    const card = await service.get(res.id);
    expect(card.title).toBe('全局搜索方案');
    expect(card.revisions[0].source.conversationId).toBe('sess-1');
  });

  it('should append with inherited fields and explicit clear', async () => {
    const { id } = await service.create(createInput(), source);
    const appended = await service.append(id, {
      expectedRev: 1,
      data: '新数据',
      changeNote: '补充数据',
    }, source);
    expect(appended.rev).toBe(2);

    const card = await service.get(id);
    expect(card.revisions[1].decision).toBe('旧结论：前端过滤');
    expect(card.revisions[1].data).toBe('新数据');

    await service.append(id, { data: '', changeNote: '清空数据' }, source);
    const card2 = await service.get(id);
    expect(card2.revisions[2].data).toBeUndefined();
  });

  it('should not create backups for pure append', async () => {
    const { id } = await service.create(createInput(), source);
    await service.append(id, { data: 'v2', changeNote: 'v2' }, source);
    const files = await fs.readdir(path.join(tmpDir, 'backups')).catch(() => []);
    expect(files.filter((n) => n.startsWith('backup-'))).toHaveLength(0);
  });

  it('should reject stale expectedRev with Conflict', async () => {
    const { id } = await service.create(createInput(), source);
    await service.append(id, { data: 'v2', changeNote: 'v2' }, source);
    await expect(service.append(id, {
      expectedRev: 1, data: 'stale', changeNote: 'stale',
    }, source)).rejects.toBeInstanceOf(ConclusionConflictError);
  });

  it('should search keyword across all revisions and report matchedRev', async () => {
    const { id } = await service.create(createInput({ decision: '旧结论：前端过滤' }), source);
    await service.append(id, { decision: '新结论：服务端过滤', changeNote: '改方案' }, source);

    const byOld = await service.query({ keyword: '前端过滤' });
    expect(byOld).toHaveLength(1);
    expect(byOld[0].latestDecisionExcerpt).toContain('新结论');
    expect(byOld[0].matchedRev).toBe(1);
    expect(byOld[0].source.conversationId).toBe('sess-1');

    const byNew = await service.query({ keyword: '服务端过滤' });
    expect(byNew[0].matchedRev).toBeUndefined();
  });

  it('should filter by scope/project/tags/date', async () => {
    await service.create(createInput({ date: '2026-11-01', tags: ['架构'] }), source);
    await service.create(createInput({
      scope: 'personal', project: undefined, title: '个人学习', decision: 'd', date: '2026-11-18',
    }), source);

    expect(await service.query({ scope: 'personal' })).toHaveLength(1);
    expect(await service.query({ project: 'ai-task-flow' })).toHaveLength(1);
    expect(await service.query({ tags: ['架构'] })).toHaveLength(1);
    expect(await service.query({ dateFrom: '2026-11-10' })).toHaveLength(1);
    expect(await service.query({ dateTo: '2026-11-05' })).toHaveLength(1);
  });

  it('should return full latest and revision summaries in detail', async () => {
    const { id } = await service.create(createInput(), source);
    await service.append(id, { data: '新数据', changeNote: '补充' }, source);

    const detail = await service.getDetail(id);
    expect(detail.rev).toBe(2);
    expect(detail.latest.data).toBe('新数据');
    expect(detail.revisions.map((r) => r.rev)).toEqual([1, 2]);
    expect(detail.revisions[1].changeNote).toBe('补充');
    expect(detail.history).toBeUndefined();

    const withHistory = await service.getDetail(id, true);
    expect(withHistory.history).toHaveLength(2);
  });

  it('should patch metadata and clear project when switching to personal', async () => {
    const { id } = await service.create(createInput(), source);
    const patched = await service.patch(id, { scope: 'personal', title: '新标题' });
    expect(patched.scope).toBe('personal');
    expect(patched.project).toBeUndefined();
    expect(patched.title).toBe('新标题');
  });

  it('should delete a card and create a backup', async () => {
    const { id } = await service.create(createInput(), source);
    await expect(service.delete(id)).resolves.toEqual({ deleted: true });
    await expect(service.get(id)).rejects.toBeInstanceOf(ConclusionNotFoundError);

    const backups = await fs.readdir(path.join(tmpDir, 'backups'));
    expect(backups.filter((n) => n.startsWith('backup-'))).toHaveLength(1);
  });

  it('should serialize concurrent appends from two repository instances', async () => {
    const file = path.join(tmpDir, 'conclusions.json');
    const backups = path.join(tmpDir, 'backups');
    const s1 = new ConclusionService(new JsonConclusionRepository(file, backups));
    const s2 = new ConclusionService(new JsonConclusionRepository(file, backups));

    const { id } = await s1.create(createInput(), source);
    await Promise.all([
      s1.append(id, { data: 'A', changeNote: 'a' }, source),
      s2.append(id, { data: 'B', changeNote: 'b' }, source),
    ]);

    const card = await s1.get(id);
    expect(card.revisions.map((r) => r.rev)).toEqual([1, 2, 3]);
  });
});
