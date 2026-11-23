// backend/src/application/migration/ProjectIdMigration.ts
// 一次性数据迁移:给缺 id 的旧项目补稳定身份(p_xxx),并把结论卡按项目名绑定到项目 id。
//
// 为什么需要:项目 id 是「项目路径身份」新增的稳定主键,旧 worklog.json / conclusions.json
// 里没有。迁移只在 HTTP 启动时调用:
//   1) 补项目 id 每次启动都执行(缺就补,天然幂等),不受标记文件 gate——
//      否则旧版本进程新写出的无 id 项目会永远补不上;
//   2) 标记文件只 gate「结论卡名称绑定」与路径建议(一次性动作);
//   3) 首次迁移对数据目录取 proper-lockfile,双进程同时启动也只有一个真正执行;
//   4) 两边都是破坏性写入,统一走 mutate(..., { backup: true }) 留快照。
import fs from 'node:fs/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import writeFileAtomic from 'write-file-atomic';
import { nanoid } from 'nanoid';
import type { WorklogRepository } from '../../domain/worklog/repositories/WorklogRepository.js';
import type { ConclusionRepository } from '../../domain/conclusion/repositories/ConclusionRepository.js';
import { projectIdMigrationLockTarget, projectIdMigrationMarkerPath } from '../../config/dataDir.js';

/** 当前迁移版本;后续若需二次迁移,递增版本号即可重新执行 */
const MIGRATION_VERSION = 1;

/** 候选路径根:只检查这两个根下是否有同名目录,作为建议交给页面,不自动绑定 */
const SUGGESTED_PATH_ROOTS = ['D:\\xunfei', 'D:\\Study'] as const;

/** 锁竞争重试:与仓储层同策略,启动流程不能被长占用挂死 */
const LOCK_RETRIES = { retries: 20, factor: 1.5, minTimeout: 100, maxTimeout: 2000 };

/** 持锁进程崩溃后的抢占阈值 */
const LOCK_STALE_MS = 30_000;

export interface MigrationReport {
  /** 本次补上 id 的项目数 */
  assignedIds: number;
  /** 本次按项目名绑定到 id 的结论卡数 */
  boundConclusions: number;
  /** 重名项目名(只报告,不自动合并) */
  duplicateNames: string[];
  /** 项目名 → 存在的同名候选目录(仅 D:\xunfei、D:\Study 两个根;建议值,不自动写入)。
   *  暂未消费,供后续页面展示「建议绑定」。 */
  suggestedPaths: Record<string, string>;
  /** 因项目重名无法判定归属而跳过的结论卡数(留给人工处理) */
  skippedAmbiguous: number;
  /** 标记文件已是当前版本,本次直接跳过 */
  skipped: boolean;
}

export interface MigrationDeps {
  dataDir: string;
  worklogRepo: WorklogRepository;
  conclusionRepo: ConclusionRepository;
}

/** 读取标记文件版本号;文件不存在/损坏一律视为未迁移(0) */
async function readMarker(dataDir: string): Promise<number> {
  try {
    const raw = await fs.readFile(projectIdMigrationMarkerPath(dataDir), 'utf8');
    return (JSON.parse(raw) as { version?: number }).version ?? 0;
  } catch {
    return 0;
  }
}

/** 建议路径探测:仅当项目未绑定 paths 且两个候选根下存在同名目录时给建议 */
async function collectSuggestedPaths(
  projects: Array<{ name: string; paths?: string[] }>,
  report: MigrationReport,
): Promise<void> {
  for (const project of projects) {
    if (project.paths?.length) continue;
    for (const root of SUGGESTED_PATH_ROOTS) {
      const candidate = path.join(root, project.name);
      try {
        await fs.access(candidate);
        report.suggestedPaths[project.name] = candidate;
        break;
      } catch {
        // 该根下无同名目录:继续看下一个根
      }
    }
  }
}

/** 补项目 id + 结论卡按名称绑定;幂等,只在 HTTP 启动时调用 */
export async function runProjectIdMigration(deps: MigrationDeps): Promise<MigrationReport> {
  const report: MigrationReport = {
    assignedIds: 0,
    boundConclusions: 0,
    duplicateNames: [],
    suggestedPaths: {},
    skippedAmbiguous: 0,
    skipped: false,
  };
  await fs.mkdir(deps.dataDir, { recursive: true });

  // 自愈:每次启动都扫全部项目,缺 id 就补(幂等)。不放进标记 gate,
  // 否则标记写入后新出现的无 id 项目永远补不上。
  // 先 load 判断再 mutate,避免每次启动都无条件写盘并产生一份备份快照。
  const before = await deps.worklogRepo.load();
  if (before.projects.some((project) => !project.id)) {
    await deps.worklogRepo.mutate((data) => {
      for (const project of data.projects) {
        if (project.id) continue;
        project.id = `p_${nanoid(8)}`;
        report.assignedIds += 1;
      }
    }, { backup: true });
  }

  // 标记已到版本:结论卡绑定与路径建议是一次性动作,不重复执行
  if ((await readMarker(deps.dataDir)) >= MIGRATION_VERSION) {
    report.skipped = true;
    return report;
  }

  const release = await lockfile.lock(projectIdMigrationLockTarget(deps.dataDir), {
    stale: LOCK_STALE_MS,
    retries: LOCK_RETRIES,
  });
  try {
    // 锁内二次检查:等锁期间另一个进程可能已完成迁移
    if ((await readMarker(deps.dataDir)) >= MIGRATION_VERSION) {
      report.skipped = true;
      return report;
    }

    // 项目名 → 项目 id;重名时保留第一个,后续同名项目只报告不合并
    const tree = await deps.worklogRepo.load();
    const nameToId = new Map<string, string>();
    for (const project of tree.projects) {
      if (nameToId.has(project.name)) {
        if (!report.duplicateNames.includes(project.name)) {
          report.duplicateNames.push(project.name);
        }
        continue;
      }
      nameToId.set(project.name, project.id);
    }

    // 路径建议在业务锁之外做(文件系统探测较慢,不拖长 worklog 临界区)
    await collectSuggestedPaths(tree.projects, report);

    // 结论卡绑定:已有 projectId 的不覆盖;名称匹配不上的保持为空。
    // 守卫:非项目域不绑定(个人卡可能误填 project 名);
    //       重名项目无法判定归属,跳过并计数——迁移是一次性的,不能靠"第一个同名项目"猜。
    const ambiguousNames = new Set(report.duplicateNames);
    await deps.conclusionRepo.mutate((data) => {
      for (const card of data.conclusions) {
        if (card.projectId || !card.project) continue;
        if (card.scope !== 'project') continue;
        if (ambiguousNames.has(card.project)) {
          report.skippedAmbiguous += 1;
          continue;
        }
        const id = nameToId.get(card.project);
        if (id) {
          card.projectId = id;
          report.boundConclusions += 1;
        }
      }
    }, { backup: true });

    // 最后落标记(原子写):中途失败不会留半截标记,下次启动会重做绑定(绑定本身幂等)
    await writeFileAtomic(
      projectIdMigrationMarkerPath(deps.dataDir),
      JSON.stringify({ version: MIGRATION_VERSION, at: new Date().toISOString() }, null, 2),
    );
    return report;
  } finally {
    await release();
  }
}
