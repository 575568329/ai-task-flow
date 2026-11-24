// backend/src/application/migration/__tests__/VersionTreeMigration.test.ts
// 旧结构(项目 → 版本 → 条目)归并为新结构(版本 → 需求 → 条目):
// 同名版本跨项目合并、条目全部保留并补项目快照、项目去掉 versions 字段。
// 全部使用 os.tmpdir() 下的临时目录,禁止触碰真实 ~/.ai-task-flow。
import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { nanoid } from 'nanoid';
import type {
  WorklogData,
  WorklogEntry,
  WorklogProject,
  WorklogVersion,
} from '@ai-task-flow/shared';
import { JsonWorklogRepository } from '../../../infrastructure/persistence/JsonWorklogRepository.js';
import {
  DEFAULT_PROGRAM_NAME,
  LEGACY_REQUIREMENT_TITLE,
  isProgramLayerMigrated,
  migrateFlatEntries,
  migrateProgramLayer,
  migrateToVersionTree,
  needsFlatEntriesMigration,
  needsProgramLayerMigration,
  runFlatEntriesMigration,
  runProgramLayerMigration,
  runVersionTreeMigration,
} from '../VersionTreeMigration.js';

/** shared 已移除需求层,测试保留旧数据的「需求」形状只用于构造/断言迁移输入输出 */
interface LegacyRequirement {
  id: string;
  title: string;
  createdAt: number;
  entries: WorklogEntry[];
}

/** 读取版本上的需求层(v1/v2 中间态);已扁平化的版本返回空数组 */
function requirementsOf(version: unknown): LegacyRequirement[] {
  return (version as WorklogVersion & { requirements?: LegacyRequirement[] }).requirements ?? [];
}

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
  return { projects, programs: [], versions: [] };
}

/** 需求夹具(迁移 v2 只关心标题与条目是否保留) */
function requirement(id: string, title: string, entries: WorklogEntry[] = []): LegacyRequirement {
  return { id, title, createdAt: 1, entries };
}

/** 迁移前的版本夹具:旧数据没有 programId */
function unassignedVersion(
  id: string,
  name: string,
  requirements: LegacyRequirement[],
  createdAt = 1,
): Record<string, unknown> {
  return { id, name, createdAt, requirements };
}

/** 迁移前的整体数据:旧数据没有 programs 字段 */
function unassignedData(versions: Array<Record<string, unknown>>): WorklogData {
  return { projects: [], versions } as unknown as WorklogData;
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
    expect(requirementsOf(data.versions[0])).toHaveLength(1);
    expect(requirementsOf(data.versions[0])[0].title).toBe(LEGACY_REQUIREMENT_TITLE);
    expect(requirementsOf(data.versions[0])[0].entries).toHaveLength(3);
    expect(requirementsOf(data.versions[0])[0].entries.map((e) => e.project)).toEqual([
      '资源加工平台',
      '资源加工平台',
      '组卷',
    ]);
    // projectId 能映射时补上
    expect(requirementsOf(data.versions[0])[0].entries.map((e) => e.projectId)).toEqual([
      'p1',
      'p1',
      'p2',
    ]);
    // 条目原样保留(id 不丢)
    expect(requirementsOf(data.versions[0])[0].entries.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
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
      expect(requirementsOf(version)).toHaveLength(1);
      expect(requirementsOf(version)[0].title).toBe(LEGACY_REQUIREMENT_TITLE);
      expect(requirementsOf(version)[0].entries).toHaveLength(1);
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
    expect(requirementsOf(data.versions[0])[0].entries).toHaveLength(1);
    expect(data.projects.map((p) => p.name)).toEqual(['空项目', '组卷']);
    expect(report.versionsCreated).toBe(1);
    expect(report.entriesMoved).toBe(1);
  });

  it('merges legacy versions into an already-populated version tree', () => {
    // 混合态:新版本树已存在(另一进程先写了新结构),旧项目的 versions 还没清掉
    const mixed = {
      projects: [
        { id: 'p1', name: '资源加工平台', createdAt: 1, versions: [
          { name: 'V8.0.8', createdAt: 1, entries: [entry('e_old')] },
        ] } as LegacyProject,
      ],
      programs: [],
      versions: [
        {
          id: 'v1',
          name: 'V8.0.8',
          programId: '',
          createdAt: 5,
          requirements: [
            { id: 'r1', title: '新需求', createdAt: 5, entries: [entry('e_new')] },
          ],
        },
      ],
    } as unknown as WorklogData;

    const { data, report } = migrateToVersionTree(mixed);

    expect(data.versions).toHaveLength(1);
    expect(data.versions[0].id).toBe('v1');
    // 旧条目挂到同名的迁移需求下,不会混进已有需求
    const legacyRequirement = requirementsOf(data.versions[0]).find(
      (r) => r.title === LEGACY_REQUIREMENT_TITLE,
    )!;
    expect(legacyRequirement.entries.map((e) => e.id)).toEqual(['e_old']);
    const existingRequirement = requirementsOf(data.versions[0]).find((r) => r.id === 'r1')!;
    expect(existingRequirement.entries.map((e) => e.id)).toEqual(['e_new']);
    expect(report.versionsCreated).toBe(0);
    expect(report.requirementsCreated).toBe(1);
    expect(report.entriesMoved).toBe(1);
    expect('versions' in data.projects[0]).toBe(false);
  });

  it('does not mutate its input: repeated calls on the same mixed object are stable', () => {
    const mixed = {
      projects: [
        { id: 'p1', name: '资源加工平台', createdAt: 1, versions: [
          { name: 'V8.0.8', createdAt: 1, entries: [entry('e_old')] },
        ] } as LegacyProject,
      ],
      programs: [],
      versions: [
        {
          id: 'v1',
          name: 'V8.0.8',
          programId: '',
          createdAt: 5,
          requirements: [
            { id: 'r1', title: LEGACY_REQUIREMENT_TITLE, createdAt: 5, entries: [entry('e_new')] },
          ],
        },
      ],
    } as unknown as WorklogData;

    const first = migrateToVersionTree(mixed);
    const second = migrateToVersionTree(mixed);

    // 第二次结果与第一次完全一致,条目不会翻倍
    expect(second.data).toEqual(first.data);
    expect(requirementsOf(first.data.versions[0])[0].entries.map((e) => e.id)).toEqual([
      'e_new',
      'e_old',
    ]);
    // 入参原对象未被就地改写(旧版本、已有需求都保持原样)
    expect((mixed.projects[0] as LegacyProject).versions[0].entries).toHaveLength(1);
    expect(requirementsOf(mixed.versions[0])[0].entries.map((e) => e.id)).toEqual(['e_new']);
    expect(requirementsOf(mixed.versions[0])).toHaveLength(1);
  });

  it('reuses the migration requirement when a version already has it', () => {
    const mixed = {
      projects: [
        { id: 'p1', name: '资源加工平台', createdAt: 1, versions: [
          { name: 'V8.0.8', createdAt: 1, entries: [entry('e_old')] },
        ] } as LegacyProject,
      ],
      programs: [],
      versions: [
        {
          id: 'v1',
          name: 'V8.0.8',
          programId: '',
          createdAt: 5,
          requirements: [
            { id: 'r1', title: LEGACY_REQUIREMENT_TITLE, createdAt: 5, entries: [] },
          ],
        },
      ],
    } as unknown as WorklogData;

    const { data, report } = migrateToVersionTree(mixed);

    expect(requirementsOf(data.versions[0])).toHaveLength(1);
    expect(requirementsOf(data.versions[0])[0].id).toBe('r1');
    expect(requirementsOf(data.versions[0])[0].entries.map((e) => e.id)).toEqual(['e_old']);
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
    const totalEntries = data.versions.flatMap((v) => requirementsOf(v).flatMap((r) => r.entries ?? []));
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

describe('migrateProgramLayer', () => {
  it('promotes 澳门底层数据建设 to one program across versions and keeps the requirement', () => {
    const migrated = unassignedData([
      unassignedVersion('v1', 'V8.0.8', [
        requirement('r1', LEGACY_REQUIREMENT_TITLE, [entry('e1')]),
      ]),
      unassignedVersion('v2', 'V8.0.9', [requirement('r2', LEGACY_REQUIREMENT_TITLE)], 2),
    ]);

    const { data, report } = migrateProgramLayer(migrated);

    // 同名需求跨版本聚合为一个主题
    expect(data.programs).toHaveLength(1);
    expect(data.programs[0].name).toBe(LEGACY_REQUIREMENT_TITLE);
    expect(data.programs[0].id).toMatch(/^g_/);
    expect(data.versions.every((v) => v.programId === data.programs[0].id)).toBe(true);
    // 需求/条目保留,标题不改
    expect(requirementsOf(data.versions[0])).toHaveLength(1);
    expect(requirementsOf(data.versions[0])[0].title).toBe(LEGACY_REQUIREMENT_TITLE);
    expect(requirementsOf(data.versions[0])[0].entries.map((e) => e.id)).toEqual(['e1']);
    expect(requirementsOf(data.versions[1])[0].title).toBe(LEGACY_REQUIREMENT_TITLE);
    expect(report).toEqual({ programsCreated: 1, versionsAssigned: 2 });

    // 纯函数不改写入参(旧数据本来没有 programs / programId)
    expect('programs' in migrated).toBe(false);
    expect((migrated.versions[0] as { programId?: string }).programId).toBeUndefined();
  });

  it('assigns versions whose programId is an empty string (v1 intermediate state)', () => {
    // 迁移 v1 新建版本时写 programId: ''(占位),v2 必须把它归入主题
    const source = {
      projects: [],
      programs: [],
      versions: [
        {
          ...unassignedVersion('v1', 'V8.0.8', [requirement('r1', LEGACY_REQUIREMENT_TITLE)]),
          programId: '',
        },
      ],
    } as unknown as WorklogData;

    const { data, report } = migrateProgramLayer(source);

    expect(data.programs).toHaveLength(1);
    expect(data.programs[0].name).toBe(LEGACY_REQUIREMENT_TITLE);
    expect(data.versions[0].programId).toBe(data.programs[0].id);
    expect(report).toEqual({ programsCreated: 1, versionsAssigned: 1 });
  });

  it('reassigns a version whose programId points to a missing program (dangling)', () => {
    const source = {
      projects: [],
      programs: [{ id: 'g_gone', name: '旧主题', createdAt: 1 }],
      versions: [
        {
          ...unassignedVersion('v1', 'V8.0.8', [requirement('r1', LEGACY_REQUIREMENT_TITLE)]),
          // 指向不存在的主题(programs 里只有 g_gone),属于悬空归属
          programId: 'g_missing',
        },
      ],
    } as unknown as WorklogData;

    const { data, report } = migrateProgramLayer(source);

    // 悬空 programId 不算已归属:按需求标题重新建主题并归属
    const target = data.programs.find((p) => p.name === LEGACY_REQUIREMENT_TITLE)!;
    expect(target).toBeDefined();
    expect(data.versions[0].programId).toBe(target.id);
    // 既有主题不删除
    expect(data.programs.some((p) => p.id === 'g_gone')).toBe(true);
    expect(report).toEqual({ programsCreated: 1, versionsAssigned: 1 });
  });

  it('assigns versions without the legacy requirement to 未分类建设', () => {
    const source = unassignedData([
      unassignedVersion('v1', 'V8.0.8', [requirement('r1', LEGACY_REQUIREMENT_TITLE)]),
      unassignedVersion('v2', 'V8.0.9', [requirement('r2', '其他需求')], 2),
    ]);

    const { data, report } = migrateProgramLayer(source);

    expect(report.programsCreated).toBe(2);
    expect(new Set(data.programs.map((p) => p.name))).toEqual(
      new Set([LEGACY_REQUIREMENT_TITLE, DEFAULT_PROGRAM_NAME]),
    );
    const defaultProgram = data.programs.find((p) => p.name === DEFAULT_PROGRAM_NAME)!;
    expect(data.versions[1].programId).toBe(defaultProgram.id);
    // 原需求原样保留
    expect(requirementsOf(data.versions[1]).map((r) => r.title)).toEqual(['其他需求']);
  });

  it('reuses an existing program with the same name instead of creating a duplicate', () => {
    const source = {
      projects: [],
      programs: [{ id: 'g_existing', name: LEGACY_REQUIREMENT_TITLE, createdAt: 1 }],
      versions: [
        unassignedVersion('v1', 'V8.0.8', [requirement('r1', LEGACY_REQUIREMENT_TITLE)]),
      ],
    } as unknown as WorklogData;

    const { data, report } = migrateProgramLayer(source);

    expect(data.programs).toHaveLength(1);
    expect(data.versions[0].programId).toBe('g_existing');
    expect(report).toEqual({ programsCreated: 0, versionsAssigned: 1 });
  });

  it('keeps an existing valid programId instead of reassigning by requirement title', () => {
    const source = {
      projects: [],
      programs: [
        { id: 'g_macao', name: LEGACY_REQUIREMENT_TITLE, createdAt: 1 },
        { id: 'g_other', name: '其他主题', createdAt: 2 },
      ],
      versions: [
        {
          id: 'v1',
          name: 'V8.0.8',
          programId: 'g_other',
          createdAt: 1,
          requirements: [requirement('r1', LEGACY_REQUIREMENT_TITLE)],
        },
        unassignedVersion('v2', 'V8.0.9', [requirement('r2', LEGACY_REQUIREMENT_TITLE)], 2),
      ],
    } as unknown as WorklogData;

    const { data, report } = migrateProgramLayer(source);

    expect(data.versions[0].programId).toBe('g_other');
    expect(data.versions[1].programId).toBe('g_macao');
    expect(report.versionsAssigned).toBe(1);
  });

  it('is idempotent', () => {
    const source = unassignedData([
      unassignedVersion('v1', 'V8.0.8', [requirement('r1', LEGACY_REQUIREMENT_TITLE)]),
      unassignedVersion('v2', 'V8.0.9', [requirement('r2', '其他需求')], 2),
    ]);

    const once = migrateProgramLayer(source).data;
    const again = migrateProgramLayer(once);

    expect(again.data).toEqual(once);
    expect(again.report).toEqual({ programsCreated: 0, versionsAssigned: 0 });
  });
});

describe('needsProgramLayerMigration / isProgramLayerMigrated', () => {
  const program = { id: 'g_1', name: '澳门底层数据建设', createdAt: 1 };
  const version = (programId: string) =>
    ({ id: 'v1', name: 'V1', programId, createdAt: 1, entries: [] });

  it('treats fully assigned data as migrated', () => {
    const data = {
      projects: [],
      programs: [program],
      versions: [version('g_1')],
    } as WorklogData;

    expect(isProgramLayerMigrated(data)).toBe(true);
    expect(needsProgramLayerMigration(data)).toBe(false);
  });

  it('treats a dangling programId as not migrated (self-heal needed)', () => {
    const data = {
      projects: [],
      programs: [program],
      versions: [version('g_missing')],
    } as WorklogData;

    expect(isProgramLayerMigrated(data)).toBe(false);
    expect(needsProgramLayerMigration(data)).toBe(true);
  });

  it('treats an empty programId as not migrated', () => {
    const data = {
      projects: [],
      programs: [program],
      versions: [version('')],
    } as WorklogData;

    expect(isProgramLayerMigrated(data)).toBe(false);
    expect(needsProgramLayerMigration(data)).toBe(true);
  });

  it('does not require migration when there are no versions (no empty programs to create)', () => {
    const noPrograms = { projects: [], programs: [], versions: [] } as WorklogData;
    const withPrograms = {
      projects: [],
      programs: [program],
      versions: [],
    } as WorklogData;

    // 无版本时不需要迁移;isProgramLayerMigrated 的口径是「有主题且全部版本可解析」(空集恒真)
    expect(isProgramLayerMigrated(noPrograms)).toBe(false);
    expect(needsProgramLayerMigration(noPrograms)).toBe(false);
    expect(isProgramLayerMigrated(withPrograms)).toBe(true);
    expect(needsProgramLayerMigration(withPrograms)).toBe(false);
  });

  it('requires existing programs even when every version has a programId', () => {
    // 有版本但 programs 为空(主题被整体删掉):programId 无从解析,仍需迁移
    const data = {
      projects: [],
      programs: [],
      versions: [version('g_gone')],
    } as WorklogData;
    expect(needsProgramLayerMigration(data)).toBe(true);
  });
});

describe('runProgramLayerMigration', () => {
  let worklogRepo: JsonWorklogRepository;
  let dir: string;

  beforeEach(async () => {
    dir = path.join(os.tmpdir(), `mig-pl-${nanoid()}`);
    await fs.mkdir(dir, { recursive: true });
    worklogRepo = new JsonWorklogRepository(path.join(dir, 'worklog.json'), path.join(dir, 'wb'));
    // 旧数据:两个版本各自带「澳门底层数据建设」需求,都没有 programId
    await worklogRepo.mutate((d) => {
      d.versions.push(
        {
          id: 'v1',
          name: 'V8.0.8',
          createdAt: 1,
          requirements: [requirement('r1', LEGACY_REQUIREMENT_TITLE, [entry('e1')])],
        } as never,
        {
          id: 'v2',
          name: 'V8.0.9',
          createdAt: 2,
          requirements: [requirement('r2', LEGACY_REQUIREMENT_TITLE), requirement('r3', '其他需求')],
        } as never,
      );
    });
  });

  it('migrates the file, writes a marker and leaves a backup snapshot', async () => {
    const report = await runProgramLayerMigration({ dataDir: dir, worklogRepo });

    expect(report.skipped).toBe(false);
    expect(report.programsCreated).toBe(1);
    expect(report.versionsAssigned).toBe(2);

    const data = await worklogRepo.load();
    expect(data.programs).toHaveLength(1);
    expect(data.programs[0].name).toBe(LEGACY_REQUIREMENT_TITLE);
    expect(data.versions.every((v) => v.programId === data.programs[0].id)).toBe(true);
    // 需求与条目一条不丢
    expect(requirementsOf(data.versions[0])[0].entries.map((e) => e.id)).toEqual(['e1']);
    expect(requirementsOf(data.versions[1]).map((r) => r.title)).toEqual([
      LEGACY_REQUIREMENT_TITLE,
      '其他需求',
    ]);

    // 标记文件(原子写产物)为版本 1
    const marker = JSON.parse(
      await fs.readFile(path.join(dir, '.migration-program-layer.json'), 'utf8'),
    ) as { version: number };
    expect(marker.version).toBe(1);

    // 破坏性写入必须留快照
    expect((await fs.readdir(path.join(dir, 'wb'))).length).toBeGreaterThan(0);
  });

  it('is idempotent at file level: second run skips and leaves the bytes unchanged', async () => {
    const first = await runProgramLayerMigration({ dataDir: dir, worklogRepo });
    expect(first.skipped).toBe(false);

    const worklogFile = path.join(dir, 'worklog.json');
    const hash = async () => (await fs.readFile(worklogFile)).toString('base64');
    const before = await hash();

    const second = await runProgramLayerMigration({ dataDir: dir, worklogRepo });

    expect(second.skipped).toBe(true);
    expect(second.programsCreated).toBe(0);
    expect(second.versionsAssigned).toBe(0);
    expect(await hash()).toBe(before);
  });

  it('fills programId for data written by v1 (programId: empty string)', async () => {
    // 最高风险路径:v1 落盘的版本 programId 为空串,执行器必须识别为未迁移并回填
    const chainedDir = path.join(os.tmpdir(), `mig-pl-v1-${nanoid()}`);
    await fs.mkdir(chainedDir, { recursive: true });
    const repo = new JsonWorklogRepository(
      path.join(chainedDir, 'worklog.json'),
      path.join(chainedDir, 'wb'),
    );
    await repo.mutate((d) => {
      d.versions.push({
        id: 'v1',
        name: 'V8.0.8',
        programId: '',
        createdAt: 1,
        requirements: [requirement('r1', LEGACY_REQUIREMENT_TITLE)],
      } as never);
    });

    const report = await runProgramLayerMigration({ dataDir: chainedDir, worklogRepo: repo });

    expect(report.skipped).toBe(false);
    expect(report.programsCreated).toBe(1);
    expect(report.versionsAssigned).toBe(1);
    const data = await repo.load();
    expect(data.programs).toHaveLength(1);
    expect(data.versions[0].programId).toBe(data.programs[0].id);
  });

  it('self-heals a dangling programId instead of skipping, then stays stable', async () => {
    // programs 非空 + 某版本指向不存在的主题:门禁若只看 truthy 会永远 skipped,
    // 前端只能长期显示「未归属主题」。执行器必须重新归属,且第二次运行字节不变。
    const danglingDir = path.join(os.tmpdir(), `mig-pl-dangling-${nanoid()}`);
    await fs.mkdir(danglingDir, { recursive: true });
    const repo = new JsonWorklogRepository(
      path.join(danglingDir, 'worklog.json'),
      path.join(danglingDir, 'wb'),
    );
    await repo.mutate((d) => {
      d.programs.push({ id: 'g_kept', name: '旧主题', createdAt: 1 } as never);
      d.versions.push({
        id: 'v_dangling',
        name: 'V-dangling',
        programId: 'g_missing',
        createdAt: 1,
        requirements: [requirement('r1', LEGACY_REQUIREMENT_TITLE)],
      } as never);
    });

    const first = await runProgramLayerMigration({ dataDir: danglingDir, worklogRepo: repo });

    expect(first.skipped).toBe(false);
    expect(first.versionsAssigned).toBe(1);
    const data = await repo.load();
    const target = data.programs.find((p) => p.name === LEGACY_REQUIREMENT_TITLE)!;
    expect(target).toBeDefined();
    expect(data.versions[0].programId).toBe(target.id);
    // 既有主题不删除
    expect(data.programs.some((p) => p.id === 'g_kept')).toBe(true);

    // 二次运行:已全部可解析 → skipped 且 worklog.json 字节不变
    const worklogFile = path.join(danglingDir, 'worklog.json');
    const before = (await fs.readFile(worklogFile)).toString('base64');
    const second = await runProgramLayerMigration({ dataDir: danglingDir, worklogRepo: repo });
    expect(second.skipped).toBe(true);
    expect(second.versionsAssigned).toBe(0);
    expect((await fs.readFile(worklogFile)).toString('base64')).toBe(before);
  });

  it('does nothing (and marks skipped) on a data dir without versions', async () => {
    const freshDir = path.join(os.tmpdir(), `mig-pl-fresh-${nanoid()}`);
    await fs.mkdir(freshDir, { recursive: true });
    const repo = new JsonWorklogRepository(
      path.join(freshDir, 'worklog.json'),
      path.join(freshDir, 'wb'),
    );

    const report = await runProgramLayerMigration({ dataDir: freshDir, worklogRepo: repo });

    expect(report.skipped).toBe(true);
    expect(report.programsCreated).toBe(0);
    // 未写入任何 worklog 数据文件(不制造空主题)
    await expect(fs.access(path.join(freshDir, 'worklog.json'))).rejects.toThrow();
  });
});

/** v2 形态:版本下挂需求、还没有 entries(迁移 v3 的输入) */
function requirementTreeVersion(
  id: string,
  name: string,
  requirements: LegacyRequirement[],
  createdAt = 1,
): Record<string, unknown> {
  return { id, name, programId: 'g1', createdAt, requirements };
}

/** v2 形态的整体数据(主题已就位,版本仍带需求层) */
function requirementTreeData(versions: Array<Record<string, unknown>>): WorklogData {
  return {
    projects: [],
    programs: [{ id: 'g1', name: LEGACY_REQUIREMENT_TITLE, createdAt: 1 }],
    versions,
  } as unknown as WorklogData;
}

describe('migrateFlatEntries', () => {
  it('merges requirement entries into version and drops requirements', () => {
    const data = requirementTreeData([
      requirementTreeVersion('v1', 'V1', [
        requirement('r1', 'A', [entry('e1'), entry('e2')]),
        requirement('r2', 'B', [entry('e3')]),
      ]),
    ]);

    const { data: out, report } = migrateFlatEntries(data);

    // 按需求顺序、需求内原顺序拼接
    expect(out.versions[0].entries.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    expect('requirements' in out.versions[0]).toBe(false);
    expect(report).toEqual({ entriesMerged: 3, versionsFlattened: 1 });
  });

  it('conserves every entry (no drop, no duplication)', () => {
    const source = requirementTreeData([
      requirementTreeVersion('v1', 'V1', [
        requirement('r1', 'A', [entry('e1'), entry('e2')]),
        requirement('r2', 'B', [entry('e3'), entry('e4')]),
      ]),
      requirementTreeVersion('v2', 'V2', [requirement('r3', 'C', [entry('e5')])], 2),
    ]);
    const inputIds = requirementsOf(source.versions[0])
      .concat(requirementsOf(source.versions[1]))
      .flatMap((r) => r.entries.map((e) => e.id));

    const { data: out, report } = migrateFlatEntries(source);
    const outputIds = out.versions.flatMap((v) => v.entries.map((e) => e.id));

    expect(outputIds.sort()).toEqual(inputIds.sort());
    expect(outputIds).toHaveLength(5);
    expect(report.entriesMerged).toBe(5);
    expect(report.versionsFlattened).toBe(2);
  });

  it('is idempotent: second call returns the same object and zero counts', () => {
    const source = requirementTreeData([
      requirementTreeVersion('v1', 'V1', [requirement('r1', 'A', [entry('e1')])]),
    ]);

    const once = migrateFlatEntries(source);
    const twice = migrateFlatEntries(once.data);

    expect(twice.data).toBe(once.data); // 已是扁平结构:同一引用原样返回
    expect(twice.report).toEqual({ entriesMerged: 0, versionsFlattened: 0 });
  });

  it('leaves already-flat data untouched (no requirements field)', () => {
    const data: WorklogData = {
      projects: [],
      programs: [{ id: 'g1', name: '主题', createdAt: 1 }],
      versions: [
        { id: 'v1', name: 'V1', programId: 'g1', createdAt: 1, entries: [entry('e1')] },
      ],
    };

    const result = migrateFlatEntries(data);

    expect(result.data).toBe(data);
    expect(result.report).toEqual({ entriesMerged: 0, versionsFlattened: 0 });
    expect(needsFlatEntriesMigration(data)).toBe(false);
  });

  it('handles empty versions (no requirements) while migrating siblings', () => {
    const empty = { id: 'v_empty', name: 'V-empty', programId: 'g1', createdAt: 3, entries: [] };
    const source = {
      projects: [],
      programs: [{ id: 'g1', name: LEGACY_REQUIREMENT_TITLE, createdAt: 1 }],
      versions: [
        empty,
        requirementTreeVersion('v1', 'V1', [requirement('r1', 'A', [entry('e1')])], 2),
      ],
    } as unknown as WorklogData;

    const { data: out, report } = migrateFlatEntries(source);

    // 空版本原样保留,不被写坏
    expect(out.versions[0]).toBe(empty);
    expect(out.versions[1].entries.map((e) => e.id)).toEqual(['e1']);
    expect(report.versionsFlattened).toBe(1);
  });

  it('keeps pre-existing entries when a mixed version has both entries and requirements', () => {
    const source = {
      projects: [],
      programs: [],
      versions: [
        {
          id: 'v1',
          name: 'V1',
          programId: 'g1',
          createdAt: 1,
          entries: [entry('e_new')],
          requirements: [requirement('r1', 'A', [entry('e_old')])],
        },
      ],
    } as unknown as WorklogData;

    const { data: out } = migrateFlatEntries(source);

    // 混合态两边都保留,不静默丢条目
    expect(out.versions[0].entries.map((e) => e.id)).toEqual(['e_new', 'e_old']);
    expect('requirements' in out.versions[0]).toBe(false);
  });
});

describe('runFlatEntriesMigration', () => {
  let worklogRepo: JsonWorklogRepository;
  let dir: string;

  beforeEach(async () => {
    dir = path.join(os.tmpdir(), `mig-fe-${nanoid()}`);
    await fs.mkdir(dir, { recursive: true });
    worklogRepo = new JsonWorklogRepository(path.join(dir, 'worklog.json'), path.join(dir, 'wb'));
    // 旧数据:v1/v2 落盘的版本仍带需求层,没有 entries
    await worklogRepo.mutate((d) => {
      d.versions.push(
        requirementTreeVersion('v1', 'V8.0.8', [
          requirement('r1', LEGACY_REQUIREMENT_TITLE, [entry('e1'), entry('e2')]),
          requirement('r2', '其他需求', [entry('e3')]),
        ]) as never,
        requirementTreeVersion('v2', 'V8.0.9', [
          requirement('r3', LEGACY_REQUIREMENT_TITLE, [entry('e4')]),
        ], 2) as never,
      );
    });
  });

  it('migrates the file, writes a marker and leaves a backup snapshot', async () => {
    const report = await runFlatEntriesMigration({ dataDir: dir, worklogRepo });

    expect(report.skipped).toBe(false);
    expect(report.versionsFlattened).toBe(2);
    expect(report.entriesMerged).toBe(4);

    const data = await worklogRepo.load();
    expect(data.versions[0].entries.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    expect(data.versions[1].entries.map((e) => e.id)).toEqual(['e4']);
    // requirements 字段已从落盘数据移除
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'worklog.json'), 'utf8')) as {
      versions: Array<Record<string, unknown>>;
    };
    expect(raw.versions.every((v) => !('requirements' in v))).toBe(true);

    // 标记文件(原子写产物)为版本 1
    const marker = JSON.parse(
      await fs.readFile(path.join(dir, '.migration-flat-entries.json'), 'utf8'),
    ) as { version: number };
    expect(marker.version).toBe(1);

    // 破坏性写入必须留快照
    expect((await fs.readdir(path.join(dir, 'wb'))).length).toBeGreaterThan(0);
    // 锁已释放:目录里不残留锁文件
    expect((await fs.readdir(dir)).some((name) => name.includes('.lock'))).toBe(false);
  });

  it('is idempotent at file level: second run skips and leaves the bytes unchanged', async () => {
    const first = await runFlatEntriesMigration({ dataDir: dir, worklogRepo });
    expect(first.skipped).toBe(false);

    const worklogFile = path.join(dir, 'worklog.json');
    const hash = async () => (await fs.readFile(worklogFile)).toString('base64');
    const before = await hash();

    const second = await runFlatEntriesMigration({ dataDir: dir, worklogRepo });

    expect(second.skipped).toBe(true);
    expect(second.entriesMerged).toBe(0);
    expect(second.versionsFlattened).toBe(0);
    expect(await hash()).toBe(before);
  });

  it('does nothing (and marks skipped) on already-flat data', async () => {
    const freshDir = path.join(os.tmpdir(), `mig-fe-fresh-${nanoid()}`);
    await fs.mkdir(freshDir, { recursive: true });
    const repo = new JsonWorklogRepository(
      path.join(freshDir, 'worklog.json'),
      path.join(freshDir, 'wb'),
    );

    const report = await runFlatEntriesMigration({ dataDir: freshDir, worklogRepo: repo });

    expect(report.skipped).toBe(true);
    // 未写入任何 worklog 数据文件
    await expect(fs.access(path.join(freshDir, 'worklog.json'))).rejects.toThrow();
  });

  it('load() normalizes missing entries without dropping requirements', async () => {
    // Task 2 遗留防护:旧数据版本没有 entries 时,读侧归一为数组,
    // 但 requirements 必须原样保留,交给迁移 v3 合并(不能静默丢失条目)。
    const rawDir = path.join(os.tmpdir(), `mig-fe-raw-${nanoid()}`);
    await fs.mkdir(rawDir, { recursive: true });
    const rawFile = path.join(rawDir, 'worklog.json');
    await fs.writeFile(
      rawFile,
      JSON.stringify({
        projects: [],
        programs: [{ id: 'g1', name: LEGACY_REQUIREMENT_TITLE, createdAt: 1 }],
        versions: [
          {
            id: 'v1',
            name: 'V1',
            programId: 'g1',
            createdAt: 1,
            requirements: [requirement('r1', 'A', [entry('e1')])],
          },
        ],
      }),
      'utf8',
    );
    const repo = new JsonWorklogRepository(rawFile, path.join(rawDir, 'wb'));

    const loaded = await repo.load();

    expect(loaded.versions[0].entries).toEqual([]);
    expect(requirementsOf(loaded.versions[0]).flatMap((r) => r.entries.map((e) => e.id))).toEqual([
      'e1',
    ]);
  });
});
