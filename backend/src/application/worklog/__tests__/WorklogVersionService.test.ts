// backend/src/application/worklog/__tests__/WorklogVersionService.test.ts
// 版本 CRUD 专项测试:重名校验、级联删除、备份,
// 以及 AI 传入错误 id 时的可操作报错文案。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WorklogService } from '../WorklogService.js';
import { JsonWorklogRepository } from '../../../infrastructure/persistence/JsonWorklogRepository.js';
import {
  WorklogConflictError,
  WorklogNotFoundError,
} from '../../../domain/worklog/errors.js';

describe('WorklogService version CRUD', () => {
  let tmpDir: string;
  let backupsDir: string;
  let repo: JsonWorklogRepository;
  let service: WorklogService;
  /** 版本必须归属主题:预置一个,避免 service.createProgram 的备份影响「纯新增不备份」断言 */
  let programId: string;

  beforeEach(async () => {
    const { nanoid } = await import('nanoid');
    tmpDir = path.join(os.tmpdir(), `worklog-crud-test-${nanoid()}`);
    backupsDir = path.join(tmpDir, 'worklog-backups');
    repo = new JsonWorklogRepository(path.join(tmpDir, 'worklog.json'), backupsDir);
    service = new WorklogService(repo);
    programId = await repo.mutate((data) => {
      const id = 'g_test';
      data.programs.push({ id, name: '测试主题', createdAt: Date.now() });
      return id;
    });
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
  // createVersion
  // ---------------------------------------------------------------
  describe('createVersion', () => {
    it('creates a version with v_ id and persists description', async () => {
      const v = await service.createVersion({ name: ' V8.0.8 ', programId, description: '澳门迭代' });
      expect(v.id).toMatch(/^v_/);

      const tree = await service.getTree();
      expect(tree.versions).toHaveLength(1);
      expect(tree.versions[0]).toMatchObject({
        id: v.id, name: 'V8.0.8', description: '澳门迭代', entries: [],
      });
    });

    it('rejects duplicate version name globally', async () => {
      await service.createVersion({ name: 'V1', programId });
      await expect(service.createVersion({ name: 'V1', programId }))
        .rejects.toBeInstanceOf(WorklogConflictError);
      expect((await service.getTree()).versions).toHaveLength(1);
    });

    it('rejects empty / slash-containing / overlong names', async () => {
      await expect(service.createVersion({ name: '   ', programId })).rejects.toThrow(/版本名不能为空/);
      await expect(service.createVersion({ name: 'a/b', programId })).rejects.toThrow(/不能包含/);
      await expect(service.createVersion({ name: 'x'.repeat(61), programId })).rejects.toThrow(/长度不能超过/);
    });

    it('does not back up pure create operations', async () => {
      await service.createVersion({ name: 'V1', programId });
      expect(await listBackups()).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------
  // renameVersion / deleteVersion
  // ---------------------------------------------------------------
  describe('renameVersion / deleteVersion', () => {
    it('renames a version by id and keeps its entries', async () => {
      const v = await service.createVersion({ name: 'V1', programId });
      await service.record({ versionId: v.id, title: 't', detail: 'd', stage: 'dev' });
      const before = (await listBackups()).length;

      await service.renameVersion(v.id, 'V1.1');
      expect((await listBackups()).length).toBe(before + 1);

      const version = (await service.getTree()).versions[0];
      expect(version.name).toBe('V1.1');
      expect(version.entries).toHaveLength(1);
    });

    it('rejects unknown id and duplicate target name', async () => {
      const v1 = await service.createVersion({ name: 'V1', programId });
      await service.createVersion({ name: 'V2', programId });

      await expect(service.renameVersion('v_nope', 'V3')).rejects.toBeInstanceOf(WorklogNotFoundError);
      await expect(service.renameVersion(v1.id, 'V2')).rejects.toBeInstanceOf(WorklogConflictError);
      // 保持原名不算重名(exceptId 生效)
      await expect(service.renameVersion(v1.id, 'V1')).resolves.toBeUndefined();
      expect((await service.getTree()).versions.map((v) => v.name)).toEqual(['V1', 'V2']);
    });

    it('deletes a version with its entries', async () => {
      const v1 = await service.createVersion({ name: 'V1', programId });
      const v2 = await service.createVersion({ name: 'V2', programId });
      await service.record({ versionId: v1.id, title: 't', detail: 'd', stage: 'dev' });
      const before = (await listBackups()).length;

      await service.deleteVersion(v1.id);
      expect((await listBackups()).length).toBe(before + 1);

      const tree = await service.getTree();
      expect(tree.versions.map((v) => v.id)).toEqual([v2.id]);
      expect(tree.versions[0].entries).toHaveLength(0);
    });

    it('rejects deleting an unknown version', async () => {
      await expect(service.deleteVersion('v_nope')).rejects.toBeInstanceOf(WorklogNotFoundError);
    });
  });

  // ---------------------------------------------------------------
  // 版本名唯一性(跨版本树),不是项目内唯一
  // ---------------------------------------------------------------
  it('enforces version name uniqueness across the whole tree', async () => {
    const v1 = await service.createVersion({ name: 'V1', programId });
    const v2 = await service.createVersion({ name: 'V2', programId });
    await expect(service.createVersion({ name: 'V2', programId })).rejects.toBeInstanceOf(WorklogConflictError);
    expect((await service.getTree()).versions.map((v) => v.id)).toEqual([v1.id, v2.id]);
  });
});
