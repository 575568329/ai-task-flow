// backend/src/application/migration/VersionTreeMigration.ts
// 一次性数据迁移:旧结构「项目 → 版本 → 条目」归并为新结构「版本 → 需求 → 条目」。
//
// 为什么需要:旧模型里版本是项目内的私有集合,同一版本名(AI 在不同项目下各记一份)彼此割裂;
// 新模型版本是全局唯一顶层节点。迁移规则:
//   1) 同名版本跨项目归并为一个顶层版本;跨项目重名的版本名只报告(duplicateVersionNames),不拆分;
//   2) 每个版本下保证唯一一个「澳门底层数据建设」需求,该版本全部旧条目挂入;
//   3) 条目补 project(原项目名)+ projectId(原项目 id,能映射时),条目不删除、不改 id;
//   4) 项目降级为字典:保留 id/name/paths/createdAt,移除 versions 字段。
//
// 幂等:数据里已没有旧版 versions 字段时原样返回(纯函数);执行器第二次运行直接 skipped,
// 不写 worklog.json,哈希字节级不变。执行器风格与 ProjectIdMigration.ts 一致:
// 数据目录互斥锁 + 标记文件(.migration-version-tree.json,原子写)+ mutate(..., { backup: true }) 留快照。
import fs from 'node:fs/promises';
import lockfile from 'proper-lockfile';
import writeFileAtomic from 'write-file-atomic';
import { nanoid } from 'nanoid';
import type {
  WorklogData,
  WorklogEntry,
  WorklogProgram,
  WorklogProject,
  WorklogRequirement,
  WorklogVersion,
} from '@ai-task-flow/shared';
import type { WorklogRepository } from '../../domain/worklog/repositories/WorklogRepository.js';
import {
  programLayerMigrationLockTarget,
  programLayerMigrationMarkerPath,
  versionTreeMigrationLockTarget,
  versionTreeMigrationMarkerPath,
} from '../../config/dataDir.js';

/** 当前迁移版本;后续若需二次迁移,递增版本号即可重新执行 */
const MIGRATION_VERSION = 1;

/** 锁竞争重试:与仓储层同策略,启动流程不能被长占用挂死 */
const LOCK_RETRIES = { retries: 20, factor: 1.5, minTimeout: 100, maxTimeout: 2000 };

/** 持锁进程崩溃后的抢占阈值 */
const LOCK_STALE_MS = 30_000;

/** 旧条目统一挂入的需求标题(每个版本下唯一) */
export const LEGACY_REQUIREMENT_TITLE = '澳门底层数据建设';

/** 旧结构里的项目内版本(name/createdAt/entries) */
interface LegacyVersion {
  name: string;
  createdAt?: number;
  entries?: WorklogEntry[];
}

/** 旧结构项目:新模型 WorklogProject 上额外挂着 versions 字段 */
type ProjectWithLegacyVersions = WorklogProject & { versions?: LegacyVersion[] };

export interface VersionMigrationReport {
  /** 本次新建的顶层版本数 */
  versionsCreated: number;
  /** 本次新建的「澳门底层数据建设」需求数 */
  requirementsCreated: number;
  /** 本次挂入版本树的旧条目数 */
  entriesMoved: number;
  /** 跨项目重名的版本名(已归并,仅报告) */
  duplicateVersionNames: string[];
}

export interface VersionTreeMigrationResult {
  data: WorklogData;
  report: VersionMigrationReport;
}

export interface VersionMigrationDeps {
  dataDir: string;
  worklogRepo: WorklogRepository;
}

export type VersionTreeMigrationRunResult = VersionMigrationReport & {
  /** 数据无需迁移(已是新结构 / 空数据 / 另一进程已完成) */
  skipped: boolean;
};

function emptyReport(): VersionMigrationReport {
  return {
    versionsCreated: 0,
    requirementsCreated: 0,
    entriesMoved: 0,
    duplicateVersionNames: [],
  };
}

/** 读取项目上挂的旧版 versions(非数组/缺省视为没有旧结构) */
function legacyVersionsOf(project: WorklogProject): LegacyVersion[] | undefined {
  const value = (project as ProjectWithLegacyVersions).versions;
  return Array.isArray(value) ? value : undefined;
}

/** 数据是否还含旧结构:任一项目上仍挂着 versions 字段(即使为空数组) */
export function needsVersionTreeMigration(data: WorklogData): boolean {
  return data.projects.some((project) => legacyVersionsOf(project) !== undefined);
}

/** 去掉项目上的旧版 versions 字段,只保留新模型身份字段 */
function stripLegacyVersions(project: WorklogProject): WorklogProject {
  // 解构 rest 排除 versions;TypeScript 对带 rest 的解构不报未使用变量
  const { versions: _legacy, ...rest } = project as ProjectWithLegacyVersions;
  return rest;
}

/**
 * 纯函数:把旧结构数据转换为「版本 → 需求 → 条目」。
 * 已迁移(无旧版 versions 字段)时原样返回,保证幂等。
 * 混合态(顶层已有版本树、项目上还留着旧 versions)也会归并,不丢条目。
 */
export function migrateToVersionTree(data: WorklogData): VersionTreeMigrationResult {
  const report = emptyReport();
  if (!needsVersionTreeMigration(data)) {
    return { data, report }; // 已是新结构:原样返回(幂等)
  }

  // 顶层版本按名称索引;混合态下复用已有版本(不新建、不改 id)。
  // 先浅拷贝 version/requirements/entries 数组:后续 push 只落在副本上,
  // 保证纯函数不就地改写入参(同一混合态对象重复调用结果稳定)。
  const byName = new Map<string, WorklogVersion>();
  for (const version of data.versions ?? []) {
    byName.set(version.name, {
      ...version,
      requirements: version.requirements.map((requirement) => ({
        ...requirement,
        entries: [...requirement.entries],
      })),
    });
  }
  // 版本名 → 出现过的项目名集合,用于报告跨项目重名
  const sourcesByName = new Map<string, Set<string>>();

  for (const project of data.projects) {
    const legacyVersions = legacyVersionsOf(project) ?? [];
    for (const legacy of legacyVersions) {
      const sources = sourcesByName.get(legacy.name) ?? new Set<string>();
      // 用项目 id 区分项目(同名不同项目也算跨项目);旧项目可能无 id,退回名称
      sources.add(project.id || project.name);
      sourcesByName.set(legacy.name, sources);

      let version = byName.get(legacy.name);
      if (!version) {
        version = {
          id: `v_${nanoid(8)}`,
          name: legacy.name,
          // 本步只做版本归并,主题归属由随后的迁移 v2 回填(空串=未归属)
          programId: '',
          // 尽量沿用旧版本的创建时间,便于追溯
          createdAt: legacy.createdAt ?? Date.now(),
          requirements: [],
        };
        byName.set(legacy.name, version);
        report.versionsCreated += 1;
      }

      // 每个版本下唯一一个迁移需求;混合态下复用已有的同名需求
      let requirement = version.requirements.find((r) => r.title === LEGACY_REQUIREMENT_TITLE);
      if (!requirement) {
        requirement = {
          id: `r_${nanoid(8)}`,
          title: LEGACY_REQUIREMENT_TITLE,
          createdAt: Date.now(),
          entries: [],
        };
        version.requirements.push(requirement);
        report.requirementsCreated += 1;
      }

      for (const legacyEntry of legacy.entries ?? []) {
        // 复制而非复用旧对象,避免调用方原始数据被就地改写
        const entry: WorklogEntry = { ...legacyEntry, project: project.name };
        if (project.id) {
          entry.projectId = project.id;
        }
        requirement.entries.push(entry);
        report.entriesMoved += 1;
      }
    }
  }

  for (const [name, sources] of sourcesByName) {
    if (sources.size > 1) {
      report.duplicateVersionNames.push(name);
    }
  }

  return {
    data: {
      projects: data.projects.map(stripLegacyVersions),
      // 主题字段原样保留(旧数据没有;迁移 v2 负责建主题与回填 programId)
      programs: data.programs ?? [],
      // 按名称排序,保证同一份旧数据得到稳定结果
      versions: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    },
    report,
  };
}

/** 读取标记文件版本号;文件不存在/损坏一律视为未迁移(0) */
async function readMarker(dataDir: string): Promise<number> {
  try {
    const raw = await fs.readFile(versionTreeMigrationMarkerPath(dataDir), 'utf8');
    return (JSON.parse(raw) as { version?: number }).version ?? 0;
  } catch {
    return 0;
  }
}

/** 已到当前迁移版本时不重复写标记(保证第二次运行的目录字节不变) */
async function ensureMarker(dataDir: string): Promise<void> {
  if ((await readMarker(dataDir)) >= MIGRATION_VERSION) return;
  await writeFileAtomic(
    versionTreeMigrationMarkerPath(dataDir),
    JSON.stringify({ version: MIGRATION_VERSION, at: new Date().toISOString() }, null, 2),
  );
}

/**
 * 一次性迁移执行器,HTTP 启动时调用(不阻塞启动的异常由调用方兜住)。
 * 幂等:数据已是新结构(或空数据)直接 skipped,不写 worklog.json、不留新快照。
 */
export async function runVersionTreeMigration(
  deps: VersionMigrationDeps,
): Promise<VersionTreeMigrationRunResult> {
  await fs.mkdir(deps.dataDir, { recursive: true });

  // 快路径:先读一次判断,避免每次启动都抢锁/写备份
  const before = await deps.worklogRepo.load();
  if (!needsVersionTreeMigration(before)) {
    await ensureMarker(deps.dataDir);
    return { ...emptyReport(), skipped: true };
  }

  const release = await lockfile.lock(versionTreeMigrationLockTarget(deps.dataDir), {
    stale: LOCK_STALE_MS,
    retries: LOCK_RETRIES,
  });
  try {
    // 锁内二次检查:等锁期间另一个进程可能已完成迁移
    const fresh = await deps.worklogRepo.load();
    if (!needsVersionTreeMigration(fresh)) {
      await ensureMarker(deps.dataDir);
      return { ...emptyReport(), skipped: true };
    }

    const report = await deps.worklogRepo.mutate(
      (data) => {
        const migrated = migrateToVersionTree(data);
        // mutate 提交的是同一个 data 对象:原地替换为迁移结果
        data.projects = migrated.data.projects;
        data.versions = migrated.data.versions;
        return migrated.report;
      },
      { backup: true },
    );

    // 最后落标记(原子写):中途失败不会留半截标记,下次启动会重做(迁移本身幂等)
    await ensureMarker(deps.dataDir);
    return { ...report, skipped: false };
  } finally {
    await release();
  }
}

// ---------------------------------------------------------------------------
// 迁移 v2:把版本下的「澳门底层数据建设」需求提升为顶层建设主题
//
// 为什么需要:三层模型此前只有「版本 → 需求 → 条目」,版本之间没有共同的归属节点。
// 新模型在版本之上增加「建设主题」(WorklogProgram),版本通过 programId 归属主题。
// 迁移规则:
//   1) 主题名直接取该版本需求中标题为「澳门底层数据建设」的需求标题(不重命名);
//   2) 没有该需求的版本归入默认主题「未分类建设」;
//   3) 同名版本(不同版本下的同名需求)聚合为同一个主题,不重复建;
//   4) 不删除任何需求/条目,只回填版本的 programId;
//   5) 已归属且主题仍存在的版本保持原归属(避免重复执行把人工调整挪走)。
//
// 幂等:已有主题且所有版本都带 programId 时纯函数原样返回;执行器第二次运行 skipped,
// 不写 worklog.json(字节级不变)。执行器与 v1 同风格:数据目录互斥锁 + 标记文件
// (.migration-program-layer.json,原子写)+ mutate(..., { backup: true }) 留快照。
// ---------------------------------------------------------------------------

/** 建设主题层迁移版本号;标记文件独立,不与 v1 共用 */
const PROGRAM_MIGRATION_VERSION = 1;

/** 版本下没有「澳门底层数据建设」需求时归入的默认主题 */
export const DEFAULT_PROGRAM_NAME = '未分类建设';

export interface ProgramMigrationReport {
  /** 本次新建的建设主题数 */
  programsCreated: number;
  /** 本次回填 programId 的版本数(已归属有效主题的版本不重复计数) */
  versionsAssigned: number;
}

export interface ProgramLayerMigrationResult {
  data: WorklogData;
  report: ProgramMigrationReport;
}

/** 执行器依赖与 v1 相同:数据目录 + worklog 仓储 */
export type ProgramMigrationDeps = VersionMigrationDeps;

export type ProgramLayerMigrationRunResult = ProgramMigrationReport & {
  /** 数据无需迁移(已全部归属主题 / 空数据 / 另一进程已完成) */
  skipped: boolean;
};

function emptyProgramReport(): ProgramMigrationReport {
  return { programsCreated: 0, versionsAssigned: 0 };
}

/** 数据是否还需要提升主题层:有版本且尚未全部归属主题 */
export function needsProgramLayerMigration(data: WorklogData): boolean {
  const programs = data.programs ?? [];
  if (programs.length > 0 && data.versions.every((version) => version.programId)) {
    return false;
  }
  // 没有版本时无可归属对象:不制造空主题,也避免无意义写盘
  return data.versions.length > 0;
}

/** 主题名:该版本「澳门底层数据建设」需求标题;没有则默认「未分类建设」 */
function programNameOf(version: WorklogVersion): string {
  return (
    (version.requirements ?? []).find((requirement) => requirement.title === LEGACY_REQUIREMENT_TITLE)
      ?.title ?? DEFAULT_PROGRAM_NAME
  );
}

/**
 * 纯函数:为每个版本回填 programId(按主题名聚合),不删除/不改动需求。
 * 已迁移时原样返回,保证幂等。In-place 不改写入参:只新建 programs/versions 副本。
 */
export function migrateProgramLayer(data: WorklogData): ProgramLayerMigrationResult {
  const report = emptyProgramReport();
  const existingPrograms = data.programs ?? [];
  // 已是目标形态:原样返回(幂等)
  if (existingPrograms.length > 0 && data.versions.every((version) => version.programId)) {
    return { data, report };
  }
  if (data.versions.length === 0) {
    return { data, report };
  }

  const programs: WorklogProgram[] = [...existingPrograms];
  const byName = new Map(programs.map((program) => [program.name, program]));
  const byId = new Map(programs.map((program) => [program.id, program]));

  const versions = data.versions.map((version) => {
    // 已归属且主题仍存在:保留原归属(重复执行/半迁移态不把版本挪走)
    if (version.programId && byId.has(version.programId)) {
      return version;
    }
    const targetName = programNameOf(version);
    let program = byName.get(targetName);
    if (!program) {
      program = { id: `g_${nanoid(8)}`, name: targetName, createdAt: Date.now() };
      byName.set(targetName, program);
      byId.set(program.id, program);
      programs.push(program);
      report.programsCreated += 1;
    }
    report.versionsAssigned += 1;
    return { ...version, programId: program.id };
  });

  return { data: { ...data, programs, versions }, report };
}

/** 读取主题层迁移标记文件版本号;文件不存在/损坏一律视为未迁移(0) */
async function readProgramMarker(dataDir: string): Promise<number> {
  try {
    const raw = await fs.readFile(programLayerMigrationMarkerPath(dataDir), 'utf8');
    return (JSON.parse(raw) as { version?: number }).version ?? 0;
  } catch {
    return 0;
  }
}

/** 已到当前迁移版本时不重复写标记(保证第二次运行的目录字节不变) */
async function ensureProgramMarker(dataDir: string): Promise<void> {
  if ((await readProgramMarker(dataDir)) >= PROGRAM_MIGRATION_VERSION) return;
  await writeFileAtomic(
    programLayerMigrationMarkerPath(dataDir),
    JSON.stringify({ version: PROGRAM_MIGRATION_VERSION, at: new Date().toISOString() }, null, 2),
  );
}

/**
 * 一次性迁移执行器,HTTP 启动时调用(v1 版本归并之后;异常由调用方兜住,不阻塞启动)。
 * 幂等:已全部归属主题(或空数据)直接 skipped,不写 worklog.json、不留新快照。
 */
export async function runProgramLayerMigration(
  deps: ProgramMigrationDeps,
): Promise<ProgramLayerMigrationRunResult> {
  await fs.mkdir(deps.dataDir, { recursive: true });

  // 快路径:先读一次判断,避免每次启动都抢锁/写备份
  const before = await deps.worklogRepo.load();
  if (!needsProgramLayerMigration(before)) {
    await ensureProgramMarker(deps.dataDir);
    return { ...emptyProgramReport(), skipped: true };
  }

  const release = await lockfile.lock(programLayerMigrationLockTarget(deps.dataDir), {
    stale: LOCK_STALE_MS,
    retries: LOCK_RETRIES,
  });
  try {
    // 锁内二次检查:等锁期间另一个进程可能已完成迁移
    const fresh = await deps.worklogRepo.load();
    if (!needsProgramLayerMigration(fresh)) {
      await ensureProgramMarker(deps.dataDir);
      return { ...emptyProgramReport(), skipped: true };
    }

    const report = await deps.worklogRepo.mutate(
      (data) => {
        const migrated = migrateProgramLayer(data);
        // mutate 提交的是同一个 data 对象:原地替换为迁移结果
        data.programs = migrated.data.programs;
        data.versions = migrated.data.versions;
        return migrated.report;
      },
      { backup: true },
    );

    // 最后落标记(原子写):中途失败不会留半截标记,下次启动会重做(迁移本身幂等)
    await ensureProgramMarker(deps.dataDir);
    return { ...report, skipped: false };
  } finally {
    await release();
  }
}
