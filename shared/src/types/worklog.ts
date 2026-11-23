// shared/src/types/worklog.ts
// 工作记录(worklog)三层模型:版本 → 需求 → 功能点条目;项目降为条目属性与字典。
// 版本/需求由用户在页面创建,AI(MCP)只传 id 写入;人类阅读走前端工作记录页渲染。
// 存储:~/.ai-task-flow/worklog.json(单文件,原子写+跨进程文件锁,见 backend JsonWorklogRepository)。
import type { WorkStage } from './stage.js';

/** 条目关联的文件引用(行号是记录时刻的快照,只展示不承诺跳转) */
export interface WorklogEntryFile {
  /** 相对仓库根的文件路径,如 backend/src/server.ts */
  path: string;
  /** 起始行(1-based,可选) */
  startLine?: number;
  /** 结束行(1-based,可选) */
  endLine?: number;
}

/** 一条工作记录(功能点) */
export interface WorklogEntry {
  /** 短随机 id,全局唯一(定位删除/更新) */
  id: string;
  /** 一句话功能点,如「砍掉任务派发链路」 */
  title: string;
  /** markdown 详细改动说明(改了什么/为什么/影响面) */
  detail: string;
  /** git diff 原始文本(记录时快照,可选) */
  diff?: string;
  /** 结构化文件引用(可选) */
  files?: WorklogEntryFile[];
  /** 标签,约定 feat/fix/refactor/docs(可选) */
  tags?: string[];
  /** 唯一阶段标签；旧数据可能为空 */
  stage?: WorkStage;
  /** 记录当天本地日期 YYYY-MM-DD */
  date: string;
  createdAt: number;
  updatedAt: number;
  /** 记录时的 cwd(原始写法),用于追溯与重新归属 */
  sourcePath?: string;
  /** 关联项目名称快照(展示兜底) */
  relatedProjects?: string[];
  /** 关联项目稳定引用 */
  relatedProjectIds?: string[];
  /** 记录时路径未命中任何项目 */
  pathUnmatched?: boolean;
  /** 本条实际改动的项目(路径归属或显式传入) */
  project?: string;
  projectId?: string;
}

/** 项目:唯一键,精确匹配;仅作字典用于路径归属与项目筛选,不再是树根 */
export interface WorklogProject {
  /** 稳定身份(p_xxx);迁移前旧数据可能缺失 */
  id: string;
  /** 归属路径,可多个;空/缺省 = 未绑定 */
  paths?: string[];
  name: string;
  createdAt: number;
  /** 仅由 getTree 计算,不持久化 */
  missingPaths?: string[];
}

/** 版本:自由文本名(如 V8.0.8),全局唯一 */
export interface WorklogVersion {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  requirements: WorklogRequirement[];
}

/** 需求:版本内唯一标题,承载一组功能点条目 */
export interface WorklogRequirement {
  id: string;
  /** 版本内唯一 */
  title: string;
  description?: string;
  /** 需求计划关联的项目(名称快照) */
  projects?: string[];
  projectIds?: string[];
  createdAt: number;
  entries: WorklogEntry[];
}

/** worklog.json 的整体结构 */
export interface WorklogData {
  /** 项目字典:路径归属与项目筛选用 */
  projects: WorklogProject[];
  /** 顶层组织:版本 → 需求 → 条目 */
  versions: WorklogVersion[];
}

// ---------------------------------------------------------------------------
// 请求/响应类型(MCP 工具与 HTTP API 共用)
// ---------------------------------------------------------------------------

/** record_work / POST /api/worklog/entries 入参 */
export interface WorklogRecordRequest {
  /** 所属版本(必填) */
  versionId: string;
  /** 所属需求(必填,版本内) */
  requirementId: string;
  title: string;
  detail: string;
  /** 本条实际改动的项目名(可选) */
  project?: string;
  /** 关联项目名称;解析失败的项会被忽略并在 warnings 中返回 */
  relatedProjects?: string[];
  files?: WorklogEntryFile[];
  diff?: string;
  tags?: string[];
  stage: WorkStage;
  /** 记录端所在路径(MCP handler 自动填 process.cwd());不传则不做路径归属 */
  sourcePath?: string;
}

/** 版本创建入参 */
export interface WorklogVersionCreateRequest {
  name: string;
  description?: string;
}

/** 需求创建入参 */
export interface WorklogRequirementCreateRequest {
  versionId: string;
  title: string;
  description?: string;
  projects?: string[];
}

/** record 响应:版本/需求不再自动创建,createdXxx 为兼容旧客户端保留(恒 false) */
export interface WorklogRecordResponse {
  entryId: string;
  /** 展示用路径:版本名/需求名/entryId */
  path: string;
  /** 兼容保留,恒 false */
  createdProject: boolean;
  /** 兼容保留,恒 false */
  createdVersion: boolean;
  projectId?: string;
  warnings?: string[];
}

/** query_work 入参 */
export interface WorklogQueryRequest {
  /** 按条目 id 精确查询(页面上复制的 e_xxx);传入时忽略其他过滤条件 */
  entryId?: string;
  project?: string;
  version?: string;
  /** 按版本 id 过滤 */
  versionId?: string;
  /** 按需求 id 过滤 */
  requirementId?: string;
  /** 对 title/detail/files.path 不区分大小写模糊匹配 */
  keyword?: string;
  /** 命中任一 tag 即可 */
  tags?: string[];
  /** 按唯一阶段过滤 */
  stage?: WorkStage;
  /** 过滤 entry.date(YYYY-MM-DD,含边界) */
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  /** 默认 false:diff 体积大,仅在明确要求时返回 */
  includeDiff?: boolean;
  /** 按关联项目名称过滤 */
  relatedProject?: string;
}

/** 查询结果条目(轻量:files 只给路径列表) */
export interface WorklogQueryResultEntry {
  id: string;
  title: string;
  detail: string;
  date: string;
  /** 条目实际归属项目(路径归属或显式传入);可能为空 */
  project?: string;
  /** 所属版本名称 */
  versionName: string;
  /** 所属需求标题 */
  requirementTitle: string;
  tags?: string[];
  stage?: WorkStage;
  files?: string[];
  diff?: string;
  sourcePath?: string;
  relatedProjects?: string[];
  pathUnmatched?: boolean;
}

/** 需求摘要(列表视图用,不含条目全文) */
export interface WorklogRequirementSummary {
  id: string;
  versionId: string;
  title: string;
  projects?: string[];
  entryCount: number;
}

/** update_work / PUT /api/worklog/entries/:id 入参(partial:只改传入字段) */
export interface WorklogUpdateRequest {
  title?: string;
  detail?: string;
  tags?: string[];
  stage?: WorkStage;
  files?: WorklogEntryFile[];
  diff?: string;
  date?: string;
  relatedProjects?: string[];
}
