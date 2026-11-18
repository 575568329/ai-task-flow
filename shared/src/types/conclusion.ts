// 结论卡共享类型：项目/版本/个人 + 逐版完整快照。
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
  source: ConclusionSource;
  date: string;
  createdAt: number;
}

export interface Conclusion {
  id: string;
  scope: ProblemScope;
  project?: string;
  version?: string;
  title: string;
  tags?: string[];
  revisions: ConclusionRevision[];
  createdAt: number;
  updatedAt: number;
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
}

export interface ConclusionAppendRequest {
  expectedRev?: number;
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
  source: Pick<ConclusionSource, 'tool' | 'conversationName'>;
  matchedRev?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ConclusionRevisionSummary {
  rev: number;
  date: string;
  changeNote?: string;
  createdAt: number;
  tool: string;
  conversationName?: string;
}

export interface ConclusionDetail {
  id: string;
  scope: ProblemScope;
  project?: string;
  version?: string;
  title: string;
  tags?: string[];
  rev: number;
  latest: ConclusionRevision;
  revisions: ConclusionRevisionSummary[];
  history?: ConclusionRevision[];
  createdAt: number;
  updatedAt: number;
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
