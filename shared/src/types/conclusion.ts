// 结论卡共享类型：项目/版本/个人 + 逐版完整快照。
import type { WorkStage } from './stage.js';

export type ProblemScope = 'project' | 'personal';

export interface ConclusionCodeRef {
  path: string;
  startLine?: number;
  endLine?: number;
  note?: string;
}

export interface ConclusionSource {
  tool: string;
  conversationId?: string;
  conversationName?: string;
  cwd?: string;
  agentVersion?: string;
}

export interface ConclusionRevision {
  rev: number;
  decision: string;
  data?: string;
  openItems?: string;
  codeRefs?: ConclusionCodeRef[];
  changeNote?: string;
  /** 本版对应的唯一阶段标签 */
  stage?: WorkStage;
  source: ConclusionSource;
  date: string;
  createdAt: number;
}

export interface Conclusion {
  id: string;
  scope: ProblemScope;
  project?: string;
  version?: string;
  /** 卡片归属对话：创建时确定，人工编辑不改变（一对话一卡的守卫依据） */
  conversationId?: string;
  conversationName?: string;
  title: string;
  tags?: string[];
  revisions: ConclusionRevision[];
  createdAt: number;
  updatedAt: number;
  /** 项目稳定引用;项目不存在时为空 */
  projectId?: string;
  /** 关联项目名称快照 */
  relatedProjects?: string[];
  /** 关联项目稳定引用 */
  relatedProjectIds?: string[];
}

export interface ConclusionData {
  schemaVersion: 1;
  conclusions: Conclusion[];
}

export interface ConclusionCreateRequest {
  scope: ProblemScope;
  project?: string;
  version?: string;
  title: string;
  tags?: string[];
  decision: string;
  data?: string;
  openItems?: string;
  codeRefs?: ConclusionCodeRef[];
  date?: string;
  changeNote?: string;
  conversationName?: string;
  stage?: WorkStage;
  /** 由接口层查 worklog 后填入;Service 只存储 */
  projectId?: string;
  relatedProjectIds?: string[];
  relatedProjects?: string[];
}

export interface ConclusionAppendRequest {
  expectedRev?: number;
  /** 默认一对话一卡：跨对话追加会 409；确认续写同一卡时显式置 true */
  allowCrossConversation?: boolean;
  scope?: ProblemScope;
  project?: string;
  version?: string;
  title?: string;
  tags?: string[];
  decision?: string;
  data?: string;
  openItems?: string;
  codeRefs?: ConclusionCodeRef[];
  date?: string;
  changeNote: string;
  conversationName?: string;
  stage?: WorkStage;
  /** 由接口层查 worklog 后填入;Service 只存储 */
  projectId?: string;
  relatedProjectIds?: string[];
  relatedProjects?: string[];
}

/**
 * record_conclusion 自动 upsert 入参：不传 cardId 时按当前会话查找，
 * 已存在则追加新版，不存在则新建。
 */
export interface ConclusionRecordRequest {
  scope?: ProblemScope;
  project?: string;
  version?: string;
  title?: string;
  tags?: string[];
  decision?: string;
  data?: string;
  openItems?: string;
  codeRefs?: ConclusionCodeRef[];
  date?: string;
  changeNote?: string;
  conversationName?: string;
  stage?: WorkStage;
  expectedRev?: number;
  allowCrossConversation?: boolean;
  /** 由接口层查 worklog 后填入;Service 只存储 */
  projectId?: string;
  relatedProjectIds?: string[];
  relatedProjects?: string[];
}

export interface ConclusionRecordResponse {
  id: string;
  rev: number;
  path: string;
  /** true=本次新建，false=同一会话自动续写 */
  created: boolean;
}

export interface ConclusionPatchRequest {
  scope?: ProblemScope;
  project?: string;
  version?: string;
  title?: string;
  tags?: string[];
}

export interface ConclusionQueryRequest {
  cardId?: string;
  scope?: ProblemScope;
  project?: string;
  version?: string;
  keyword?: string;
  tags?: string[];
  stage?: WorkStage;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  includeHistory?: boolean;
}

export interface ConclusionSummary {
  id: string;
  scope: ProblemScope;
  project?: string;
  version?: string;
  title: string;
  tags?: string[];
  rev: number;
  latestDate: string;
  latestDecisionExcerpt: string;
  stage?: WorkStage;
  source: Pick<ConclusionSource, 'tool' | 'conversationId' | 'conversationName'>;
  matchedRev?: number;
  createdAt: number;
  updatedAt: number;
  relatedProjects?: string[];
}

export interface ConclusionRevisionSummary {
  rev: number;
  date: string;
  changeNote?: string;
  createdAt: number;
  tool: string;
  conversationId?: string;
  conversationName?: string;
  stage?: WorkStage;
}

export interface ConclusionDetail {
  id: string;
  scope: ProblemScope;
  project?: string;
  version?: string;
  conversationId?: string;
  conversationName?: string;
  title: string;
  tags?: string[];
  rev: number;
  stage?: WorkStage;
  latest: ConclusionRevision;
  revisions: ConclusionRevisionSummary[];
  history?: ConclusionRevision[];
  createdAt: number;
  updatedAt: number;
  relatedProjects?: string[];
}

export interface ConclusionCreateResponse {
  id: string;
  rev: number;
  path: string;
}

export interface ConclusionAppendResponse {
  id: string;
  rev: number;
}
