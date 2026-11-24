// backend/src/application/worklog/__tests__/WorklogProgram.test.ts
// 建设主题(顶层)CRUD 与版本归属测试:主题名唯一、版本 programId 校验、
// 级联删除(版本/需求/条目)、备份与主题汇总。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WorklogService } from '../WorklogService.js';
import { JsonWorklogRepository } from '../../../infrastructure/persistence/JsonWorklogRepository.js';
import {
  WorklogConflictError,
  WorklogNotFoundError,
  WorklogValidationError,
} from '../../../domain/worklog/errors.js';

describe('WorklogService program CRUD', () => {
  let tmpDir: string;
  let backupsDir: string;
  let repo: JsonWorklogRepository;
  let service: WorklogService;

  beforeEach(async () => {
    const { nanoid } = await import('nanoid');
    tmpDir = path.join(os.tmpdir(), `worklog-program-test-${nanoid()}`);
    backupsDir = path.join(tmpDir, 'worklog-backups');
    repo = new JsonWorklogRepository(path.join(tmpDir, 'worklog.json'), backupsDir);
    service = new WorklogService(repo);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function listBackups(): Promise<string[]> {
    try {
      return (await fs.readdir(backupsDir)).filter((n) => n.endsWith('.json')).sort();
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------
  // createProgram
  // ---------------------------------------------------------------
  describe('createProgram', () => {
    it('creates a program with g_ id and persists description', async () => {
      const g = await service.createProgram({ name: ' 澳门底层数据建设 ', description: '说明' });
      expect(g.id).toMatch(/^g_/);

      const tree = await service.getTree();
      expect(tree.programs).toHaveLength(1);
      expect(tree.programs[0]).toMatchObject({
        id: g.id, name: '澳门底层数据建设', description: '说明',
      });
    });

    it('rejects empty / slash-containing / overlong names', async () => {
      await expect(service.createProgram({ name: '   ' })).rejects.toThrow(/主题名不能为空/);
      await expect(service.createProgram({ name: 'a/b' })).rejects.toThrow(/不能包含/);
      await expect(service.createProgram({ name: 'x'.repeat(61) })).rejects.toThrow(/长度不能超过/);
      expect((await service.getTree()).programs).toHaveLength(0);
    });

    it('rejects duplicate program name globally', async () => {
      await service.createProgram({ name: '澳门底层数据建设' });
      await expect(service.createProgram({ name: '澳门底层数据建设' }))
        .rejects.toBeInstanceOf(WorklogConflictError);
      expect((await service.getTree()).programs).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------
  // createVersion 主题归属
  // ---------------------------------------------------------------
  describe('createVersion with programId', () => {
    it('creates a program and a version under it', async () => {
      const g = await service.createProgram({ name: '澳门底层数据建设' });
      const v = await service.createVersion({ name: 'V8.0.8', programId: g.id });

      const tree = await service.getTree();
      expect(tree.versions.find((x) => x.id === v.id)?.programId).toBe(g.id);
    });

    it('rejects version with unknown program and lists candidates', async () => {
      const existing = await service.createProgram({ name: '澳门底层数据建设' });
      await expect(service.createVersion({ name: 'V1', programId: 'g_nope' }))
        .rejects.toBeInstanceOf(WorklogNotFoundError);
      await expect(service.createVersion({ name: 'V1', programId: 'g_nope' }))
        .rejects.toThrow(new RegExp(`现有主题：澳门底层数据建设\\(${existing.id}\\)`));
      expect((await service.getTree()).versions).toHaveLength(0);
    });

    it('rejects an empty programId', async () => {
      await expect(service.createVersion({ name: 'V1', programId: '   ' }))
        .rejects.toThrow(/主题 .* 不存在/);
    });
  });

  // ---------------------------------------------------------------
  // renameProgram
  // ---------------------------------------------------------------
  describe('renameProgram', () => {
    it('renames a program and backs up, keeping its versions', async () => {
      const g = await service.createProgram({ name: 'G1' });
      const v = await service.createVersion({ name: 'V1', programId: g.id });
      const before = (await listBackups()).length;

      await service.renameProgram(g.id, 'G2');
      expect((await listBackups()).length).toBe(before + 1);

      const tree = await service.getTree();
      expect(tree.programs[0].name).toBe('G2');
      expect(tree.versions.find((x) => x.id === v.id)?.programId).toBe(g.id);
      // 版本名不受主题改名影响
      expect(tree.versions[0].name).toBe('V1');
    });

    it('rejects unknown id and duplicate target name', async () => {
      const g1 = await service.createProgram({ name: 'G1' });
      await service.createProgram({ name: 'G2' });

      await expect(service.renameProgram('g_nope', 'G3')).rejects.toBeInstanceOf(WorklogNotFoundError);
      await expect(service.renameProgram(g1.id, 'G2')).rejects.toBeInstanceOf(WorklogConflictError);
      // 保持原名不算重名(exceptId 生效)
      await expect(service.renameProgram(g1.id, 'G1')).resolves.toBeUndefined();
      expect((await service.getTree()).programs.map((p) => p.name)).toEqual(['G1', 'G2']);
    });
  });

  // ---------------------------------------------------------------
  // deleteProgram
  // ---------------------------------------------------------------
  describe('deleteProgram', () => {
    it('deletes program with its versions, requirements and entries, and backs up', async () => {
      const g = await service.createProgram({ name: 'G' });
      const v = await service.createVersion({ name: 'V', programId: g.id });
      const r = await service.createRequirement({ versionId: v.id, title: 'R' });
      await service.record({ versionId: v.id, requirementId: r.id, title: 't', detail: 'd', stage: 'dev' });
      const before = (await listBackups()).length;

      await service.deleteProgram(g.id);
      expect((await listBackups()).length).toBe(before + 1);

      const tree = await service.getTree();
      expect(tree.programs.find((p) => p.id === g.id)).toBeUndefined();
      expect(tree.versions).toHaveLength(0);
    });

    it('only deletes versions of the target program', async () => {
      const g1 = await service.createProgram({ name: 'G1' });
      const g2 = await service.createProgram({ name: 'G2' });
      const v1 = await service.createVersion({ name: 'V1', programId: g1.id });
      const v2 = await service.createVersion({ name: 'V2', programId: g2.id });
      const r2 = await service.createRequirement({ versionId: v2.id, title: 'R2' });
      await service.record({ versionId: v2.id, requirementId: r2.id, title: 't', detail: 'd', stage: 'dev' });

      await service.deleteProgram(g1.id);

      const tree = await service.getTree();
      expect(tree.programs.map((p) => p.id)).toEqual([g2.id]);
      expect(tree.versions.map((x) => x.id)).toEqual([v2.id]);
      // 其他主题的需求与条目不受影响
      expect(tree.versions[0].requirements[0].entries).toHaveLength(1);
      void v1;
    });

    it('rejects deleting an unknown program', async () => {
      await expect(service.deleteProgram('g_nope')).rejects.toBeInstanceOf(WorklogNotFoundError);
    });
  });

  // ---------------------------------------------------------------
  // listPrograms / getTree
  // ---------------------------------------------------------------
  describe('listPrograms', () => {
    it('aggregates versionCount and entryCount per program', async () => {
      const g1 = await service.createProgram({ name: 'G1' });
      const g2 = await service.createProgram({ name: 'G2' });

      const v1 = await service.createVersion({ name: 'V1', programId: g1.id });
      const v2 = await service.createVersion({ name: 'V2', programId: g1.id });
      await service.createVersion({ name: 'V3', programId: g2.id });

      const r1 = await service.createRequirement({ versionId: v1.id, title: 'R1' });
      await service.record({ versionId: v1.id, requirementId: r1.id, title: 'a', detail: 'd', stage: 'dev' });
      await service.record({ versionId: v1.id, requirementId: r1.id, title: 'b', detail: 'd', stage: 'dev' });
      const r2 = await service.createRequirement({ versionId: v2.id, title: 'R2' });
      await service.record({ versionId: v2.id, requirementId: r2.id, title: 'c', detail: 'd', stage: 'dev' });

      const summaries = await service.listPrograms();
      expect(summaries).toEqual([
        { id: g1.id, name: 'G1', versionCount: 2, entryCount: 3 },
        { id: g2.id, name: 'G2', versionCount: 1, entryCount: 0 },
      ]);
    });

    it('returns an empty array when there are no programs', async () => {
      expect(await service.listPrograms()).toEqual([]);
      expect((await service.getTree()).programs).toEqual([]);
    });
  });
});
