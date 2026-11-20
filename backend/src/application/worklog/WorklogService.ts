// backend/src/application/worklog/WorklogService.ts
// 工作记录应用服务:MCP 工具与 HTTP API 的唯一入口(partial/建层/重名规则单点)。
// 写协议(双层锁/备份)由 JsonWorklogRepository 承担,本类只做业务规则与查询过滤。
import { randomUUID } from 'node:crypto';
import { isWorkStage } from '@ai-task-flow/shared';
import type {
  WorklogData,
  WorklogProject,
  WorklogVersion,
  WorklogEntry,
  WorklogEntryFile,
  WorklogRecordRequest,
  WorklogRecordResponse,
  WorklogQueryRequest,
  WorklogQueryResultEntry,
  WorklogProjectSummary,
  WorklogUpdateRequest,
  WorkStage,
} from '@ai-task-flow/shared';
import type { WorklogRepository } from '../../domain/worklog/repositories/WorklogRepository.js';
import {
  WorklogNotFoundError, WorklogConflictError, WorklogValidationError,
} from '../../domain/worklog/errors.js';

/** 项目/版本名约束:trim 后非空、不含路径分隔符(防路由参数歧义)、长度上限 */
const NAME_MAX_LEN = 60;

function validateName(name: string, label: string): string {
  const trimmed = name?.trim() ?? '';
  if (!trimmed) throw new WorklogValidationError(`${label}不能为空`);
  if (trimmed.includes('/')) throw new WorklogValidationError(`${label}不能包含 "/"`);
  if (trimmed.length > NAME_MAX_LEN) throw new WorklogValidationError(`${label}长度不能超过 ${NAME_MAX_LEN}`);
  return trimmed;
}

function validateStage(value: unknown): WorkStage | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (!isWorkStage(value)) throw new WorklogValidationError(`stage 非法：${String(value)}`);
  return value;
}

/** 本地日期 YYYY-MM-DD(entry.date 的取值口径) */
function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 生成短随机 id:e_ + uuid 前 8 位 hex */
function newEntryId(): string {
  return `e_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

/** 在数据中定位条目与其所属项目/版本(浅拷贝引用,便于原地变更) */
function locateEntry(
  data: WorklogData,
  entryId: string,
): { project: WorklogProject; version: WorklogVersion; entry: WorklogEntry } {
  for (const project of data.projects) {
    for (const version of project.versions) {
      const entry = version.entries.find((e) => e.id === entryId);
      if (entry) return { project, version, entry };
    }
  }
  throw new WorklogNotFoundError(`条目 ${entryId} 不存在`);
}

function findProject(data: WorklogData, name: string): WorklogProject {
  const project = data.projects.find((p) => p.name === name);
  if (!project) throw new Error(`项目 "${name}" 不存在`);
  return project;
}

export class WorklogService {
  constructor(private readonly repo: WorklogRepository) {}

  /** 全树(工作记录页一次拉取;读最新,不缓存) */
  async getTree(): Promise<WorklogData> {
    return this.repo.load();
  }

  /** 记录一条工作内容;项目/版本不存在自动创建(建层) */
  async record(input: WorklogRecordRequest): Promise<WorklogRecordResponse> {
    const project = validateName(input.project, '项目名');
    const version = validateName(input.version, '版本名');
    if (!input.title?.trim()) throw new WorklogValidationError('标题不能为空');
    if (input.detail == null || !String(input.detail).trim()) throw new WorklogValidationError('详细说明不能为空');

    return this.repo.mutate((data) => {
      let proj = data.projects.find((p) => p.name === project);
      let createdProject = false;
      let createdVersion = false;
      if (!proj) {
        proj = { name: project, createdAt: Date.now(), versions: [] };
        data.projects.push(proj);
        createdProject = true;
      }
      let ver = proj.versions.find((v) => v.name === version);
      if (!ver) {
        ver = { name: version, createdAt: Date.now(), entries: [] };
        proj.versions.push(ver);
        createdVersion = true;
      }

      const now = Date.now();
      const entry: WorklogEntry = {
        id: newEntryId(),
        title: input.title.trim(),
        detail: String(input.detail),
        date: localDate(),
        createdAt: now,
        updatedAt: now,
      };
      // files 运行时守卫:非数组(或元素非对象)拒绝,防 AI 客户端传坏结构入库后在查询路径抛 TypeError
      if (input.files != null) {
        if (!Array.isArray(input.files) || input.files.some((f) => typeof f !== 'object' || f === null || typeof (f as WorklogEntryFile).path !== 'string')) {
          throw new WorklogValidationError('files 必须为 [{path, startLine?, endLine?}] 数组');
        }
        entry.files = input.files;
      }
      if (input.diff) entry.diff = input.diff;
      if (input.tags?.length) entry.tags = input.tags.map((t) => t.trim()).filter(Boolean);
      if (input.stage !== undefined) entry.stage = validateStage(input.stage);
      ver.entries.push(entry);

      return {
        entryId: entry.id,
        path: `${project}/${version}/${entry.id}`,
        createdProject,
        createdVersion,
      };
    });
  }

  /** 查询条目:entryId 精确(忽略其他过滤)、project/version 精确、
   *  keyword 大小写不敏感(title/detail/files.path)、tags 任一命中、
   *  dateFrom/dateTo 闭区间;结果按创建时间新在前 */
  async query(input: WorklogQueryRequest): Promise<WorklogQueryResultEntry[]> {
    const data = await this.repo.load();
    const limit = input.limit && input.limit > 0 ? input.limit : 20;
    const entryId = input.entryId?.trim();
    const keyword = input.keyword?.trim().toLowerCase();
    const results: Array<WorklogQueryResultEntry & { __createdAt: number }> = [];

    for (const project of data.projects) {
      if (!entryId && input.project && project.name !== input.project) continue;
      for (const version of project.versions) {
        if (!entryId && input.version && version.name !== input.version) continue;
        for (const entry of version.entries) {
          // 按 id 精确查时忽略其余过滤条件:用户/AI 拿到的是唯一标识,不该再被项目/阶段等挡住
          if (entryId && entry.id !== entryId) continue;
          if (!entryId) {
            if (input.tags?.length && !entry.tags?.some((t) => input.tags!.includes(t))) continue;
            if (input.stage && entry.stage !== input.stage) continue;
            if (input.dateFrom && entry.date < input.dateFrom) continue;
            if (input.dateTo && entry.date > input.dateTo) continue;
            if (keyword) {
              const inTitle = entry.title.toLowerCase().includes(keyword);
              const inDetail = entry.detail.toLowerCase().includes(keyword);
              const inFiles = entry.files?.some((f) => f.path.toLowerCase().includes(keyword)) ?? false;
              if (!inTitle && !inDetail && !inFiles) continue;
            }
          }
          results.push({
            id: entry.id,
            title: entry.title,
            detail: entry.detail,
            date: entry.date,
            project: project.name,
            version: version.name,
            tags: entry.tags,
            stage: entry.stage,
            files: entry.files?.map((f: WorklogEntryFile) => f.path),
            ...(input.includeDiff && entry.diff ? { diff: entry.diff } : {}),
            __createdAt: entry.createdAt,
          });
        }
      }
    }

    return results
      .sort((a, b) => b.__createdAt - a.__createdAt)
      .slice(0, limit)
      .map(({ __createdAt, ...rest }) => rest);
  }

  /** 项目/版本树汇总(条目数 + 首末日期)——供 AI 记录前对齐已有结构 */
  async listProjects(): Promise<WorklogProjectSummary[]> {
    const data = await this.repo.load();
    return data.projects.map((project) => ({
      name: project.name,
      versions: project.versions.map((version) => {
        const dates = version.entries.map((e) => e.date).sort();
        return {
          name: version.name,
          entryCount: version.entries.length,
          firstDate: dates[0],
          lastDate: dates[dates.length - 1],
        };
      }),
    }));
  }

  /** partial 更新:只改传入字段;version 传新值 = 挪到该版本(不存在自动建,与 record 一致) */
  async update(entryId: string, patch: WorklogUpdateRequest): Promise<{ id: string; path: string }> {
    return this.repo.mutate((data) => {
      const { project, version, entry } = locateEntry(data, entryId);
      if (patch.title !== undefined) {
        if (!patch.title.trim()) throw new WorklogValidationError('标题不能为空');
        entry.title = patch.title.trim();
      }
      if (patch.detail !== undefined) entry.detail = String(patch.detail);
      if (patch.tags !== undefined) entry.tags = patch.tags.map((t) => t.trim()).filter(Boolean);
      if (patch.stage !== undefined) entry.stage = validateStage(patch.stage);
      if (patch.files !== undefined) {
        if (!Array.isArray(patch.files) || patch.files.some((f) => typeof f !== 'object' || f === null || typeof (f as WorklogEntryFile).path !== 'string')) {
          throw new WorklogValidationError('files 必须为 [{path, startLine?, endLine?}] 数组');
        }
        entry.files = patch.files;
      }
      if (patch.diff !== undefined) entry.diff = patch.diff;
      if (patch.date !== undefined) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.date)) {
          throw new WorklogValidationError('date 必须为 YYYY-MM-DD 格式');
        }
        entry.date = patch.date;
      }
      entry.updatedAt = Date.now();

      // 挪版本
      if (patch.version !== undefined && patch.version !== version.name) {
        const newVersionName = validateName(patch.version, '版本名');
        let target = project.versions.find((v) => v.name === newVersionName);
        if (!target) {
          target = { name: newVersionName, createdAt: Date.now(), entries: [] };
          project.versions.push(target);
        }
        version.entries = version.entries.filter((e) => e.id !== entryId);
        target.entries.push(entry);
        // 空版本清理:原版本被搬空且非目标,删除以免留壳
        if (version.entries.length === 0) {
          project.versions = project.versions.filter((v) => v !== version);
        }
        return { id: entryId, path: `${project.name}/${newVersionName}/${entryId}` };
      }
      return { id: entryId, path: `${project.name}/${version.name}/${entryId}` };
    });
  }

  /** 删单条(备份) */
  async deleteEntry(entryId: string): Promise<void> {
    await this.repo.mutate(
      (data) => {
        const { version } = locateEntry(data, entryId);
        version.entries = version.entries.filter((e) => e.id !== entryId);
      },
      { backup: true },
    );
  }

  /** 删整个版本,可删非空(备份) */
  async deleteVersion(projectName: string, versionName: string): Promise<void> {
    const project = validateName(projectName, '项目名');
    const version = validateName(versionName, '版本名');
    await this.repo.mutate(
      (data) => {
        const proj = findProject(data, project);
        if (!proj.versions.some((v) => v.name === version)) {
          throw new WorklogNotFoundError(`版本 "${version}" 不存在`);
        }
        proj.versions = proj.versions.filter((v) => v.name !== version);
      },
      { backup: true },
    );
  }

  /** 删整个项目(备份) */
  async deleteProject(projectName: string): Promise<void> {
    const project = validateName(projectName, '项目名');
    await this.repo.mutate(
      (data) => {
        findProject(data, project); // 不存在即抛
        data.projects = data.projects.filter((p) => p.name !== project);
      },
      { backup: true },
    );
  }

  /** 重命名版本;新名与项目内既有版本重名则报错不改(备份) */
  async renameVersion(projectName: string, versionName: string, newName: string): Promise<void> {
    const project = validateName(projectName, '项目名');
    const version = validateName(versionName, '版本名');
    const target = validateName(newName, '新版本名');
    await this.repo.mutate(
      (data) => {
        const proj = findProject(data, project);
        const ver = proj.versions.find((v) => v.name === version);
        if (!ver) throw new WorklogNotFoundError(`版本 "${version}" 不存在`);
        if (proj.versions.some((v) => v.name === target)) {
          throw new WorklogConflictError(`版本名 "${target}" 已存在`);
        }
        ver.name = target;
      },
      { backup: true },
    );
  }

  /** 重命名项目;新名与既有项目重名则报错不改(备份) */
  async renameProject(projectName: string, newName: string): Promise<void> {
    const project = validateName(projectName, '项目名');
    const target = validateName(newName, '新项目名');
    await this.repo.mutate(
      (data) => {
        findProject(data, project);
        if (data.projects.some((p) => p.name === target)) {
          throw new WorklogConflictError(`项目名 "${target}" 已存在`);
        }
        const proj = data.projects.find((p) => p.name === project)!;
        proj.name = target;
      },
      { backup: true },
    );
  }
}
