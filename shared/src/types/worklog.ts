// shared/src/types/worklog.ts
// 工作记录(worklog)三层模型:项目 → 版本 → 功能点条目。
// 写入者/查询者主要是 AI(MCP),人类阅读走前端工作记录页渲染。
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
}

/** 版本:自由文本名(v1.2.0 / 11月迭代),项目内唯一 */
export interface WorklogVersion {
  name: string;
  createdAt: number;
  entries: WorklogEntry[];
}

/** 项目:唯一键,精确匹配 */
export interface WorklogProject {
  name: string;
  createdAt: number;
  versions: WorklogVersion[];
}

/** worklog.json 的整体结构 */
export interface WorklogData {
  projects: WorklogProject[];
}

// ---------------------------------------------------------------------------
// 请求/响应类型(MCP 工具与 HTTP API 共用)
// ---------------------------------------------------------------------------

/** record_work / POST /api/worklog/entries 入参 */
export interface WorklogRecordRequest {
  project: string;
  version: string;
  title: string;
  detail: string;
  files?: WorklogEntryFile[];
  diff?: string;
  tags?: string[];
  stage?: WorkStage;
}

/** record 响应:createdXxx 告知调用方是否新建了层(防拼写错误的版本名裂树) */
export interface WorklogRecordResponse {
  entryId: string;
  /** 展示用路径:项目/版本/entryId */
  path: string;
  createdProject: boolean;
  createdVersion: boolean;
}

/** query_work 入参 */
export interface WorklogQueryRequest {
  /** 按条目 id 精确查询(页面上复制的 e_xxx);传入时忽略其他过滤条件 */
  entryId?: string;
  project?: string;
  version?: string;
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
}

/** 查询结果条目(轻量:files 只给路径列表) */
export interface WorklogQueryResultEntry {
  id: string;
  title: string;
  detail: string;
  date: string;
  project: string;
  version: string;
  tags?: string[];
  stage?: WorkStage;
  files?: string[];
  diff?: string;
}

/** list_projects 结果:项目/版本树 + 每版本条目数与首末日期 */
export interface WorklogVersionSummary {
  name: string;
  entryCount: number;
  firstDate?: string;
  lastDate?: string;
}

export interface WorklogProjectSummary {
  name: string;
  versions: WorklogVersionSummary[];
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
  /** 传新值 = 把条目挪到该版本(不存在则自动创建,与 record 建层一致) */
  version?: string;
}

/** rename 入参(版本/项目通用) */
export interface WorklogRenameRequest {
  project: string;
  /** 重命名版本时必填 */
  version?: string;
  newName: string;
}
