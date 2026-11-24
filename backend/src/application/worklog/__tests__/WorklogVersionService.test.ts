// backend/src/application/worklog/__tests__/WorklogVersionService.test.ts
// 版本/需求 CRUD 专项测试:重名校验、关联项目必须存在、级联删除、备份、
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
  WorklogValidationError,
} from '../../../domain/worklog/errors.js';

describe('WorklogService version/requirement CRUD', () => {
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

  async function seedProject(name: string, extra?: { id?: string | null }): Promise<string> {
    const id = extra?.id === null ? undefined : (extra?.id ?? `p_${name}`);
    return repo.mutate((data) => {
      data.projects.push({ id, name, createdAt: Date.now() } as (typeof data.projects)[number]);
      return id ?? '';
    });
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
        id: v.id, name: 'V8.0.8', description: '澳门迭代', requirements: [],
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
      const v = await service.createVersion({ name: 'V1', programId });
      await seedProject('题库');
      await service.createRequirement({ versionId: v.id, title: 'R', projects: ['题库'] });
      expect(await listBackups()).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------
  // createRequirement
  // ---------------------------------------------------------------
  describe('createRequirement', () => {
    it('creates a requirement with r_ id and project snapshots', async () => {
      const projectId = await seedProject('题库');
      const v = await service.createVersion({ name: 'V1', programId });

      const r = await service.createRequirement({
        versionId: v.id, title: '澳门底层数据建设', description: '说明', projects: ['题库'],
      });
      expect(r.id).toMatch(/^r_/);

      const requirement = (await service.getTree()).versions[0].requirements[0];
      expect(requirement).toMatchObject({
        id: r.id,
        title: '澳门底层数据建设',
        description: '说明',
        projects: ['题库'],
        projectIds: [projectId],
        entries: [],
      });
    });

    it('rejects unknown version with actionable message', async () => {
      await expect(service.createRequirement({ versionId: 'v_nope', title: 'R' }))
        .rejects.toBeInstanceOf(WorklogNotFoundError);
      await expect(service.createRequirement({ versionId: 'v_nope', title: 'R' }))
        .rejects.toThrow(/请让用户在页面创建并复制 id/);
    });

    it('rejects duplicate title within the same version only', async () => {
      const v1 = await service.createVersion({ name: 'V1', programId });
      const v2 = await service.createVersion({ name: 'V2', programId });
      await service.createRequirement({ versionId: v1.id, title: 'R' });

      await expect(service.createRequirement({ versionId: v1.id, title: 'R' }))
        .rejects.toBeInstanceOf(WorklogConflictError);
      // 不同版本允许同名需求
      await expect(service.createRequirement({ versionId: v2.id, title: 'R' }))
        .resolves.toHaveProperty('id');
    });

    it('rejects unknown project and dedupes repeated names', async () => {
      await seedProject('题库');
      const v = await service.createVersion({ name: 'V1', programId });

      await expect(service.createRequirement({ versionId: v.id, title: 'R', projects: ['不存在'] }))
        .rejects.toThrow(/项目不存在:不存在/);

      const r = await service.createRequirement({ versionId: v.id, title: 'R2', projects: ['题库', '题库'] });
      const requirement = (await service.getTree()).versions[0].requirements
        .find((item) => item.id === r.id)!;
      expect(requirement.projects).toEqual(['题库']);
      expect(requirement.projectIds).toEqual(['p_题库']);
    });

    it('allows slashes in requirement titles but rejects empty/overlong ones', async () => {
      const v = await service.createVersion({ name: 'V1', programId });
      await expect(service.createRequirement({ versionId: v.id, title: '登录/白屏修复' }))
        .resolves.toHaveProperty('id');
      await expect(service.createRequirement({ versionId: v.id, title: ' ' }))
        .rejects.toBeInstanceOf(WorklogValidationError);
      await expect(service.createRequirement({ versionId: v.id, title: 'x'.repeat(201) }))
        .rejects.toThrow(/长度不能超过 200/);
    });

    it('skips projects without stable id instead of writing undefined projectIds', async () => {
      await seedProject('无id项目', { id: null });
      const v = await service.createVersion({ name: 'V1', programId });
      const r = await service.createRequirement({
        versionId: v.id, title: 'R', projects: ['无id项目'],
      });
      const requirement = (await service.getTree()).versions[0].requirements
        .find((item) => item.id === r.id)!;
      expect(requirement.projects).toBeUndefined();
      expect(requirement.projectIds).toBeUndefined();
    });

    it('lists existing versions as candidates when version is unknown', async () => {
      const existing = await service.createVersion({ name: 'V8.0.7', programId });
      await expect(service.createRequirement({ versionId: 'v_nope', title: 'R' }))
        .rejects.toThrow(new RegExp(`现有版本：V8\\.0\\.7\\(${existing.id}\\)`));
    });
  });

  // ---------------------------------------------------------------
  // renameVersion / deleteVersion
  // ---------------------------------------------------------------
  describe('renameVersion / deleteVersion', () => {
    it('renames a version by id and keeps its requirements/entries', async () => {
      const v = await service.createVersion({ name: 'V1', programId });
      const r = await service.createRequirement({ versionId: v.id, title: 'R' });
      await service.record({ versionId: v.id, requirementId: r.id, title: 't', detail: 'd', stage: 'dev' });
      const before = (await listBackups()).length;

      await service.renameVersion(v.id, 'V1.1');
      expect((await listBackups()).length).toBe(before + 1);

      const version = (await service.getTree()).versions[0];
      expect(version.name).toBe('V1.1');
      expect(version.requirements[0].entries).toHaveLength(1);
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

    it('deletes a version with its requirements and entries', async () => {
      const v1 = await service.createVersion({ name: 'V1', programId });
      const v2 = await service.createVersion({ name: 'V2', programId });
      const r = await service.createRequirement({ versionId: v1.id, title: 'R' });
      await service.record({ versionId: v1.id, requirementId: r.id, title: 't', detail: 'd', stage: 'dev' });
      const before = (await listBackups()).length;

      await service.deleteVersion(v1.id);
      expect((await listBackups()).length).toBe(before + 1);

      const tree = await service.getTree();
      expect(tree.versions.map((v) => v.id)).toEqual([v2.id]);
      expect(tree.versions[0].requirements).toHaveLength(0);
    });

    it('rejects deleting an unknown version', async () => {
      await expect(service.deleteVersion('v_nope')).rejects.toBeInstanceOf(WorklogNotFoundError);
    });
  });

  // ---------------------------------------------------------------
  // renameRequirement / deleteRequirement
  // ---------------------------------------------------------------
  describe('renameRequirement / deleteRequirement', () => {
    it('renames a requirement and rejects duplicates within the version', async () => {
      const v = await service.createVersion({ name: 'V1', programId });
      const r1 = await service.createRequirement({ versionId: v.id, title: 'R1' });
      await service.createRequirement({ versionId: v.id, title: 'R2' });
      const before = (await listBackups()).length;

      await service.renameRequirement(v.id, r1.id, 'R1-new');
      expect((await listBackups()).length).toBe(before + 1);
      expect((await service.getTree()).versions[0].requirements.map((r) => r.title))
        .toEqual(['R1-new', 'R2']);

      await expect(service.renameRequirement(v.id, r1.id, 'R2'))
        .rejects.toBeInstanceOf(WorklogConflictError);
    });

    it('rejects requirement that does not belong to the version', async () => {
      const v1 = await service.createVersion({ name: 'V1', programId });
      const v2 = await service.createVersion({ name: 'V2', programId });
      const r1 = await service.createRequirement({ versionId: v1.id, title: 'R' });

      await expect(service.renameRequirement(v2.id, r1.id, 'X')).rejects.toThrow(/不属于该版本/);
      await expect(service.deleteRequirement(v2.id, r1.id)).rejects.toThrow(/不属于该版本/);
      // 数据未变
      expect((await service.getTree()).versions[0].requirements[0].title).toBe('R');
    });

    it('rejects unknown version when operating on requirements', async () => {
      await expect(service.renameRequirement('v_nope', 'r_nope', 'X'))
        .rejects.toBeInstanceOf(WorklogNotFoundError);
      await expect(service.deleteRequirement('v_nope', 'r_nope'))
        .rejects.toBeInstanceOf(WorklogNotFoundError);
    });

    it('deletes a requirement with its entries but keeps siblings', async () => {
      const v = await service.createVersion({ name: 'V1', programId });
      const r1 = await service.createRequirement({ versionId: v.id, title: 'R1' });
      const r2 = await service.createRequirement({ versionId: v.id, title: 'R2' });
      await service.record({ versionId: v.id, requirementId: r1.id, title: 'a', detail: 'd', stage: 'dev' });
      await service.record({ versionId: v.id, requirementId: r2.id, title: 'b', detail: 'd', stage: 'dev' });
      const before = (await listBackups()).length;

      await service.deleteRequirement(v.id, r1.id);
      expect((await listBackups()).length).toBe(before + 1);

      const requirements = (await service.getTree()).versions[0].requirements;
      expect(requirements.map((r) => r.id)).toEqual([r2.id]);
      expect(requirements[0].entries).toHaveLength(1);
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
