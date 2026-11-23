// backend/src/application/migration/__tests__/VersionTreeMigration.test.ts
// 旧结构(项目 → 版本 → 条目)归并为新结构(版本 → 需求 → 条目):
// 同名版本跨项目合并、条目全部保留并补项目快照、项目去掉 versions 字段。
// 全部使用 os.tmpdir() 下的临时目录,禁止触碰真实 ~/.ai-task-flow。
import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { nanoid } from 'nanoid';
import type { WorklogData, WorklogEntry, WorklogProject } from '@ai-task-flow/shared';
import { JsonWorklogRepository } from '../../../infrastructure/persistence/JsonWorklogRepository.js';
import {
  LEGACY_REQUIREMENT_TITLE,
  migrateToVersionTree,
  runVersionTreeMigration,
} from '../VersionTreeMigration.js';

/** 旧结构里的项目内版本(name/createdAt/entries) */
interface LegacyVersion {
  name: string;
  createdAt?: number;
  entries: WorklogEntry[];
}

/** 旧结构项目:新模型 WorklogProject 上多挂一个 versions 字段 */
type LegacyProject = WorklogProject & { versions: LegacyVersion[] };

function entry(id: string): WorklogEntry {
  return { id, title: `t-${id}`, detail: '', date: '2026-01-01', createdAt: 1, updatedAt: 1 };
}

function legacyProject(
  id: string,
  name: string,
  versions: LegacyVersion[],
  createdAt = 1,
): LegacyProject {
  return { id, name, createdAt, versions };
}

function legacyData(projects: LegacyProject[]): WorklogData {
  return { projects, versions: [] };
}

describe('migrateToVersionTree', () => {
  it('merges same version names across projects and keeps every entry', () => {
    const legacy = legacyData([
      legacyProject('p1', '资源加工平台', [
        { name: 'V8.0.8', createdAt: 1, entries: [entry('e1'), entry('e2')] },
      ]),
      legacyProject('p2', '组卷', [
        { name: 'V8.0.8', createdAt: 2, entries: [entry('e3')] },
      ], 2),
    ]);

    const { data, report } = migrateToVersionTree(legacy);

    expect(data.versions).toHaveLength(1);
    expect(data.versions[0].name).toBe('V8.0.8');
    expect(data.versions[0].requirements).toHaveLength(1);
    expect(data.versions[0].requirements[0].title).toBe(LEGACY_REQUIREMENT_TITLE);
    expect(data.versions[0].requirements[0].entries).toHaveLength(3);
    expect(data.versions[0].requirements[0].entries.map((e) => e.project)).toEqual([
      '资源加工平台',
      '资源加工平台',
      '组卷',
    ]);
    // projectId 能映射时补上
    expect(data.versions[0].requirements[0].entries.map((e) => e.projectId)).toEqual([
      'p1',
      'p1',
      'p2',
    ]);
    // 条目原样保留(id 不丢)
    expect(data.versions[0].requirements[0].entries.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    expect(report.entriesMoved).toBe(3);
    expect(report.versionsCreated).toBe(1);
    expect(report.requirementsCreated).toBe(1);
    // 跨项目同名版本只报告不拆分
    expect(report.duplicateVersionNames).toEqual(['V8.0.8']);
    // 项目降级为字典:保留身份字段,移除 versions
    expect(data.projects).toEqual([
      { id: 'p1', name: '资源加工平台', createdAt: 1 },
      { id: 'p2', name: '组卷', createdAt: 2 },
    ]);
    expect('versions' in data.projects[0]).toBe(false);
  });

  it('is idempotent', () => {
    const legacy = legacyData([
      legacyProject('p1', '资源加工平台', [
        { name: 'V8.0.8', createdAt: 1, entries: [entry('e1')] },
      ]),
    ]);
    const once = migrateToVersionTree(legacy).data;
    const twice = migrateToVersionTree(once).data;
    expect(twice).toEqual(once);
    // 已迁移时不再产生任何计数
    expect(migrateToVersionTree(once).report.entriesMoved).toBe(0);
  });

  it('migrates non-business versions (worklog-template / v0.3.0)', () => {
    const legacy = legacyData([
      legacyProject('p1', 'ai-task-flow', [
        { name: 'worklog-template', createdAt: 1, entries: [entry('e1')] },
        { name: 'v0.3.0', createdAt: 2, entries: [entry('e2')] },
      ]),
    ]);

    const { data, report } = migrateToVersionTree(legacy);

    expect(data.versions.map((v) => v.name).sort()).toEqual(['v0.3.0', 'worklog-template']);
    for (const version of data.versions) {
      expect(version.requirements).toHaveLength(1);
      expect(version.requirements[0].title).toBe(LEGACY_REQUIREMENT_TITLE);
      expect(version.requirements[0].entries).toHaveLength(1);
    }
    expect(report.versionsCreated).toBe(2);
    expect(report.entriesMoved).toBe(2);
  });

  it('ignores projects whose legacy versions array is empty', () => {
    const legacy = legacyData([
      legacyProject('p1', '空项目', []),
      legacyProject('p2', '组卷', [
        { name: 'V8.0.8', createdAt: 1, entries: [entry('e1')] },
      ]),
    ]);

    const { data, report } = migrateToVersionTree(legacy);

    // 空 versions 不制造版本/需求,但项目本身保留
    expect(data.versions).toHaveLength(1);
    expect(data.versions[0].requirements[0].entries).toHaveLength(1);
    expect(data.projects.map((p) => p.name)).toEqual(['空项目', '组卷']);
    expect(report.versionsCreated).toBe(1);
    expect(report.entriesMoved).toBe(1);
  });

  it('merges legacy versions into an already-populated version tree', () => {
    // 混合态:新版本树已存在(另一进程先写了新结构),旧项目的 versions 还没清掉
    const mixed: WorklogData = {
      projects: [
        { id: 'p1', name: '资源加工平台', createdAt: 1, versions: [
          { name: 'V8.0.8', createdAt: 1, entries: [entry('e_old')] },
        ] } as LegacyProject,
      ],
      versions: [
        {
          id: 'v1',
          name: 'V8.0.8',
          createdAt: 5,
          requirements: [
            { id: 'r1', title: '新需求', createdAt: 5, entries: [entry('e_new')] },
          ],
        },
      ],
    };

    const { data, report } = migrateToVersionTree(mixed);

    expect(data.versions).toHaveLength(1);
    expect(data.versions[0].id).toBe('v1');
    // 旧条目挂到同名的迁移需求下,不会混进已有需求
    const legacyRequirement = data.versions[0].requirements.find(
      (r) => r.title === LEGACY_REQUIREMENT_TITLE,
    )!;
    expect(legacyRequirement.entries.map((e) => e.id)).toEqual(['e_old']);
    const existingRequirement = data.versions[0].requirements.find((r) => r.id === 'r1')!;
    expect(existingRequirement.entries.map((e) => e.id)).toEqual(['e_new']);
    expect(report.versionsCreated).toBe(0);
    expect(report.requirementsCreated).toBe(1);
    expect(report.entriesMoved).toBe(1);
    expect('versions' in data.projects[0]).toBe(false);
  });

  it('reuses the migration requirement when a version already has it', () => {
    const mixed: WorklogData = {
      projects: [
        { id: 'p1', name: '资源加工平台', createdAt: 1, versions: [
          { name: 'V8.0.8', createdAt: 1, entries: [entry('e_old')] },
        ] } as LegacyProject,
      ],
      versions: [
        {
          id: 'v1',
          name: 'V8.0.8',
          createdAt: 5,
          requirements: [
            { id: 'r1', title: LEGACY_REQUIREMENT_TITLE, createdAt: 5, entries: [] },
          ],
        },
      ],
    };

    const { data, report } = migrateToVersionTree(mixed);

    expect(data.versions[0].requirements).toHaveLength(1);
    expect(data.versions[0].requirements[0].id).toBe('r1');
    expect(data.versions[0].requirements[0].entries.map((e) => e.id)).toEqual(['e_old']);
    expect(report.requirementsCreated).toBe(0);
  });
});

describe('runVersionTreeMigration', () => {
  let worklogRepo: JsonWorklogRepository;
  let dir: string;

  beforeEach(async () => {
    dir = path.join(os.tmpdir(), `mig-vt-${nanoid()}`);
    await fs.mkdir(dir, { recursive: true });
    worklogRepo = new JsonWorklogRepository(path.join(dir, 'worklog.json'), path.join(dir, 'wb'));
    // 旧数据:两个项目各自持有同名版本
    await worklogRepo.mutate((d) => {
      d.projects.push(
        {
          id: 'p1', name: '资源加工平台', createdAt: 1, versions: [
            { name: 'V8.0.8', createdAt: 1, entries: [entry('e1'), entry('e2')] },
          ],
        } as never,
        {
          id: 'p2', name: '组卷', createdAt: 2, versions: [
            { name: 'V8.0.8', createdAt: 2, entries: [entry('e3')] },
            { name: 'worklog-template', createdAt: 3, entries: [entry('e4')] },
          ],
        } as never,
      );
    });
  });

  it('migrates the legacy file, writes a marker and leaves a backup snapshot', async () => {
    const report = await runVersionTreeMigration({ dataDir: dir, worklogRepo });

    expect(report.skipped).toBe(false);
    expect(report.versionsCreated).toBe(2);
    expect(report.requirementsCreated).toBe(2);
    expect(report.entriesMoved).toBe(4);
    expect(report.duplicateVersionNames).toEqual(['V8.0.8']);

    const data = await worklogRepo.load();
    expect(data.versions.map((v) => v.name).sort()).toEqual(['V8.0.8', 'worklog-template']);
    const totalEntries = data.versions.flatMap((v) => v.requirements.flatMap((r) => r.entries));
    expect(totalEntries).toHaveLength(4);
    expect(data.projects.every((p) => !('versions' in p))).toBe(true);

    // 标记文件(原子写产物)为版本 1
    const marker = JSON.parse(
      await fs.readFile(path.join(dir, '.migration-version-tree.json'), 'utf8'),
    ) as { version: number };
    expect(marker.version).toBe(1);

    // 破坏性写入必须留快照
    expect((await fs.readdir(path.join(dir, 'wb'))).length).toBeGreaterThan(0);
  });

  it('is idempotent at file level: second run skips and leaves the bytes unchanged', async () => {
    const first = await runVersionTreeMigration({ dataDir: dir, worklogRepo });
    expect(first.skipped).toBe(false);

    const worklogFile = path.join(dir, 'worklog.json');
    const hash = async () => (await fs.readFile(worklogFile)).toString('base64');
    const before = await hash();

    const second = await runVersionTreeMigration({ dataDir: dir, worklogRepo });

    expect(second.skipped).toBe(true);
    expect(second.entriesMoved).toBe(0);
    expect(second.versionsCreated).toBe(0);
    expect(await hash()).toBe(before);
  });

  it('does nothing (and marks skipped) on an already-migrated data dir', async () => {
    // 全新(或已迁移)数据:没有任何旧结构,直接跳过
    const freshDir = path.join(os.tmpdir(), `mig-vt-fresh-${nanoid()}`);
    await fs.mkdir(freshDir, { recursive: true });
    const repo = new JsonWorklogRepository(
      path.join(freshDir, 'worklog.json'),
      path.join(freshDir, 'wb'),
    );

    const report = await runVersionTreeMigration({ dataDir: freshDir, worklogRepo: repo });
    expect(report.skipped).toBe(true);
    expect(report.entriesMoved).toBe(0);
    // 未写入任何 worklog 数据文件
    await expect(fs.access(path.join(freshDir, 'worklog.json'))).rejects.toThrow();
  });
});
