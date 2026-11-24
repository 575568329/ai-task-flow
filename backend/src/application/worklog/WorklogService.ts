// backend/src/application/worklog/WorklogService.ts
// 工作记录应用服务:MCP 工具与 HTTP API 的唯一入口(版本/条目规则单点)。
// 树模型为「主题 → 版本 → 条目」,项目降为条目属性与路径归属字典;
// 主题/版本只能由用户创建,AI 只传 id 写入(不自动建层)。
// 写协议(双层锁/备份)由 JsonWorklogRepository 承担,本类只做业务规则与查询过滤。
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { isWorkStage } from '@ai-task-flow/shared';
import type {
  WorklogData,
  WorklogProject,
  WorklogEntry,
  WorklogEntryFile,
  WorklogRecordRequest,
  WorklogRecordResponse,
  WorklogQueryRequest,
  WorklogQueryResultEntry,
  WorklogUpdateRequest,
  WorklogVersionCreateRequest,
  WorklogProgramCreateRequest,
  WorklogProgramSummary,
  WorkStage,
} from '@ai-task-flow/shared';
import type { WorklogRepository } from '../../domain/worklog/repositories/WorklogRepository.js';
import {
  WorklogNotFoundError, WorklogConflictError, WorklogValidationError,
} from '../../domain/worklog/errors.js';
import { findOwningProject, normalizePath, resolveMatchPath } from '../../domain/worklog/pathMatch.js';
import {
  assertVersionNameFree,
  findEntryLocation,
  findVersion,
} from '../../domain/worklog/WorklogTree.js';
import {
  assertProgramNameFree,
  findProgram,
  versionsOfProgram,
} from '../../domain/worklog/WorklogProgramTree.js';

/** 版本/项目名约束:trim 后非空、不含路径分隔符(参与展示路径/路由参数)、长度上限 */
const NAME_MAX_LEN = 60;

/** 条目标题约束:允许 "/" 等业务字符,只限非空与长度 */
const TITLE_MAX_LEN = 200;

// 入参可能来自未做类型校验的调用方(MCP/脚本直接调 Service):非字符串一律按「空」处理,
// 由校验抛出 400 业务错,而不是在 .trim() 上抛 TypeError → 500。
function validateName(value: unknown, label: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) throw new WorklogValidationError(`${label}不能为空`);
  if (trimmed.includes('/')) throw new WorklogValidationError(`${label}不能包含 "/"`);
  if (trimmed.length > NAME_MAX_LEN) throw new WorklogValidationError(`${label}长度不能超过 ${NAME_MAX_LEN}`);
  return trimmed;
}

function validateTitle(value: unknown, label: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) throw new WorklogValidationError(`${label}不能为空`);
  if (trimmed.length > TITLE_MAX_LEN) throw new WorklogValidationError(`${label}长度不能超过 ${TITLE_MAX_LEN}`);
  return trimmed;
}

/** 候选清单文案:最多 5 个,形如「V8.0.8(v_ab12)、V8.0.7(v_cd34)」;空则明确标注 */
function candidateText(items: Array<{ id: string; label: string }>): string {
  if (!items.length) return '（暂无）';
  return items.slice(0, 5).map((item) => `${item.label}(${item.id})`).join('、');
}

function versionCandidates(data: WorklogData): Array<{ id: string; label: string }> {
  return data.versions.map((v) => ({ id: v.id, label: v.name }));
}

function programCandidates(data: WorklogData): Array<{ id: string; label: string }> {
  return (data.programs ?? []).map((p) => ({ id: p.id, label: p.name }));
}

function projectCandidates(data: WorklogData): Array<{ id: string; label: string }> {
  return data.projects.map((p) => ({ id: p.id, label: p.name }));
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

/** 绑定黑名单:这些目录「本身」不允许绑定,其子目录允许 */
const WINDOWS_SYSTEM_DIRS = ['C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)'];

/**
 * 判定路径是否为不可绑定的公共目录(自身)。
 * 绑定主目录/盘符根/临时目录等于把整个目录树归属给一个项目,后续路径归属会全部误命中;
 * 只拒绝目录本身,子目录(真正的工作区)不受影响。
 * 用 normalizePath 比较,兼容尾分隔符/Windows 大小写/WSL↔Windows 盘符两种写法。
 */
function forbiddenBindReason(input: string): string | undefined {
  const normalized = normalizePath(input);
  if (normalized === normalizePath(os.homedir())) return `用户主目录 ${os.homedir()}`;
  if (normalized === normalizePath(os.tmpdir())) return `系统临时目录 ${os.tmpdir()}`;
  if (normalized === normalizePath(path.parse(input).root)) return `文件系统根目录 ${path.parse(input).root}`;
  for (const dir of WINDOWS_SYSTEM_DIRS) {
    if (normalized === normalizePath(dir)) return `Windows 系统目录 ${dir}`;
  }
  return undefined;
}

function findProject(data: WorklogData, name: string): WorklogProject {
  const project = data.projects.find((p) => p.name === name);
  // 用领域错误而非裸 Error:路由层据此映射 404,而不是把「不存在」误报成 500
  if (!project) throw new WorklogNotFoundError(`项目 "${name}" 不存在`);
  return project;
}

/** 把关联项目名称解析为「稳定 id + 名称快照」;不存在的名称丢弃并收集,供 warnings 提示 */
function resolveRelated(
  data: WorklogData,
  names: string[] | undefined,
): { ids: string[]; labels: string[]; ignored: string[] } {
  // 运行时守卫:字符串会被 for-of 逐字符迭代,污染关联数据;非数组直接拒绝
  if (names !== undefined && !Array.isArray(names)) {
    throw new WorklogValidationError('relatedProjects 必须为字符串数组');
  }
  const ids: string[] = [];
  const labels: string[] = [];
  const ignored: string[] = [];
  for (const name of names ?? []) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) continue;
    const project = data.projects.find((p) => p.name === trimmed);
    if (!project) {
      ignored.push(trimmed);
      continue;
    }
    // 迁移前旧项目可能缺 id:没有稳定身份就无法写入引用,跳过(不把 undefined 塞进 relatedProjectIds)
    if (!project.id) continue;
    if (!ids.includes(project.id)) {
      ids.push(project.id);
      labels.push(project.name);
    }
  }
  return { ids, labels, ignored };
}

/** files 运行时守卫:非数组(或元素非对象)拒绝,防 AI 客户端传坏结构入库后在查询路径抛 TypeError */
function validateFiles(files: unknown): WorklogEntryFile[] {
  if (!Array.isArray(files) || files.some((f) => typeof f !== 'object' || f === null || typeof (f as WorklogEntryFile).path !== 'string')) {
    throw new WorklogValidationError('files 必须为 [{path, startLine?, endLine?}] 数组');
  }
  return files as WorklogEntryFile[];
}

/** 路径入参清洗与本地校验(绝对路径/公共目录黑名单);不依赖现有数据,可在事务前失败 */
function cleanPaths(paths: string[]): string[] {
  const cleaned = [...new Set(paths.map((p) => p.trim()).filter(Boolean))];
  for (const p of cleaned) {
    if (!path.isAbsolute(p)) throw new WorklogValidationError(`路径必须是绝对路径:${p}`);
  }
  // 公共目录本身不允许绑定(主目录/盘符根/临时目录/Windows 系统目录),子目录放行
  for (const p of cleaned) {
    const reason = forbiddenBindReason(p);
    if (reason) throw new WorklogValidationError(`不能绑定${reason}`);
  }
  return cleaned;
}

/** 跨项目占用校验(按归一化比较:尾分隔符/Windows 大小写也算同一目录) */
function assertPathsFree(data: WorklogData, cleaned: string[], exceptProjectName?: string): void {
  for (const other of data.projects) {
    if (exceptProjectName && other.name === exceptProjectName) continue;
    for (const p of cleaned) {
      if ((other.paths ?? []).some((op) => normalizePath(op) === normalizePath(p))) {
        throw new WorklogConflictError(`路径 ${p} 已被项目 "${other.name}" 占用`);
      }
    }
  }
}

export class WorklogService {
  constructor(private readonly repo: WorklogRepository) {}

  /** 全树(工作记录页一次拉取;读最新,不缓存)+ 每个项目失效路径标记(前端据此标红) */
  async getTree(): Promise<WorklogData> {
    const data = await this.repo.load();
    // 旧数据可能缺 programs 字段(仓储已归一,这里再兜底):调用方按数组使用
    if (!data.programs) data.programs = [];
    // 项目数量少,直接 access 探测可接受;missingPaths 仅为读时计算结果,不持久化
    for (const project of data.projects) {
      const missing: string[] = [];
      for (const p of project.paths ?? []) {
        try {
          await fs.access(p);
        } catch {
          missing.push(p);
        }
      }
      if (missing.length) project.missingPaths = missing;
    }
    return data;
  }

  /**
   * 轻量项目引用(名称 → 稳定 id):只读 worklog 字段,不 probe 路径、不做 fs.access。
   * 结论卡解析等「只需要项目名/id」的场景用它,避免为了建卡支付全树路径探测成本。
   */
  async getProjectRefs(): Promise<Array<{ id: string; name: string; paths?: string[] }>> {
    const data = await this.repo.load();
    return data.projects.map((project) => ({
      id: project.id,
      name: project.name,
      paths: project.paths,
    }));
  }

  // ------------------------------------------------------------------
  // 建设主题 CRUD(顶层;版本通过 programId 归属)
  // ------------------------------------------------------------------

  /** 新建建设主题;主题名全局唯一(备份) */
  async createProgram(input: WorklogProgramCreateRequest): Promise<{ id: string }> {
    const name = validateName(input.name, '主题名');
    return this.repo.mutate((data) => {
      if (!data.programs) data.programs = [];
      assertProgramNameFree(data, name);
      const id = `g_${nanoid(8)}`;
      data.programs.push({
        id,
        name,
        ...(input.description ? { description: input.description } : {}),
        createdAt: Date.now(),
      });
      return { id };
    }, { backup: true });
  }

  /** 重命名建设主题;新名与既有主题重名则报错不改(备份) */
  async renameProgram(id: string, newName: string): Promise<void> {
    const programId = id?.trim() ?? '';
    const target = validateName(newName, '新主题名');
    await this.repo.mutate((data) => {
      const program = findProgram(data, programId);
      if (!program) {
        throw new WorklogNotFoundError(
          `主题 ${programId} 不存在；现有主题：${candidateText(programCandidates(data))}`,
        );
      }
      assertProgramNameFree(data, target, programId);
      program.name = target;
    }, { backup: true });
  }

  /** 删整个建设主题:级联删除其下全部版本(含条目),不删项目字典(备份) */
  async deleteProgram(id: string): Promise<void> {
    const programId = id?.trim() ?? '';
    await this.repo.mutate((data) => {
      if (!findProgram(data, programId)) {
        throw new WorklogNotFoundError(
          `主题 ${programId} 不存在；现有主题：${candidateText(programCandidates(data))}`,
        );
      }
      const versionIds = new Set(versionsOfProgram(data, programId).map((v) => v.id));
      data.versions = data.versions.filter((v) => !versionIds.has(v.id));
      data.programs = (data.programs ?? []).filter((p) => p.id !== programId);
    }, { backup: true });
  }

  /** 主题摘要列表(供 MCP list_programs):版本数与条目数汇总 */
  async listPrograms(): Promise<WorklogProgramSummary[]> {
    const data = await this.repo.load();
    return (data.programs ?? []).map((program) => {
      const versions = versionsOfProgram(data, program.id);
      const entryCount = versions.reduce(
        (sum, version) => sum + (version.entries ?? []).length,
        0,
      );
      return {
        id: program.id,
        name: program.name,
        versionCount: versions.length,
        entryCount,
      };
    });
  }

  // ------------------------------------------------------------------
  // 版本 CRUD(仅页面/HTTP 使用;不提供 MCP 写接口)
  // ------------------------------------------------------------------

  /** 新建版本;版本名全局唯一,必须归属已存在的主题(纯新增,不写备份) */
  async createVersion(input: WorklogVersionCreateRequest): Promise<{ id: string }> {
    const name = validateName(input.name, '版本名');
    return this.repo.mutate((data) => {
      const programId = typeof input.programId === 'string' ? input.programId.trim() : '';
      // 版本 programId 不允许悬空:不存在即报错并列出候选主题,由用户先建主题
      if (!findProgram(data, programId)) {
        throw new WorklogNotFoundError(
          `主题 ${programId || '（空）'} 不存在；现有主题：${candidateText(programCandidates(data))}`,
        );
      }
      assertVersionNameFree(data, name);
      const id = `v_${nanoid(8)}`;
      data.versions.push({
        id,
        name,
        programId,
        ...(input.description ? { description: input.description } : {}),
        createdAt: Date.now(),
        entries: [],
      });
      return { id };
    });
  }

  /** 重命名版本;新名与既有版本重名则报错不改(备份) */
  async renameVersion(id: string, newName: string): Promise<void> {
    const versionId = id?.trim() ?? '';
    const target = validateName(newName, '新版本名');
    await this.repo.mutate((data) => {
      const version = findVersion(data, versionId);
      if (!version) {
        throw new WorklogNotFoundError(
          `版本 ${versionId} 不存在；现有版本：${candidateText(versionCandidates(data))}`,
        );
      }
      assertVersionNameFree(data, target, versionId);
      version.name = target;
    }, { backup: true });
  }

  /** 删整个版本(含其条目,可删非空;备份) */
  async deleteVersion(id: string): Promise<void> {
    const versionId = id?.trim() ?? '';
    await this.repo.mutate((data) => {
      if (!findVersion(data, versionId)) {
        throw new WorklogNotFoundError(
          `版本 ${versionId} 不存在；现有版本：${candidateText(versionCandidates(data))}`,
        );
      }
      data.versions = data.versions.filter((v) => v.id !== versionId);
    }, { backup: true });
  }

  // ------------------------------------------------------------------
  // 项目字典:创建 + 路径绑定/解绑(项目是路径归属与 related 引用的基础)
  // ------------------------------------------------------------------

  /**
   * 新建项目(全新环境的第一入口;路径归属/显式 project 都要求项目已存在)。
   * 可选 paths 与绑定同一套校验;任一不合法则整体拒绝,不写入半成品。
   */
  async createProject(input: { name: string; paths?: string[] }): Promise<{ id: string }> {
    const name = validateName(input.name, '项目名');
    const cleaned = cleanPaths(input.paths ?? []);
    return this.repo.mutate((data) => {
      if (data.projects.some((p) => p.name === name)) {
        throw new WorklogConflictError(`项目名 "${name}" 已存在`);
      }
      assertPathsFree(data, cleaned);
      const id = `p_${nanoid(8)}`;
      data.projects.push({
        id,
        name,
        createdAt: Date.now(),
        ...(cleaned.length ? { paths: cleaned } : {}),
      });
      return { id };
    }, { backup: true });
  }

  /** 绑定项目路径(整体替换);路径须绝对,同一路径不得被两个项目占用 */
  async bindProjectPaths(projectName: string, paths: string[]): Promise<void> {
    const name = validateName(projectName, '项目名');
    const cleaned = cleanPaths(paths);
    await this.repo.mutate((data) => {
      const proj = findProject(data, name);
      assertPathsFree(data, cleaned, name);
      proj.paths = cleaned;
    }, { backup: true });
  }

  /** 解绑单个路径(按归一化比较,未命中则无副作用) */
  async unbindProjectPath(projectName: string, targetPath: string): Promise<void> {
    const name = validateName(projectName, '项目名');
    await this.repo.mutate((data) => {
      const proj = findProject(data, name);
      const key = normalizePath(targetPath);
      proj.paths = (proj.paths ?? []).filter((p) => normalizePath(p) !== key);
    }, { backup: true });
  }

  // ------------------------------------------------------------------
  // 条目:记录 / 查询 / 更新 / 删除
  // ------------------------------------------------------------------

  /**
   * 记录一条工作内容到已存在的版本。
   * 版本不存在 → 404,提示用户先在页面创建并复制 id(不自动建层,防拼写裂树)。
   * project 可选:不传按路径归属;传入时必须已存在(不自动建项目)。
   */
  async record(input: WorklogRecordRequest): Promise<WorklogRecordResponse> {
    const title = validateTitle(input.title, '标题');
    if (input.detail == null || !String(input.detail).trim()) {
      throw new WorklogValidationError('详细说明不能为空');
    }
    const stage = validateStage(input.stage);

    return this.repo.mutate(async (data) => {
      const versionId = typeof input.versionId === 'string' ? input.versionId.trim() : '';
      const version = findVersion(data, versionId);
      if (!version) {
        // versions 为空通常意味着旧数据尚未迁移(新模型下至少有一个用户创建的版本才可能有合法 id);
        // 追加迁移提示,与「id 写错」区分——后者会列出候选,不会出现该提示。
        const migrationHint = data.versions.length === 0
          ? '如从旧版本升级，请先启动 Web 服务（`npm start`）完成数据迁移。'
          : '';
        throw new WorklogNotFoundError(
          `版本 ${versionId} 不存在；现有版本：${candidateText(versionCandidates(data))}。请让用户在页面创建并复制 id${migrationHint ? `。${migrationHint}` : ''}`,
        );
      }

      // 路径归属:realpath 归一化后按「最长前缀」找主项目;realpath 失败降级 path.resolve
      // 无 id 的旧项目没有稳定身份,不能作为归属目标(否则 undefined 会被当成 projectId)
      const sourcePath = typeof input.sourcePath === 'string' ? input.sourcePath.trim() : '';
      const normalizedSource = sourcePath ? await resolveMatchPath(sourcePath) : undefined;
      let ownerProject: WorklogProject | undefined;
      if (normalizedSource) {
        const refs = data.projects
          .filter((p) => Boolean(p.id))
          .flatMap((p) => (p.paths ?? []).map((pth) => ({ projectId: p.id, path: pth })));
        const ownerId = findOwningProject(refs, normalizedSource);
        ownerProject = ownerId ? data.projects.find((p) => p.id === ownerId) : undefined;
      }

      // 显式项目名必须已存在:项目字典不接受 AI 临时命名(防止拼错产生幽灵项目)
      let explicitProject: WorklogProject | undefined;
      if (input.project != null) {
        const name = typeof input.project === 'string' ? input.project.trim() : '';
        if (!name) throw new WorklogValidationError('项目名不能为空');
        explicitProject = data.projects.find((p) => p.name === name);
        if (!explicitProject) {
          throw new WorklogValidationError(
            `项目不存在:${name}；现有项目：${candidateText(projectCandidates(data))}`,
          );
        }
      }
      // 命中归属项目则以它为准(忽略传入的名字)
      const effective = ownerProject ?? explicitProject;

      const now = Date.now();
      const entry: WorklogEntry = {
        id: newEntryId(),
        title,
        detail: String(input.detail),
        date: localDate(),
        createdAt: now,
        updatedAt: now,
      };
      if (stage !== undefined) entry.stage = stage;
      if (effective) {
        entry.project = effective.name;
        entry.projectId = effective.id;
      }
      if (input.files != null) entry.files = validateFiles(input.files);
      if (typeof input.diff === 'string' && input.diff) entry.diff = input.diff;
      // tags 运行时守卫:字符串也有 length,但 .map 不存在(会 TypeError → 500)
      if (input.tags !== undefined) {
        if (!Array.isArray(input.tags) || input.tags.some((t) => typeof t !== 'string')) {
          throw new WorklogValidationError('tags 必须为字符串数组');
        }
        const tags = input.tags.map((t) => t.trim()).filter(Boolean);
        if (tags.length) entry.tags = tags;
      }
      // 关联项目:名称 → 稳定 id + 名称快照;拼错的名字不阻断记录,只告警
      const related = resolveRelated(data, input.relatedProjects);
      if (related.ids.length) {
        entry.relatedProjectIds = related.ids;
        entry.relatedProjects = related.labels;
      }
      // 留痕用户原始写法(不写归一化值),便于展示与后续重新归属
      if (normalizedSource) {
        entry.sourcePath = sourcePath;
        if (!ownerProject) entry.pathUnmatched = true;
      }
      version.entries.push(entry);

      const warnings: string[] = [];
      if (related.ignored.length) {
        warnings.push(`以下关联项目不存在，已忽略：${related.ignored.join(', ')}`);
      }
      // 只有「存在已绑定路径的项目」时未命中才算配置异常;全部项目都没绑定时不告警,避免每条记录都刷屏
      const hasBoundPaths = data.projects.some((p) => (p.paths ?? []).length > 0);
      if (normalizedSource && !ownerProject && hasBoundPaths) {
        warnings.push('当前路径未归属任何项目，可在页面绑定路径');
      }
      return {
        entryId: entry.id,
        path: `${version.name}/${entry.id}`,
        // 版本不再自动创建,保留字段为兼容旧客户端(恒 false)
        createdProject: false,
        createdVersion: false,
        ...(effective ? { projectId: effective.id } : {}),
        ...(warnings.length ? { warnings } : {}),
      };
    });
  }

  /**
   * 查询条目:entryId 精确(忽略其他过滤)、versionId/version(名称)/project 精确、
   *  keyword 大小写不敏感(title/detail/files.path)、tags 任一命中、
   *  dateFrom/dateTo 闭区间;结果按创建时间新在前,附带 versionName。
   */
  async query(input: WorklogQueryRequest): Promise<WorklogQueryResultEntry[]> {
    const data = await this.repo.load();
    const limit = input.limit && input.limit > 0 ? input.limit : 20;
    const entryId = input.entryId?.trim();
    const keyword = input.keyword?.trim().toLowerCase();
    const results: Array<WorklogQueryResultEntry & { __createdAt: number }> = [];

    for (const version of data.versions) {
      if (!entryId && input.versionId && version.id !== input.versionId) continue;
      if (!entryId && input.version && version.name !== input.version) continue;
      for (const entry of version.entries ?? []) {
        // 按 id 精确查时忽略其余过滤条件:用户/AI 拿到的是唯一标识,不该再被项目/阶段等挡住
        if (entryId && entry.id !== entryId) continue;
        if (!entryId) {
          if (input.project && entry.project !== input.project) continue;
          if (input.tags?.length && !entry.tags?.some((t) => input.tags!.includes(t))) continue;
          if (input.stage && entry.stage !== input.stage) continue;
          // 按关联项目名称过滤(名称快照与请求方口径一致)
          if (input.relatedProject && !entry.relatedProjects?.includes(input.relatedProject)) continue;
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
          versionName: version.name,
          ...(entry.project ? { project: entry.project } : {}),
          tags: entry.tags,
          stage: entry.stage,
          files: entry.files?.map((f: WorklogEntryFile) => f.path),
          relatedProjects: entry.relatedProjects,
          // 供调用方(前端详情/MCP query_work)提示来源与归属状态
          ...(entry.sourcePath ? { sourcePath: entry.sourcePath } : {}),
          ...(entry.pathUnmatched ? { pathUnmatched: true } : {}),
          ...(input.includeDiff && entry.diff ? { diff: entry.diff } : {}),
          __createdAt: entry.createdAt,
        });
      }
    }

    return results
      .sort((a, b) => b.__createdAt - a.__createdAt)
      .slice(0, limit)
      .map(({ __createdAt, ...rest }) => rest);
  }

  /** partial 更新:只改传入字段;按 entryId 跨整棵树定位 */
  async update(
    entryId: string,
    patch: WorklogUpdateRequest,
  ): Promise<{ id: string; path: string; warnings?: string[] }> {
    return this.repo.mutate((data) => {
      const warnings: string[] = [];
      const located = findEntryLocation(data, entryId);
      if (!located) throw new WorklogNotFoundError(`条目 ${entryId} 不存在`);
      const { version, entry } = located;

      if (patch.title !== undefined) entry.title = validateTitle(patch.title, '标题');
      if (patch.detail !== undefined) entry.detail = String(patch.detail);
      // tags 运行时守卫:非数组会在 .map 上抛 TypeError → 500
      if (patch.tags !== undefined) {
        if (!Array.isArray(patch.tags) || patch.tags.some((t) => typeof t !== 'string')) {
          throw new WorklogValidationError('tags 必须为字符串数组');
        }
        entry.tags = patch.tags.map((t) => t.trim()).filter(Boolean);
      }
      if (patch.stage !== undefined) entry.stage = validateStage(patch.stage);
      if (patch.files !== undefined) entry.files = validateFiles(patch.files);
      if (patch.diff !== undefined) {
        if (typeof patch.diff !== 'string') throw new WorklogValidationError('diff 必须为字符串');
        entry.diff = patch.diff;
      }
      if (patch.date !== undefined) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.date)) {
          throw new WorklogValidationError('date 必须为 YYYY-MM-DD 格式');
        }
        entry.date = patch.date;
      }
      // 关联项目:undefined = 不改;空数组 = 清空关联;其余按名称重新解析
      if (patch.relatedProjects !== undefined) {
        const related = resolveRelated(data, patch.relatedProjects);
        if (related.ids.length) {
          entry.relatedProjectIds = related.ids;
          entry.relatedProjects = related.labels;
        } else {
          delete entry.relatedProjectIds;
          delete entry.relatedProjects;
        }
        if (related.ignored.length) {
          warnings.push(`以下关联项目不存在，已忽略：${related.ignored.join(', ')}`);
        }
      }
      entry.updatedAt = Date.now();

      return {
        id: entryId,
        path: `${version.name}/${entryId}`,
        ...(warnings.length ? { warnings } : {}),
      };
    });
  }

  /** 删单条(备份) */
  async deleteEntry(entryId: string): Promise<void> {
    await this.repo.mutate(
      (data) => {
        const located = findEntryLocation(data, entryId);
        if (!located) throw new WorklogNotFoundError(`条目 ${entryId} 不存在`);
        located.version.entries = located.version.entries.filter((e) => e.id !== entryId);
      },
      { backup: true },
    );
  }

  // ------------------------------------------------------------------
  // 项目字典(删除只移除字典项,历史条目保留项目名称快照)
  // ------------------------------------------------------------------

  /** 删整个项目(只从字典移除,不删历史条目;备份) */
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
        // 名称快照同步:项目改名后,所有冗余名称字段都要跟上,否则按新名过滤/展示会失效。
        // id 引用优先;迁移前无 id 的旧数据按旧名兜底。
        for (const version of data.versions) {
          for (const entry of version.entries ?? []) {
            // 条目实际项目:按 id 同步;无 id 的旧条目按名称兜底
            if (entry.projectId === proj.id) entry.project = target;
            else if (!entry.projectId && entry.project === project) entry.project = target;
            // 条目的关联项目名称快照(id 引用不变)
            if (!entry.relatedProjects?.includes(project)) continue;
            entry.relatedProjects = entry.relatedProjects.map((n) => (n === project ? target : n));
          }
        }
      },
      { backup: true },
    );
  }
}
