# 结论卡（Conclusion）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在工作台新增「结论」视图：AI 通过 MCP 把长对话中的结论/数据/待办/代码位置记录为带完整演进历史的主题卡，人可在页面一眼看到最新版并展开历史。

**Architecture:** 沿用 worklog 的竖切模式：`shared` 类型与工具元数据 → `domain` 纯规则与仓储接口 → `infrastructure` 双层锁 JSON 仓储 → `application` 服务 → `interfaces` HTTP/MCP → React 独立视图。追加版本在同一文件锁事务内完成；`expectedRev` 提供乐观锁；来源信息在接口层解析。

**Tech Stack:** TypeScript（ESM/Node16）、Fastify、@modelcontextprotocol/sdk、proper-lockfile、write-file-atomic、React 19、Zustand（仅既有 store）、Tailwind v4、vitest。

## Global Constraints

- 统一使用 npm；禁用 pnpm/cnpm/yarn。
- 后端 ESM + Node16：TS 源码中相对 import 必须带 `.js` 后缀。
- 改 `shared/` 后先执行 `cd shared && npm run build`（或 dev 下保持 watch），否则后端/前端 tsc 找不到 `.d.ts`。
- 后端单测：`cd backend && npx vitest run <测试路径>`；前端单测：`cd frontend && npx vitest run <测试路径>`。
- 数据目录只能通过 `backend/src/config/dataDir.ts` 的 `resolveDataDir()` 获取；禁止直接用 `os.homedir()` / `~`。
- 领域命名 `Conclusion`；UI 文案叫「结论卡」。
- 不修改 worklog 的行为与数据格式；不引入新依赖。
- 前端结论视图状态用局部 `useState`，不新增全局 store。
- 每个 Task 完成后 `git commit`，只在本地提交，**禁止 push**。提交信息末尾固定加：
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- 提交时机：一个 Task 的测试全绿后提交，禁止边写边提交。

---

## File Structure

```text
shared/src/
  types/conclusion.ts                     # 新增：共享类型与请求/响应
  conclusion/mcpToolCatalog.ts            # 新增：2 个 MCP 工具元数据单一来源
  index.ts                                # 修改：导出新增模块

backend/src/
  config/dataDir.ts                       # 修改：conclusions.json / conclusion-backups 路径
  domain/conclusion/
    errors.ts                             # 新增：4 个领域错误
    ConclusionRules.ts                    # 新增：创建/追加/元信息 patch 纯规则
    repositories/ConclusionRepository.ts  # 新增：仓储接口
    __tests__/ConclusionRules.test.ts     # 新增
  infrastructure/persistence/
    JsonConclusionRepository.ts           # 新增：双层锁 + 原子写 + 滚动备份
    __tests__/JsonConclusionRepository.test.ts # 新增
  application/conclusion/
    ConclusionService.ts                  # 新增：唯一业务入口
    __tests__/ConclusionService.test.ts   # 新增
  interfaces/
    source.ts                             # 新增：MCP/HTTP 来源解析
    __tests__/source.test.ts              # 新增
    http/routes/conclusionRoutes.ts       # 新增：6 个端点
    http/routes/__tests__/conclusionRoutes.test.ts # 新增
    http/server.ts                        # 修改：注册路由 + 签名
    mcp/resolveSource 复用 interfaces/source.ts
    mcp/tools/types.ts                    # 修改：ToolDeps 增加 conclusion 依赖
    mcp/tools/index.ts                    # 修改：注册 2 个工具
    mcp/tools/conclusion/_shared.ts       # 新增
    mcp/tools/conclusion/record-conclusion.ts # 新增
    mcp/tools/conclusion/query-conclusions.ts # 新增
    mcp/tools/conclusion/__tests__/conclusion-tools.test.ts # 新增
    mcp/server.ts                         # 修改：装配 ConclusionService
  http-server.ts                          # 修改：装配并传入 conclusionService

frontend/src/
  api/conclusion.ts                       # 新增
  components/conclusion/
    searchFilter.ts                       # 新增：分组/筛选纯函数
    ConclusionProjectList.tsx             # 新增
    ConclusionCardItem.tsx                # 新增
    ConclusionForm.tsx                    # 新增
    ConclusionMetaForm.tsx                # 新增：改信息（标题/归属/版本/标签）
    RevisionTimeline.tsx                  # 新增
    ConclusionView.tsx                    # 新增：视图主体
    __tests__/searchFilter.test.ts        # 新增
    __tests__/conclusionComponents.test.tsx # 新增
  components/views/ConclusionView.tsx     # 新增：薄包装
  components/SidebarNav.tsx               # 修改：新增入口
  App.tsx                                 # 修改：注册视图

tests/curl/test_conclusion_crud.sh        # 新增
README.md / .claude/CLAUDE.md / docs/mcp-registration.md # 修改
```

---

## Task 1: 共享类型与 MCP 工具元数据

**Files:**
- Create: `shared/src/types/conclusion.ts`
- Create: `shared/src/conclusion/mcpToolCatalog.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Produces: `ProblemScope`、`ConclusionCodeRef`、`ConclusionSource`、`ConclusionRevision`、`Conclusion`、`ConclusionData`、`ConclusionCreateRequest`、`ConclusionAppendRequest`、`ConclusionPatchRequest`、`ConclusionQueryRequest`、`ConclusionSummary`、`ConclusionDetail`、`ConclusionCreateResponse`、`ConclusionAppendResponse`、`CONCLUSION_TOOL_CATALOG`。

- [ ] **Step 1: 写共享类型**

创建 `shared/src/types/conclusion.ts`：

```ts
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
```

- [ ] **Step 2: 写 MCP 工具元数据（单一来源）**

创建 `shared/src/conclusion/mcpToolCatalog.ts`：

```ts
export interface ConclusionToolMeta {
  name: string;
  description: string;
  whenToUse: string;
  userPromptExample: string;
}

export const CONCLUSION_TOOL_CATALOG: ConclusionToolMeta[] = [
  {
    name: 'record_conclusion',
    description:
      '记录或更新一张结论卡（主题 → 结论/数据/待办/代码位置）。' +
      '仅在用户明确要求记录结论时调用，禁止主动捕获。' +
      '追加时先调 query_conclusions({cardId}) 读取最新版；省略的字段沿用上一版，' +
      '显式传 "" 或 [] 表示清空。追加必须提供 changeNote，建议带 expectedRev。' +
      '禁止记录密钥、令牌、个人敏感信息。',
    whenToUse:
      '用户说“把刚才的结论记一下/存一张结论卡/更新某张结论卡”，' +
      '或一次讨论明确了决策、关键数据、待办时（由用户触发）。',
    userPromptExample:
      '把刚才的结论记到 ai-task-flow，项目 ai-task-flow：结论、关键数据、待办、涉及文件。',
  },
  {
    name: 'query_conclusions',
    description:
      '查询结论卡。不传 cardId 时按条件搜索，返回摘要用于定位；' +
      '传 cardId 时返回该卡最新版完整四节与演进摘要，供更新前读取当前进度。' +
      'includeHistory=true 时额外返回全部历史版本全文。',
    whenToUse:
      '用户说“更新刚才那个结论”但上下文没有 cardId，或需要回看某张卡当前结论时。',
    userPromptExample: '把 worklog 全局搜索那张结论卡找出来，看看现在定的是什么。',
  },
];
```

- [ ] **Step 3: 导出**

修改 `shared/src/index.ts`，追加：

```ts
export * from './types/conclusion.js';
export * from './conclusion/mcpToolCatalog.js';
```

- [ ] **Step 4: 构建验证**

Run: `cd shared && npm run build`
Expected: 编译通过，`shared/dist/types/conclusion.js`、`shared/dist/conclusion/mcpToolCatalog.js` 生成。

- [ ] **Step 5: 提交**

```bash
git add shared/src/types/conclusion.ts shared/src/conclusion/mcpToolCatalog.ts shared/src/index.ts shared/dist
git commit -m "feat(conclusion): 共享类型与 MCP 工具元数据

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

> 注：`shared/dist` 是否入库按仓库现状处理；若 `.gitignore` 忽略 dist，则只提交源码。

---

## Task 2: 领域规则与仓储接口

**Files:**
- Create: `backend/src/domain/conclusion/errors.ts`
- Create: `backend/src/domain/conclusion/ConclusionRules.ts`
- Create: `backend/src/domain/conclusion/repositories/ConclusionRepository.ts`
- Test: `backend/src/domain/conclusion/__tests__/ConclusionRules.test.ts`

**Interfaces:**
- Consumes: Task 1 的共享类型。
- Produces: `ConclusionNotFoundError`、`ConclusionValidationError`、`ConclusionConflictError`、`ConclusionStorageError`；`createConclusion`、`appendRevision`、`patchConclusionMeta`、`localDate`、`newConclusionId`；`ConclusionRepository`、`ConclusionMutateOptions`。

- [ ] **Step 1: 写失败测试**

创建 `backend/src/domain/conclusion/__tests__/ConclusionRules.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import type { ConclusionSource } from '@ai-task-flow/shared';
import { appendRevision, createConclusion, patchConclusionMeta } from '../ConclusionRules.js';
import { ConclusionConflictError, ConclusionValidationError } from '../errors.js';

const source: ConclusionSource = {
  tool: 'claude-code',
  conversationId: 'sess-1',
  cwd: '/repo',
};

function make() {
  return createConclusion(
    {
      scope: 'project',
      project: 'ai-task-flow',
      version: 'v0.3',
      title: '全局搜索方案',
      decision: '采用服务端过滤',
      data: '接口耗时 10ms',
      tags: ['架构'],
    },
    source,
    1000,
  );
}

describe('createConclusion', () => {
  it('should create rev 1 with source and local date', () => {
    const c = make();
    expect(c.id).toMatch(/^c_/);
    expect(c.revisions).toHaveLength(1);
    expect(c.revisions[0].rev).toBe(1);
    expect(c.revisions[0].decision).toBe('采用服务端过滤');
    expect(c.revisions[0].source.conversationId).toBe('sess-1');
    expect(c.revisions[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(c.createdAt).toBe(1000);
  });

  it('should reject personal scope with project or version', () => {
    expect(() => createConclusion(
      { scope: 'personal', project: 'p', title: 't', decision: 'd' },
      source,
    )).toThrow(ConclusionValidationError);
    expect(() => createConclusion(
      { scope: 'personal', version: 'v1', title: 't', decision: 'd' },
      source,
    )).toThrow(ConclusionValidationError);
  });

  it('should reject project scope without project', () => {
    expect(() => createConclusion(
      { scope: 'project', title: 't', decision: 'd' },
      source,
    )).toThrow(ConclusionValidationError);
  });

  it('should reject empty decision and invalid date', () => {
    expect(() => createConclusion(
      { scope: 'project', project: 'p', title: 't', decision: '  ' },
      source,
    )).toThrow(ConclusionValidationError);
    expect(() => createConclusion(
      { scope: 'project', project: 'p', title: 't', decision: 'd', date: '2026-02-30' },
      source,
    )).toThrow(ConclusionValidationError);
  });
});

describe('appendRevision', () => {
  it('should inherit omitted fields and increment rev', () => {
    const c = make();
    const rev = appendRevision(c, { data: '新数据', changeNote: '补充数据' }, source, 2000);
    expect(rev.rev).toBe(2);
    expect(rev.decision).toBe('采用服务端过滤');
    expect(rev.data).toBe('新数据');
    expect(c.updatedAt).toBe(2000);
  });

  it('should clear optional field when empty string is explicit', () => {
    const c = make();
    appendRevision(c, { data: '', changeNote: '去掉数据' }, source, 2000);
    expect(c.revisions[1].data).toBeUndefined();
  });

  it('should require changeNote', () => {
    const c = make();
    expect(() => appendRevision(c, { data: 'x', changeNote: '  ' }, source))
      .toThrow(ConclusionValidationError);
  });

  it('should reject no-op append', () => {
    const c = make();
    expect(() => appendRevision(c, { changeNote: '没变' }, source))
      .toThrow(ConclusionValidationError);
  });

  it('should reject stale expectedRev', () => {
    const c = make();
    expect(() => appendRevision(c, { data: 'x', changeNote: 'c', expectedRev: 9 }, source))
      .toThrow(ConclusionConflictError);
  });

  it('should allow metadata-only append', () => {
    const c = make();
    const rev = appendRevision(c, { title: '新标题', changeNote: '改名' }, source, 2000);
    expect(rev.rev).toBe(2);
    expect(c.title).toBe('新标题');
  });
});

describe('patchConclusionMeta', () => {
  it('should clear project and version when switching to personal', () => {
    const c = make();
    patchConclusionMeta(c, { scope: 'personal' });
    expect(c.scope).toBe('personal');
    expect(c.project).toBeUndefined();
    expect(c.version).toBeUndefined();
  });

  it('should reject invalid title', () => {
    const c = make();
    expect(() => patchConclusionMeta(c, { title: '  ' })).toThrow(ConclusionValidationError);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && npx vitest run src/domain/conclusion`
Expected: FAIL，提示找不到 `../ConclusionRules.js` / `../errors.js`。

- [ ] **Step 3: 写领域错误**

创建 `backend/src/domain/conclusion/errors.ts`：

```ts
import { DomainError } from '../_shared/DomainError.js';

export class ConclusionNotFoundError extends DomainError {
  readonly httpStatus = 404;
  constructor(message: string) {
    super(message, 'CONCLUSION_NOT_FOUND');
  }
}

export class ConclusionValidationError extends DomainError {
  readonly httpStatus = 400;
  constructor(message: string) {
    super(message, 'CONCLUSION_VALIDATION');
  }
}

export class ConclusionConflictError extends DomainError {
  readonly httpStatus = 409;
  constructor(message: string) {
    super(message, 'CONCLUSION_CONFLICT');
  }
}

export class ConclusionStorageError extends DomainError {
  readonly httpStatus = 500;
  constructor(message: string) {
    super(message, 'CONCLUSION_STORAGE');
  }
}
```

- [ ] **Step 4: 写领域规则**

创建 `backend/src/domain/conclusion/ConclusionRules.ts`：

```ts
import { randomUUID } from 'node:crypto';
import type {
  Conclusion,
  ConclusionAppendRequest,
  ConclusionCodeRef,
  ConclusionCreateRequest,
  ConclusionPatchRequest,
  ConclusionRevision,
  ConclusionSource,
  ProblemScope,
} from '@ai-task-flow/shared';
import {
  ConclusionConflictError,
  ConclusionValidationError,
} from './errors.js';

const NAME_MAX = 60;
const TITLE_MAX = 200;
const SECTION_MAX = 100_000;
const CHANGE_NOTE_MAX = 1_000;
const TAG_MAX = 20;

export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function newConclusionId(): string {
  return `c_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

function requiredText(value: string | undefined, label: string, max = SECTION_MAX): string {
  const text = value?.trim() ?? '';
  if (!text) throw new ConclusionValidationError(`${label}不能为空`);
  if (text.length > max) throw new ConclusionValidationError(`${label}长度不能超过 ${max}`);
  return text;
}

function optionalText(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (value.length > SECTION_MAX) throw new ConclusionValidationError(`${label}长度不能超过 ${SECTION_MAX}`);
  return value;
}

function validateName(value: string | undefined, label: string): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (text.includes('/')) throw new ConclusionValidationError(`${label}不能包含 "/"`);
  if (text.length > NAME_MAX) throw new ConclusionValidationError(`${label}长度不能超过 ${NAME_MAX}`);
  return text;
}

export function validateScope(
  scope: ProblemScope | undefined,
  project?: string,
  version?: string,
): { project?: string; version?: string } {
  if (scope !== 'project' && scope !== 'personal') {
    throw new ConclusionValidationError('scope 必须为 project 或 personal');
  }
  const p = validateName(project, '项目名');
  const v = validateName(version, '版本名');
  if (scope === 'personal') {
    if (p) throw new ConclusionValidationError('个人问题不能填写项目');
    if (v) throw new ConclusionValidationError('个人问题不能填写版本');
    return {};
  }
  if (!p) throw new ConclusionValidationError('项目问题必须填写项目名');
  return { project: p, version: v };
}

function validateTags(tags?: string[]): string[] | undefined {
  if (tags === undefined) return undefined;
  if (!Array.isArray(tags)) throw new ConclusionValidationError('tags 必须为字符串数组');
  const normalized = tags.map((t) => String(t).trim()).filter(Boolean);
  if (normalized.length > TAG_MAX) throw new ConclusionValidationError(`标签不能超过 ${TAG_MAX} 个`);
  return normalized.length ? normalized : undefined;
}

function validateCodeRefs(refs?: ConclusionCodeRef[]): ConclusionCodeRef[] | undefined {
  if (refs === undefined) return undefined;
  if (!Array.isArray(refs)) throw new ConclusionValidationError('codeRefs 必须为数组');
  return refs.map((ref) => {
    if (!ref || typeof ref !== 'object' || typeof ref.path !== 'string' || !ref.path.trim()) {
      throw new ConclusionValidationError('codeRefs 每项必须包含非空 path');
    }
    return { ...ref, path: ref.path.trim() };
  });
}

export function validateDate(date: string | undefined): string {
  const value = date?.trim() || localDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ConclusionValidationError('date 必须为 YYYY-MM-DD 格式');
  }
  const [y, m, d] = value.split('-').map(Number);
  const parsed = new Date(y, m - 1, d);
  if (parsed.getFullYear() !== y || parsed.getMonth() !== m - 1 || parsed.getDate() !== d) {
    throw new ConclusionValidationError('date 不是合法日期');
  }
  return value;
}

function normalizeTitle(title: string | undefined): string {
  return requiredText(title, '标题', TITLE_MAX);
}

function resolveMeta(
  current: Pick<Conclusion, 'scope' | 'project' | 'version'>,
  patch: { scope?: ProblemScope; project?: string; version?: string },
): Pick<Conclusion, 'scope' | 'project' | 'version'> {
  const scope = patch.scope ?? current.scope;
  const project = patch.project !== undefined
    ? patch.project
    : scope === 'personal' ? undefined : current.project;
  const version = patch.version !== undefined
    ? patch.version
    : scope === 'personal' ? undefined : current.version;
  return { scope, ...validateScope(scope, project, version) };
}

export function createConclusion(
  input: ConclusionCreateRequest,
  source: ConclusionSource,
  now = Date.now(),
): Conclusion {
  const meta = validateScope(input.scope, input.project, input.version);
  const revision: ConclusionRevision = {
    rev: 1,
    decision: requiredText(input.decision, '结论/决策'),
    data: optionalText(input.data, '关键数据'),
    openItems: optionalText(input.openItems, '待办/未决'),
    codeRefs: validateCodeRefs(input.codeRefs),
    changeNote: input.changeNote
      ? requiredText(input.changeNote, '变更说明', CHANGE_NOTE_MAX)
      : undefined,
    source: { ...source, conversationName: input.conversationName ?? source.conversationName },
    date: validateDate(input.date),
    createdAt: now,
  };
  return {
    id: newConclusionId(),
    scope: input.scope,
    project: meta.project,
    version: meta.version,
    title: normalizeTitle(input.title),
    tags: validateTags(input.tags),
    revisions: [revision],
    createdAt: now,
    updatedAt: now,
  };
}

export function appendRevision(
  conclusion: Conclusion,
  input: ConclusionAppendRequest,
  source: ConclusionSource,
  now = Date.now(),
): ConclusionRevision {
  const latest = conclusion.revisions[conclusion.revisions.length - 1];
  if (!latest) throw new ConclusionValidationError('结论卡没有历史版本');
  if (input.expectedRev !== undefined && input.expectedRev !== latest.rev) {
    throw new ConclusionConflictError(
      `版本已更新：期望 rev ${input.expectedRev}，当前 rev ${latest.rev}`,
    );
  }

  const changeNote = requiredText(input.changeNote, '变更说明', CHANGE_NOTE_MAX);
  const beforeMeta = JSON.stringify({
    scope: conclusion.scope,
    project: conclusion.project,
    version: conclusion.version,
    title: conclusion.title,
    tags: conclusion.tags,
  });

  const meta = resolveMeta(conclusion, input);
  conclusion.scope = meta.scope;
  conclusion.project = meta.project;
  conclusion.version = meta.version;
  if (input.title !== undefined) conclusion.title = normalizeTitle(input.title);
  if (input.tags !== undefined) conclusion.tags = validateTags(input.tags);

  const afterMeta = JSON.stringify({
    scope: conclusion.scope,
    project: conclusion.project,
    version: conclusion.version,
    title: conclusion.title,
    tags: conclusion.tags,
  });
  const metaChanged = beforeMeta !== afterMeta;

  const merged = {
    decision: input.decision !== undefined
      ? requiredText(input.decision, '结论/决策')
      : latest.decision,
    data: input.data !== undefined ? optionalText(input.data, '关键数据') : latest.data,
    openItems: input.openItems !== undefined ? optionalText(input.openItems, '待办/未决') : latest.openItems,
    codeRefs: input.codeRefs !== undefined ? validateCodeRefs(input.codeRefs) : latest.codeRefs,
  };
  const contentChanged = (['decision', 'data', 'openItems', 'codeRefs'] as const)
    .some((key) => JSON.stringify(merged[key]) !== JSON.stringify(latest[key]));
  if (!contentChanged && !metaChanged) {
    throw new ConclusionValidationError('没有任何变化，未生成新版本');
  }

  const revision: ConclusionRevision = {
    rev: latest.rev + 1,
    decision: merged.decision,
    data: merged.data,
    openItems: merged.openItems,
    codeRefs: merged.codeRefs,
    changeNote,
    source: { ...source, conversationName: input.conversationName ?? source.conversationName },
    date: validateDate(input.date),
    createdAt: now,
  };
  if (revision.data === '') delete revision.data;
  if (revision.openItems === '') delete revision.openItems;
  if (revision.codeRefs && revision.codeRefs.length === 0) delete revision.codeRefs;

  conclusion.revisions.push(revision);
  conclusion.updatedAt = now;
  return revision;
}

export function patchConclusionMeta(conclusion: Conclusion, patch: ConclusionPatchRequest): void {
  const meta = resolveMeta(conclusion, patch);
  conclusion.scope = meta.scope;
  conclusion.project = meta.project;
  conclusion.version = meta.version;
  if (patch.title !== undefined) conclusion.title = normalizeTitle(patch.title);
  if (patch.tags !== undefined) conclusion.tags = validateTags(patch.tags);
  conclusion.updatedAt = Date.now();
}
```

- [ ] **Step 5: 写仓储接口**

创建 `backend/src/domain/conclusion/repositories/ConclusionRepository.ts`：

```ts
import type { ConclusionData } from '@ai-task-flow/shared';

export interface ConclusionMutateOptions {
  /** 破坏性操作前快照，默认 false */
  backup?: boolean;
}

export interface ConclusionRepository {
  /** 每次直读磁盘，不缓存 */
  load(): Promise<ConclusionData>;
  /** 在写协议保护下执行读-改-写事务 */
  mutate<T>(
    fn: (data: ConclusionData) => T | Promise<T>,
    options?: ConclusionMutateOptions,
  ): Promise<T>;
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd backend && npx vitest run src/domain/conclusion`
Expected: PASS（12 个用例）。

- [ ] **Step 7: 提交**

```bash
git add backend/src/domain/conclusion
git commit -m "feat(conclusion): 领域规则与仓储接口——逐版快照/字段沿用/expectedRev

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: JSON 仓储（双层锁 + 原子写 + 备份）

**Files:**
- Create: `backend/src/infrastructure/persistence/JsonConclusionRepository.ts`
- Test: `backend/src/infrastructure/persistence/__tests__/JsonConclusionRepository.test.ts`

**Interfaces:**
- Consumes: `ConclusionRepository`、`ConclusionMutateOptions`（Task 2）。
- Produces: `JsonConclusionRepository`，构造签名 `(filePath: string, backupsDir: string)`。

- [ ] **Step 1: 写失败测试**

创建 `backend/src/infrastructure/persistence/__tests__/JsonConclusionRepository.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { JsonConclusionRepository } from '../JsonConclusionRepository.js';
import { ConclusionStorageError } from '../../../domain/conclusion/errors.js';

describe('JsonConclusionRepository', () => {
  let tmpDir: string;
  let filePath: string;
  let backupsDir: string;
  let repo: JsonConclusionRepository;

  beforeEach(async () => {
    const { nanoid } = await import('nanoid');
    tmpDir = path.join(os.tmpdir(), `conclusion-repo-${nanoid()}`);
    filePath = path.join(tmpDir, 'conclusions.json');
    backupsDir = path.join(tmpDir, 'conclusion-backups');
    repo = new JsonConclusionRepository(filePath, backupsDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should return empty data when file does not exist', async () => {
    await expect(repo.load()).resolves.toEqual({ schemaVersion: 1, conclusions: [] });
  });

  it('should persist mutations and read them back', async () => {
    await repo.mutate((data) => {
      data.conclusions.push({
        id: 'c_1', scope: 'project', project: 'p', title: 't',
        revisions: [{
          rev: 1, decision: 'd', source: { tool: 'manual' },
          date: '2026-11-18', createdAt: 1,
        }],
        createdAt: 1, updatedAt: 1,
      });
    });
    const loaded = await repo.load();
    expect(loaded.conclusions).toHaveLength(1);
    expect(loaded.conclusions[0].id).toBe('c_1');
  });

  it('should create a snapshot when backup option is true', async () => {
    await repo.mutate(() => undefined, { backup: true });
    const names = await fs.readdir(backupsDir);
    expect(names.filter((n) => n.startsWith('backup-'))).toHaveLength(1);
  });

  it('should keep only 10 backups', async () => {
    for (let i = 0; i < 12; i++) {
      await repo.mutate(() => undefined, { backup: true });
    }
    const names = await fs.readdir(backupsDir);
    expect(names.filter((n) => n.startsWith('backup-'))).toHaveLength(10);
  });

  it('should throw ConclusionStorageError on corrupt JSON and not overwrite it', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(filePath, '{ broken', 'utf-8');
    await expect(repo.load()).rejects.toBeInstanceOf(ConclusionStorageError);
    await expect(fs.readFile(filePath, 'utf-8')).resolves.toBe('{ broken');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && npx vitest run src/infrastructure/persistence/__tests__/JsonConclusionRepository.test.ts`
Expected: FAIL，找不到 `../JsonConclusionRepository.js`。

- [ ] **Step 3: 实现仓储**

创建 `backend/src/infrastructure/persistence/JsonConclusionRepository.ts`：

```ts
// 结论卡仓储：双层锁 + 锁内重读 + 原子写 + 破坏性操作前快照。
// 与 JsonWorklogRepository 同协议；HTTP 与 MCP 是两个进程，缺一不可。
import fs from 'node:fs/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import writeFileAtomic from 'write-file-atomic';
import type { ConclusionData } from '@ai-task-flow/shared';
import { JsonRepository } from './JsonRepository.js';
import type {
  ConclusionMutateOptions,
  ConclusionRepository,
} from '../../domain/conclusion/repositories/ConclusionRepository.js';
import { ConclusionStorageError } from '../../domain/conclusion/errors.js';

const MAX_BACKUPS = 10;
const LOCK_RETRIES = { retries: 20, factor: 1.5, minTimeout: 100, maxTimeout: 2000 };
const LOCK_STALE_MS = 30_000;

export class JsonConclusionRepository extends JsonRepository implements ConclusionRepository {
  private readonly backupsDir: string;

  constructor(filePath: string, backupsDir: string) {
    super(filePath);
    this.backupsDir = backupsDir;
  }

  async load(): Promise<ConclusionData> {
    const raw = await this.read();
    if (!raw || !raw.trim()) return { schemaVersion: 1, conclusions: [] };
    let parsed: ConclusionData;
    try {
      parsed = JSON.parse(raw) as ConclusionData;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ConclusionStorageError(`结论数据文件损坏（${this.filePath}）：${message}`);
    }
    if (!parsed || !Array.isArray(parsed.conclusions)) {
      return { schemaVersion: 1, conclusions: [] };
    }
    return { schemaVersion: 1, conclusions: parsed.conclusions };
  }

  async mutate<T>(
    fn: (data: ConclusionData) => T | Promise<T>,
    options?: ConclusionMutateOptions,
  ): Promise<T> {
    return this.withWriteLock(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await lockfile.lock(this.filePath, {
        realpath: false,
        retries: LOCK_RETRIES,
        stale: LOCK_STALE_MS,
      });
      try {
        const data = await this.load();
        if (options?.backup) await this.snapshot(data);
        const result = await fn(data);
        await this.writeAtomic(JSON.stringify(data, null, 2));
        return result;
      } finally {
        await lockfile.unlock(this.filePath).catch((err: unknown) => {
          console.warn('[ConclusionRepository] unlock 失败（可能锁已被抢占）:', err);
        });
      }
    });
  }

  private writeAtomic(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      writeFileAtomic(this.filePath, text, 'utf-8', (err) => (err ? reject(err) : resolve()));
    });
  }

  private async snapshot(data: ConclusionData): Promise<void> {
    await fs.mkdir(this.backupsDir, { recursive: true });
    const now = new Date();
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    const ts =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${pad(now.getMilliseconds(), 3)}`;
    const rand = Math.random().toString(36).slice(2, 6);
    await fs.writeFile(
      path.join(this.backupsDir, `backup-${ts}_${rand}.json`),
      JSON.stringify(data, null, 2),
      'utf-8',
    );
    await this.pruneBackups();
  }

  private async pruneBackups(): Promise<void> {
    let names: string[];
    try {
      names = (await fs.readdir(this.backupsDir)).filter((n) => n.startsWith('backup-')).sort();
    } catch {
      return;
    }
    const excess = names.length - MAX_BACKUPS;
    for (let i = 0; i < excess; i++) {
      await fs.unlink(path.join(this.backupsDir, names[i])).catch(() => {});
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && npx vitest run src/infrastructure/persistence/__tests__/JsonConclusionRepository.test.ts`
Expected: PASS（5 个用例）。

- [ ] **Step 5: 提交**

```bash
git add backend/src/infrastructure/persistence/JsonConclusionRepository.ts backend/src/infrastructure/persistence/__tests__/JsonConclusionRepository.test.ts
git commit -m "feat(conclusion): JSON 仓储——双层锁/原子写/滚动备份

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: 应用服务（创建/追加/查询/详情/删除）

**Files:**
- Create: `backend/src/application/conclusion/ConclusionService.ts`
- Test: `backend/src/application/conclusion/__tests__/ConclusionService.test.ts`

**Interfaces:**
- Consumes: Task 2 的规则与接口、Task 3 的仓储实现。
- Produces: `ConclusionService`，方法签名：
  - `create(input: ConclusionCreateRequest, source: ConclusionSource): Promise<ConclusionCreateResponse>`
  - `append(cardId: string, input: ConclusionAppendRequest, source: ConclusionSource): Promise<ConclusionAppendResponse>`
  - `patch(cardId: string, input: ConclusionPatchRequest): Promise<Conclusion>`
  - `delete(cardId: string): Promise<{ deleted: true }>`
  - `get(cardId: string): Promise<Conclusion>`
  - `getDetail(cardId: string, includeHistory?: boolean): Promise<ConclusionDetail>`
  - `query(input: ConclusionQueryRequest): Promise<ConclusionSummary[]>`

- [ ] **Step 1: 写失败测试**

创建 `backend/src/application/conclusion/__tests__/ConclusionService.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { ConclusionSource } from '@ai-task-flow/shared';
import { ConclusionService } from '../ConclusionService.js';
import { JsonConclusionRepository } from '../../../infrastructure/persistence/JsonConclusionRepository.js';
import { ConclusionConflictError, ConclusionNotFoundError } from '../../../domain/conclusion/errors.js';

const source: ConclusionSource = { tool: 'claude-code', conversationId: 'sess-1' };

describe('ConclusionService', () => {
  let tmpDir: string;
  let service: ConclusionService;

  beforeEach(async () => {
    const { nanoid } = await import('nanoid');
    tmpDir = path.join(os.tmpdir(), `conclusion-service-${nanoid()}`);
    service = new ConclusionService(
      new JsonConclusionRepository(path.join(tmpDir, 'conclusions.json'), path.join(tmpDir, 'backups')),
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function createInput(over: Record<string, unknown> = {}) {
    return {
      scope: 'project' as const,
      project: 'ai-task-flow',
      title: '全局搜索方案',
      decision: '旧结论：前端过滤',
      data: '旧数据',
      ...over,
    };
  }

  it('should create a card and read it back', async () => {
    const res = await service.create(createInput(), source);
    expect(res.id).toMatch(/^c_/);
    expect(res.rev).toBe(1);
    expect(res.path).toBe('ai-task-flow/全局搜索方案#1');

    const card = await service.get(res.id);
    expect(card.title).toBe('全局搜索方案');
    expect(card.revisions[0].source.conversationId).toBe('sess-1');
  });

  it('should append with inherited fields and explicit clear', async () => {
    const { id } = await service.create(createInput(), source);
    const appended = await service.append(id, {
      expectedRev: 1,
      data: '新数据',
      changeNote: '补充数据',
    }, source);
    expect(appended.rev).toBe(2);

    const card = await service.get(id);
    expect(card.revisions[1].decision).toBe('旧结论：前端过滤');
    expect(card.revisions[1].data).toBe('新数据');

    await service.append(id, { data: '', changeNote: '清空数据' }, source);
    const card2 = await service.get(id);
    expect(card2.revisions[2].data).toBeUndefined();
  });

  it('should not create backups for pure append', async () => {
    const { id } = await service.create(createInput(), source);
    await service.append(id, { data: 'v2', changeNote: 'v2' }, source);
    const files = await fs.readdir(path.join(tmpDir, 'backups')).catch(() => []);
    expect(files.filter((n) => n.startsWith('backup-'))).toHaveLength(0);
  });

  it('should reject stale expectedRev with Conflict', async () => {
    const { id } = await service.create(createInput(), source);
    await service.append(id, { data: 'v2', changeNote: 'v2' }, source);
    await expect(service.append(id, {
      expectedRev: 1, data: 'stale', changeNote: 'stale',
    }, source)).rejects.toBeInstanceOf(ConclusionConflictError);
  });

  it('should search keyword across all revisions and report matchedRev', async () => {
    const { id } = await service.create(createInput({ decision: '旧结论：前端过滤' }), source);
    await service.append(id, { decision: '新结论：服务端过滤', changeNote: '改方案' }, source);

    const byOld = await service.query({ keyword: '前端过滤' });
    expect(byOld).toHaveLength(1);
    expect(byOld[0].latestDecisionExcerpt).toContain('新结论');
    expect(byOld[0].matchedRev).toBe(1);

    const byNew = await service.query({ keyword: '服务端过滤' });
    expect(byNew[0].matchedRev).toBeUndefined();
  });

  it('should filter by scope/project/tags/date', async () => {
    await service.create(createInput({ date: '2026-11-01', tags: ['架构'] }), source);
    await service.create(createInput({
      scope: 'personal', project: undefined, title: '个人学习', decision: 'd', date: '2026-11-18',
    }), source);

    expect(await service.query({ scope: 'personal' })).toHaveLength(1);
    expect(await service.query({ project: 'ai-task-flow' })).toHaveLength(1);
    expect(await service.query({ tags: ['架构'] })).toHaveLength(1);
    expect(await service.query({ dateFrom: '2026-11-10' })).toHaveLength(1);
    expect(await service.query({ dateTo: '2026-11-05' })).toHaveLength(1);
  });

  it('should return full latest and revision summaries in detail', async () => {
    const { id } = await service.create(createInput(), source);
    await service.append(id, { data: '新数据', changeNote: '补充' }, source);

    const detail = await service.getDetail(id);
    expect(detail.rev).toBe(2);
    expect(detail.latest.data).toBe('新数据');
    expect(detail.revisions.map((r) => r.rev)).toEqual([1, 2]);
    expect(detail.revisions[1].changeNote).toBe('补充');
    expect(detail.history).toBeUndefined();

    const withHistory = await service.getDetail(id, true);
    expect(withHistory.history).toHaveLength(2);
  });

  it('should patch metadata and clear project when switching to personal', async () => {
    const { id } = await service.create(createInput(), source);
    const patched = await service.patch(id, { scope: 'personal', title: '新标题' });
    expect(patched.scope).toBe('personal');
    expect(patched.project).toBeUndefined();
    expect(patched.title).toBe('新标题');
  });

  it('should delete a card and create a backup', async () => {
    const { id } = await service.create(createInput(), source);
    await expect(service.delete(id)).resolves.toEqual({ deleted: true });
    await expect(service.get(id)).rejects.toBeInstanceOf(ConclusionNotFoundError);

    const backups = await fs.readdir(path.join(tmpDir, 'backups'));
    expect(backups.filter((n) => n.startsWith('backup-'))).toHaveLength(1);
  });

  it('should serialize concurrent appends from two repository instances', async () => {
    const file = path.join(tmpDir, 'conclusions.json');
    const backups = path.join(tmpDir, 'backups');
    const s1 = new ConclusionService(new JsonConclusionRepository(file, backups));
    const s2 = new ConclusionService(new JsonConclusionRepository(file, backups));

    const { id } = await s1.create(createInput(), source);
    await Promise.all([
      s1.append(id, { data: 'A', changeNote: 'a' }, source),
      s2.append(id, { data: 'B', changeNote: 'b' }, source),
    ]);

    const card = await s1.get(id);
    expect(card.revisions.map((r) => r.rev)).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && npx vitest run src/application/conclusion`
Expected: FAIL，找不到 `../ConclusionService.js`。

- [ ] **Step 3: 实现服务**

创建 `backend/src/application/conclusion/ConclusionService.ts`：

```ts
import type {
  Conclusion,
  ConclusionAppendRequest,
  ConclusionAppendResponse,
  ConclusionCreateRequest,
  ConclusionCreateResponse,
  ConclusionData,
  ConclusionDetail,
  ConclusionPatchRequest,
  ConclusionQueryRequest,
  ConclusionRevision,
  ConclusionSource,
  ConclusionSummary,
} from '@ai-task-flow/shared';
import type { ConclusionRepository } from '../../domain/conclusion/repositories/ConclusionRepository.js';
import {
  appendRevision,
  createConclusion,
  patchConclusionMeta,
} from '../../domain/conclusion/ConclusionRules.js';
import { ConclusionNotFoundError } from '../../domain/conclusion/errors.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const EXCERPT_LENGTH = 1500;

function excerpt(text: string): string {
  return text.length <= EXCERPT_LENGTH ? text : `${text.slice(0, EXCERPT_LENGTH)}…`;
}

function findConclusion(data: ConclusionData, cardId: string): Conclusion {
  const card = data.conclusions.find((c) => c.id === cardId);
  if (!card) throw new ConclusionNotFoundError(`结论卡 ${cardId} 不存在`);
  return card;
}

function revisionMatches(revision: ConclusionRevision, keyword: string): boolean {
  const haystack = [
    revision.decision,
    revision.data,
    revision.openItems,
    revision.changeNote,
    ...(revision.codeRefs?.map((ref) => ref.path) ?? []),
  ].filter(Boolean).join('\n').toLowerCase();
  return haystack.includes(keyword);
}

function latestOf(card: Conclusion): ConclusionRevision {
  const latest = card.revisions[card.revisions.length - 1];
  if (!latest) throw new ConclusionNotFoundError(`结论卡 ${card.id} 没有历史版本`);
  return latest;
}

export class ConclusionService {
  constructor(private readonly repo: ConclusionRepository) {}

  async create(
    input: ConclusionCreateRequest,
    source: ConclusionSource,
  ): Promise<ConclusionCreateResponse> {
    return this.repo.mutate((data) => {
      const card = createConclusion(input, source);
      data.conclusions.push(card);
      return {
        id: card.id,
        rev: 1,
        path: `${card.project ?? '个人'}/${card.title}#1`,
      };
    });
  }

  async append(
    cardId: string,
    input: ConclusionAppendRequest,
    source: ConclusionSource,
  ): Promise<ConclusionAppendResponse> {
    return this.repo.mutate((data) => {
      const card = findConclusion(data, cardId);
      const revision = appendRevision(card, input, source);
      return { id: card.id, rev: revision.rev };
    });
  }

  async patch(cardId: string, input: ConclusionPatchRequest): Promise<Conclusion> {
    return this.repo.mutate(
      (data) => {
        const card = findConclusion(data, cardId);
        patchConclusionMeta(card, input);
        return card;
      },
      { backup: true },
    );
  }

  async delete(cardId: string): Promise<{ deleted: true }> {
    await this.repo.mutate(
      (data) => {
        const index = data.conclusions.findIndex((c) => c.id === cardId);
        if (index < 0) throw new ConclusionNotFoundError(`结论卡 ${cardId} 不存在`);
        data.conclusions.splice(index, 1);
      },
      { backup: true },
    );
    return { deleted: true };
  }

  async get(cardId: string): Promise<Conclusion> {
    const data = await this.repo.load();
    return findConclusion(data, cardId);
  }

  async getDetail(cardId: string, includeHistory = false): Promise<ConclusionDetail> {
    const card = await this.get(cardId);
    const latest = latestOf(card);
    return {
      id: card.id,
      scope: card.scope,
      project: card.project,
      version: card.version,
      title: card.title,
      tags: card.tags,
      rev: latest.rev,
      latest,
      revisions: card.revisions.map((revision) => ({
        rev: revision.rev,
        date: revision.date,
        changeNote: revision.changeNote,
        createdAt: revision.createdAt,
        tool: revision.source.tool,
        conversationName: revision.source.conversationName,
      })),
      ...(includeHistory ? { history: card.revisions } : {}),
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
    };
  }

  async query(input: ConclusionQueryRequest): Promise<ConclusionSummary[]> {
    const data = await this.repo.load();
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const keyword = input.keyword?.trim().toLowerCase();

    const matches: Array<{
      card: Conclusion;
      latest: ConclusionRevision;
      matchedRev?: number;
    }> = [];

    for (const card of data.conclusions) {
      if (input.cardId && card.id !== input.cardId) continue;
      if (input.scope && card.scope !== input.scope) continue;
      if (input.project && card.project !== input.project) continue;
      if (input.version && card.version !== input.version) continue;
      if (input.tags?.length && !card.tags?.some((tag) => input.tags!.includes(tag))) continue;

      const latest = latestOf(card);
      if (input.dateFrom && latest.date < input.dateFrom) continue;
      if (input.dateTo && latest.date > input.dateTo) continue;

      let matchedRev: number | undefined;
      if (keyword) {
        const inTitle = card.title.toLowerCase().includes(keyword);
        const matched = card.revisions.filter((revision) => revisionMatches(revision, keyword));
        if (!inTitle && matched.length === 0) continue;
        if (matched.length > 0) matchedRev = matched[matched.length - 1].rev;
      }

      matches.push({ card, latest, matchedRev });
    }

    return matches
      .sort((a, b) =>
        b.latest.date.localeCompare(a.latest.date) || b.card.updatedAt - a.card.updatedAt)
      .slice(0, limit)
      .map(({ card, latest, matchedRev }) => ({
        id: card.id,
        scope: card.scope,
        project: card.project,
        version: card.version,
        title: card.title,
        tags: card.tags,
        rev: latest.rev,
        latestDate: latest.date,
        latestDecisionExcerpt: excerpt(latest.decision),
        source: {
          tool: latest.source.tool,
          conversationName: latest.source.conversationName,
        },
        matchedRev,
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
      }));
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && npx vitest run src/application/conclusion`
Expected: PASS（10 个用例）。

- [ ] **Step 5: 提交**

```bash
git add backend/src/application/conclusion
git commit -m "feat(conclusion): 应用服务——创建/追加合并/查询详情/并发保护

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5: 来源解析（MCP / HTTP）

**Files:**
- Create: `backend/src/interfaces/source.ts`
- Test: `backend/src/interfaces/__tests__/source.test.ts`

**Interfaces:**
- Produces:
  - `McpClientInfo { name?: string; version?: string }`
  - `resolveMcpSource(client: McpClientInfo | undefined, conversationName?: string): ConclusionSource`
  - `resolveManualSource(): ConclusionSource`

- [ ] **Step 1: 写失败测试**

创建 `backend/src/interfaces/__tests__/source.test.ts`：

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { resolveManualSource, resolveMcpSource } from '../source.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveMcpSource', () => {
  it('should prefer AI_AGENT and CLAUDE_CODE_SESSION_ID', () => {
    vi.stubEnv('AI_AGENT', 'claude-code_2-1-314_agent');
    vi.stubEnv('CLAUDE_CODE_SESSION_ID', 'sess-1');
    const source = resolveMcpSource({ name: 'other', version: '9.9' }, '话题A');
    expect(source.tool).toBe('claude-code');
    expect(source.conversationId).toBe('sess-1');
    expect(source.conversationName).toBe('话题A');
    expect(source.agentVersion).toBe('9.9');
  });

  it('should fall back to client name and a process fingerprint', () => {
    vi.stubEnv('AI_AGENT', '');
    vi.stubEnv('CLAUDE_CODE_SESSION_ID', '');
    const source = resolveMcpSource({ name: 'zcode', version: '1.0' });
    expect(source.tool).toBe('zcode');
    expect(source.conversationId).toMatch(/^zcode:\d+:\d+$/);
  });

  it('should fall back to unknown when nothing is available', () => {
    vi.stubEnv('AI_AGENT', '');
    vi.stubEnv('CLAUDE_CODE_SESSION_ID', '');
    const source = resolveMcpSource(undefined);
    expect(source.tool).toBe('unknown');
  });
});

describe('resolveManualSource', () => {
  it('should mark manual and omit conversationId', () => {
    const source = resolveManualSource();
    expect(source.tool).toBe('manual');
    expect(source.conversationId).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && npx vitest run src/interfaces/__tests__/source.test.ts`
Expected: FAIL，找不到 `../source.js`。

- [ ] **Step 3: 实现来源解析**

创建 `backend/src/interfaces/source.ts`：

```ts
import type { ConclusionSource } from '@ai-task-flow/shared';

// 进程指纹：stdio MCP 每个会话一个进程，pid + 启动时间在一次会话内稳定。
const PROCESS_STARTED_AT = Math.floor(Date.now() - process.uptime() * 1000);

export interface McpClientInfo {
  name?: string;
  version?: string;
}

function toolFromEnv(): string | undefined {
  const raw = process.env.AI_AGENT?.trim();
  if (!raw) return undefined;
  return raw.split('_')[0] || undefined;
}

export function resolveMcpSource(
  client: McpClientInfo | undefined,
  conversationName?: string,
): ConclusionSource {
  const tool = toolFromEnv() ?? client?.name?.trim() ?? 'unknown';
  const conversationId = process.env.CLAUDE_CODE_SESSION_ID?.trim()
    || `${tool}:${process.pid}:${PROCESS_STARTED_AT}`;
  return {
    tool,
    conversationId,
    ...(conversationName ? { conversationName } : {}),
    cwd: process.cwd(),
    ...(client?.version ? { agentVersion: client.version } : {}),
  };
}

export function resolveManualSource(): ConclusionSource {
  return { tool: 'manual', cwd: process.cwd() };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && npx vitest run src/interfaces/__tests__/source.test.ts`
Expected: PASS（4 个用例）。

- [ ] **Step 5: 提交**

```bash
git add backend/src/interfaces/source.ts backend/src/interfaces/__tests__/source.test.ts
git commit -m "feat(conclusion): 来源解析——会话 ID/工具/进程指纹

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 6: HTTP API 与装配

**Files:**
- Modify: `backend/src/config/dataDir.ts`
- Create: `backend/src/interfaces/http/routes/conclusionRoutes.ts`
- Modify: `backend/src/interfaces/http/server.ts`
- Modify: `backend/src/http-server.ts`
- Test: `backend/src/interfaces/http/routes/__tests__/conclusionRoutes.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `ConclusionService`、Task 5 的 `resolveManualSource`。
- Produces: `registerConclusionRoutes(fastify, conclusionService)`；`startHttpServer(..., conclusionService)`。

- [ ] **Step 1: 加数据路径**

修改 `backend/src/config/dataDir.ts`，在 worklog 路径函数后追加：

```ts
/** 结论卡数据文件 */
export function conclusionFilePath(dataDir?: string): string {
  return path.join(resolveDataDir(dataDir), 'conclusions.json');
}

/** 结论卡破坏性操作前的快照目录（滚动保留 10 份） */
export function conclusionBackupsDirPath(dataDir?: string): string {
  return path.join(resolveDataDir(dataDir), 'conclusion-backups');
}
```

- [ ] **Step 2: 写失败测试**

创建 `backend/src/interfaces/http/routes/__tests__/conclusionRoutes.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { registerConclusionRoutes } from '../conclusionRoutes.js';
import { ConclusionService } from '../../../../application/conclusion/ConclusionService.js';
import { JsonConclusionRepository } from '../../../../infrastructure/persistence/JsonConclusionRepository.js';

describe('conclusionRoutes', () => {
  let app: ReturnType<typeof Fastify>;
  let tmpDir: string;

  beforeEach(async () => {
    const { nanoid } = await import('nanoid');
    tmpDir = path.join(os.tmpdir(), `conclusion-routes-${nanoid()}`);
    const service = new ConclusionService(
      new JsonConclusionRepository(path.join(tmpDir, 'conclusions.json'), path.join(tmpDir, 'backups')),
    );
    app = Fastify();
    await registerConclusionRoutes(app, service);
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function createCard(over: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/conclusions',
      payload: {
        scope: 'project', project: 'ai-task-flow', title: '全局搜索方案',
        decision: '旧结论', data: '旧数据', ...over,
      },
    });
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.body) as { id: string; rev: number };
  }

  it('should create, list, detail, append, patch and delete', async () => {
    const created = await createCard();
    expect(created.rev).toBe(1);

    const list = await app.inject({ method: 'GET', url: '/api/conclusions' });
    expect(list.statusCode).toBe(200);
    expect(JSON.parse(list.body).conclusions).toHaveLength(1);

    const detail = await app.inject({ method: 'GET', url: `/api/conclusions/${created.id}` });
    expect(detail.statusCode).toBe(200);
    expect(JSON.parse(detail.body).revisions).toHaveLength(1);

    const append = await app.inject({
      method: 'POST', url: `/api/conclusions/${created.id}/revisions`,
      payload: { expectedRev: 1, data: '新数据', changeNote: '补充数据' },
    });
    expect(append.statusCode).toBe(200);
    expect(JSON.parse(append.body).rev).toBe(2);

    const detail2 = await app.inject({ method: 'GET', url: `/api/conclusions/${created.id}` });
    const body2 = JSON.parse(detail2.body);
    expect(body2.revisions[1].decision).toBe('旧结论');
    expect(body2.revisions[1].data).toBe('新数据');
    expect(body2.revisions[1].source.tool).toBe('manual');

    const patch = await app.inject({
      method: 'PATCH', url: `/api/conclusions/${created.id}`,
      payload: { title: '新标题' },
    });
    expect(patch.statusCode).toBe(200);
    expect(JSON.parse(patch.body).title).toBe('新标题');

    const del = await app.inject({ method: 'DELETE', url: `/api/conclusions/${created.id}` });
    expect(del.statusCode).toBe(200);
    expect(JSON.parse(del.body)).toEqual({ deleted: true });
  });

  it('should return 400 when append has no changeNote', async () => {
    const created = await createCard();
    const res = await app.inject({
      method: 'POST', url: `/api/conclusions/${created.id}/revisions`,
      payload: { data: 'x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('should return 409 on stale expectedRev', async () => {
    const created = await createCard();
    await app.inject({
      method: 'POST', url: `/api/conclusions/${created.id}/revisions`,
      payload: { data: 'v2', changeNote: 'v2' },
    });
    const res = await app.inject({
      method: 'POST', url: `/api/conclusions/${created.id}/revisions`,
      payload: { expectedRev: 1, data: 'stale', changeNote: 'stale' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('should filter by keyword across history and expose matchedRev', async () => {
    const created = await createCard({ decision: '旧结论：前端过滤' });
    await app.inject({
      method: 'POST', url: `/api/conclusions/${created.id}/revisions`,
      payload: { decision: '新结论：服务端过滤', changeNote: '改方案' },
    });
    const res = await app.inject({ method: 'GET', url: '/api/conclusions?keyword=前端过滤' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.conclusions).toHaveLength(1);
    expect(body.conclusions[0].matchedRev).toBe(1);
  });

  it('should return 404 for unknown card', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/conclusions/c_none' });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd backend && npx vitest run src/interfaces/http/routes/__tests__/conclusionRoutes.test.ts`
Expected: FAIL，找不到 `../conclusionRoutes.js`。

- [ ] **Step 4: 实现路由**

创建 `backend/src/interfaces/http/routes/conclusionRoutes.ts`：

```ts
import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  ConclusionAppendRequest,
  ConclusionCreateRequest,
  ConclusionPatchRequest,
  ConclusionQueryRequest,
  ProblemScope,
} from '@ai-task-flow/shared';
import type { ConclusionService } from '../../../application/conclusion/ConclusionService.js';
import { DomainError } from '../../../domain/_shared/DomainError.js';
import { resolveManualSource } from '../../source.js';

function statusForError(err: unknown): number {
  if (err instanceof DomainError) return err.httpStatus;
  if ((err as NodeJS.ErrnoException)?.code === 'ELOCKED') return 503;
  return 500;
}

function parseTags(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.split(',').map((tag) => tag.trim()).filter(Boolean);
}

function queryFrom(raw: Record<string, unknown>): ConclusionQueryRequest {
  return {
    cardId: typeof raw.cardId === 'string' ? raw.cardId : undefined,
    scope: raw.scope === 'project' || raw.scope === 'personal'
      ? raw.scope as ProblemScope : undefined,
    project: typeof raw.project === 'string' ? raw.project : undefined,
    version: typeof raw.version === 'string' ? raw.version : undefined,
    keyword: typeof raw.keyword === 'string' ? raw.keyword : undefined,
    tags: parseTags(raw.tags),
    dateFrom: typeof raw.dateFrom === 'string' ? raw.dateFrom : undefined,
    dateTo: typeof raw.dateTo === 'string' ? raw.dateTo : undefined,
    limit: raw.limit ? Number(raw.limit) : undefined,
    includeHistory: raw.includeHistory === 'true' || raw.includeHistory === true,
  };
}

function sendError(reply: FastifyReply, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return reply.status(statusForError(err)).send({ error: message });
}

export async function registerConclusionRoutes(
  fastify: FastifyInstance,
  conclusionService: ConclusionService,
) {
  fastify.get('/api/conclusions', async (request) => {
    const conclusions = await conclusionService.query(queryFrom(request.query as Record<string, unknown>));
    return { conclusions };
  });

  fastify.get<{ Params: { id: string } }>('/api/conclusions/:id', async (request, reply) => {
    try {
      return await conclusionService.get(request.params.id);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.post<{ Body: ConclusionCreateRequest }>('/api/conclusions', async (request, reply) => {
    try {
      const result = await conclusionService.create(request.body, resolveManualSource());
      return reply.status(201).send(result);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  fastify.post<{ Params: { id: string }; Body: ConclusionAppendRequest }>(
    '/api/conclusions/:id/revisions',
    async (request, reply) => {
      try {
        return await conclusionService.append(
          request.params.id,
          request.body,
          resolveManualSource(),
        );
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  fastify.patch<{ Params: { id: string }; Body: ConclusionPatchRequest }>(
    '/api/conclusions/:id',
    async (request, reply) => {
      try {
        return await conclusionService.patch(request.params.id, request.body ?? {});
      } catch (err) {
        return sendError(reply, err);
      }
    },
  );

  fastify.delete<{ Params: { id: string } }>('/api/conclusions/:id', async (request, reply) => {
    try {
      return await conclusionService.delete(request.params.id);
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
```

- [ ] **Step 5: 注册路由并装配**

修改 `backend/src/interfaces/http/server.ts`：
- 顶部 import：`registerConclusionRoutes` 与 `ConclusionService`。
- **`createHttpServer` 与 `startHttpServer` 两个函数**的参数列表末尾都加 `conclusionService: ConclusionService`，并在 `startHttpServer` 内把 `conclusionService` 透传给 `createHttpServer`。
- 在 `registerWorklogRoutes` 后加 `await registerConclusionRoutes(fastify, conclusionService);`。

修改 `backend/src/http-server.ts`：
- import `ConclusionService`、`JsonConclusionRepository`、`conclusionFilePath`、`conclusionBackupsDirPath`。
- 在 worklogService 构造后加：

```ts
const conclusionService = new ConclusionService(
  new JsonConclusionRepository(
    conclusionFilePath(options.dataDir),
    conclusionBackupsDirPath(options.dataDir),
  ),
);
```

- 调用 `startHttpServer(...)` 时把 `conclusionService` 作为最后一个参数传入。

- [ ] **Step 6: 运行路由测试**

Run: `cd backend && npx vitest run src/interfaces/http/routes/__tests__/conclusionRoutes.test.ts`
Expected: PASS（5 个用例）。

- [ ] **Step 7: 类型检查**

Run: `cd backend && npx tsc --noEmit`
Expected: 0 error。

- [ ] **Step 8: 提交**

```bash
git add backend/src/config/dataDir.ts backend/src/interfaces/http backend/src/http-server.ts
git commit -m "feat(conclusion): HTTP API 六端点与后端装配

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 7: MCP 工具与注册

**Files:**
- Create: `backend/src/interfaces/mcp/tools/conclusion/_shared.ts`
- Create: `backend/src/interfaces/mcp/tools/conclusion/record-conclusion.ts`
- Create: `backend/src/interfaces/mcp/tools/conclusion/query-conclusions.ts`
- Modify: `backend/src/interfaces/mcp/tools/types.ts`
- Modify: `backend/src/interfaces/mcp/tools/index.ts`
- Modify: `backend/src/interfaces/mcp/server.ts`
- Test: `backend/src/interfaces/mcp/tools/conclusion/__tests__/conclusion-tools.test.ts`

**Interfaces:**
- Consumes: Task 4 服务、Task 5 `resolveMcpSource`、Task 1 catalog。
- Produces: MCP 工具 `record_conclusion`、`query_conclusions`；`ToolDeps` 新增 `conclusionService`、`mcpSource`。

- [ ] **Step 1: 写失败测试**

创建 `backend/src/interfaces/mcp/tools/conclusion/__tests__/conclusion-tools.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ConclusionService } from '../../../../../application/conclusion/ConclusionService.js';
import { JsonConclusionRepository } from '../../../../../infrastructure/persistence/JsonConclusionRepository.js';
import { handle as record } from '../record-conclusion.js';
import { handle as query } from '../query-conclusions.js';
import type { ToolDeps } from '../../types.js';

describe('conclusion MCP tools', () => {
  let tmpDir: string;
  let deps: ToolDeps;

  beforeEach(async () => {
    const { nanoid } = await import('nanoid');
    tmpDir = path.join(os.tmpdir(), `conclusion-mcp-${nanoid()}`);
    const service = new ConclusionService(
      new JsonConclusionRepository(path.join(tmpDir, 'conclusions.json'), path.join(tmpDir, 'backups')),
    );
    deps = {
      knowledgeService: undefined as never,
      worklogService: undefined as never,
      conclusionService: service,
      mcpSource: {
        tool: 'claude-code',
        conversationId: 'sess-1',
        cwd: '/repo',
      },
    };
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should create then read full latest through query cardId mode', async () => {
    const created = await record({
      scope: 'project', project: 'ai-task-flow', title: '全局搜索',
      decision: '旧结论', data: '旧数据', conversationName: '话题A',
    }, deps);
    expect(created.isError).toBeFalsy();
    const id = (created.content[0].text.match(/c_[a-z0-9]+/) ?? [])[0];
    expect(id).toBeTruthy();

    const detail = await query({ cardId: id }, deps);
    expect(detail.isError).toBeFalsy();
    expect(detail.content[0].text).toContain('旧结论');
    expect(detail.content[0].text).toContain('旧数据');
    expect(detail.content[0].text).toContain('话题A');
  });

  it('should append with inherited fields and reject missing changeNote', async () => {
    const created = await record({
      scope: 'project', project: 'p', title: 't', decision: 'd', data: 'd1',
    }, deps);
    const id = (created.content[0].text.match(/c_[a-z0-9]+/) ?? [])[0];

    const appended = await record({
      cardId: id, expectedRev: 1, data: 'd2', changeNote: '补数据',
    }, deps);
    expect(appended.isError).toBeFalsy();
    expect(appended.content[0].text).toContain('rev 2');

    const bad = await record({ cardId: id, data: 'd3' }, deps);
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain('变更说明');
  });

  it('should search and return matchedRev for history hits', async () => {
    const created = await record({
      scope: 'project', project: 'p', title: 't', decision: '旧结论：前端',
    }, deps);
    const id = (created.content[0].text.match(/c_[a-z0-9]+/) ?? [])[0];
    await record({ cardId: id, decision: '新结论：服务端', changeNote: '改方案' }, deps);

    const res = await query({ keyword: '前端' }, deps);
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain('命中 rev 1');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && npx vitest run src/interfaces/mcp/tools/conclusion`
Expected: FAIL，找不到工具文件。

- [ ] **Step 3: 扩展 ToolDeps**

修改 `backend/src/interfaces/mcp/tools/types.ts`：

```ts
import type { KnowledgeService } from '../../../application/knowledge/KnowledgeService.js';
import type { WorklogService } from '../../../application/worklog/WorklogService.js';
import type { ConclusionService } from '../../../application/conclusion/ConclusionService.js';
import type { ConclusionSource } from '@ai-task-flow/shared';

export interface ToolDeps {
  knowledgeService: KnowledgeService;
  worklogService: WorklogService;
  conclusionService: ConclusionService;
  /** 每次工具调用的宿主来源（MCP 进程环境 + clientInfo） */
  mcpSource: ConclusionSource;
}
```

- [ ] **Step 4: 写结论工具共享与元数据**

创建 `backend/src/interfaces/mcp/tools/conclusion/_shared.ts`：

```ts
import { CONCLUSION_TOOL_CATALOG, type ConclusionToolMeta } from '@ai-task-flow/shared';

export const CATALOG_BY_NAME: Record<string, ConclusionToolMeta> = Object.fromEntries(
  CONCLUSION_TOOL_CATALOG.map((meta) => [meta.name, meta]),
);

export const CATALOG = {
  record_conclusion: CATALOG_BY_NAME.record_conclusion,
  query_conclusions: CATALOG_BY_NAME.query_conclusions,
} as const;

export type McpTextResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

export function ok(text: string): McpTextResult {
  return { content: [{ type: 'text', text }] };
}

export function fail(err: unknown): McpTextResult {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text', text: `❌ ${message}` }], isError: true };
}
```

- [ ] **Step 5: 实现 `record_conclusion`**

创建 `backend/src/interfaces/mcp/tools/conclusion/record-conclusion.ts`：

```ts
import type {
  ConclusionAppendRequest,
  ConclusionCodeRef,
  ConclusionCreateRequest,
  ConclusionSource,
  ProblemScope,
} from '@ai-task-flow/shared';
import type { ToolDeps } from '../types.js';
import { CATALOG, ok, fail } from './_shared.js';

export const toolDef = {
  name: CATALOG.record_conclusion.name,
  description: CATALOG.record_conclusion.description,
  inputSchema: {
    type: 'object' as const,
    properties: {
      cardId: { type: 'string' as const, description: '已有结论卡 id（c_xxx）；传入=追加新版，不传=新建' },
      expectedRev: { type: 'number' as const, description: '追加时建议传：读取到的当前版本号，不一致返回冲突' },
      scope: { type: 'string' as const, enum: ['project', 'personal'], description: '项目问题还是个人问题' },
      project: { type: 'string' as const, description: '项目名（scope=project 必填）' },
      version: { type: 'string' as const, description: '版本名（可选，仅项目问题）' },
      title: { type: 'string' as const, description: '结论卡主题（新建必填；追加时可选更新）' },
      tags: { type: 'array' as const, items: { type: 'string' as const }, description: '标签，可选' },
      decision: { type: 'string' as const, description: '结论/决策 + 理由（Markdown）；新建必填，追加省略=沿用' },
      data: { type: 'string' as const, description: '关键数据/命令结果；追加省略=沿用，传空串=清空' },
      openItems: { type: 'string' as const, description: '待办/未决问题；追加省略=沿用，传空串=清空' },
      codeRefs: {
        type: 'array' as const,
        description: '代码/文件位置；追加省略=沿用，传空数组=清空',
        items: {
          type: 'object' as const,
          properties: {
            path: { type: 'string' as const, description: '相对仓库根路径' },
            startLine: { type: 'number' as const },
            endLine: { type: 'number' as const },
            note: { type: 'string' as const },
          },
          required: ['path'],
        },
      },
      date: { type: 'string' as const, description: '本版业务日期 YYYY-MM-DD，默认当天' },
      changeNote: { type: 'string' as const, description: '本版为什么更新（追加必填）' },
      conversationName: { type: 'string' as const, description: '对话名称，如「worklog 全局搜索方案」' },
    },
  },
};

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export async function handle(args: Record<string, unknown> | undefined, deps: ToolDeps) {
  args ??= {};
  try {
    const source: ConclusionSource = {
      ...deps.mcpSource,
      ...(text(args.conversationName) ? { conversationName: text(args.conversationName) } : {}),
    };
    const scope: ProblemScope | undefined = args.scope === 'personal' || args.scope === 'project'
      ? args.scope
      : undefined;

    if (typeof args.cardId === 'string' && args.cardId) {
      const append: ConclusionAppendRequest = {
        expectedRev: num(args.expectedRev),
        scope,
        project: text(args.project),
        version: text(args.version),
        title: text(args.title),
        tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
        decision: text(args.decision),
        data: text(args.data),
        openItems: text(args.openItems),
        codeRefs: Array.isArray(args.codeRefs) ? args.codeRefs as ConclusionCodeRef[] : undefined,
        date: text(args.date),
        changeNote: text(args.changeNote) ?? '',
        conversationName: text(args.conversationName),
      };
      const result = await deps.conclusionService.append(args.cardId, append, source);
      return ok([
        `✅ 已追加到 ${result.id} → rev ${result.rev}`,
        ...(append.changeNote ? [`变更说明：${append.changeNote}`] : []),
      ].join('\n'));
    }

    const inferredScope: ProblemScope = scope ?? (args.project ? 'project' : 'personal');
    const create: ConclusionCreateRequest = {
      scope: inferredScope,
      project: text(args.project),
      version: text(args.version),
      title: text(args.title) ?? '',
      tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
      decision: text(args.decision) ?? '',
      data: text(args.data),
      openItems: text(args.openItems),
      codeRefs: Array.isArray(args.codeRefs) ? args.codeRefs as ConclusionCodeRef[] : undefined,
      date: text(args.date),
      changeNote: text(args.changeNote),
      conversationName: text(args.conversationName),
    };
    const result = await deps.conclusionService.create(create, source);
    return ok([
      `✅ 已创建结论卡 ${result.id}（${create.project ?? '个人'} · rev ${result.rev}）`,
      `后续更新请带 cardId=${result.id}`,
    ].join('\n'));
  } catch (err) {
    return fail(err);
  }
}
```

- [ ] **Step 6: 实现 `query_conclusions`**

创建 `backend/src/interfaces/mcp/tools/conclusion/query-conclusions.ts`：

```ts
import type { ConclusionDetail, ConclusionQueryRequest, ProblemScope } from '@ai-task-flow/shared';
import type { ToolDeps } from '../types.js';
import { CATALOG, ok, fail } from './_shared.js';

export const toolDef = {
  name: CATALOG.query_conclusions.name,
  description: CATALOG.query_conclusions.description,
  inputSchema: {
    type: 'object' as const,
    properties: {
      cardId: { type: 'string' as const, description: '传 cardId = 读取该卡最新版完整内容与演进摘要' },
      scope: { type: 'string' as const, enum: ['project', 'personal'], description: '按问题域过滤' },
      project: { type: 'string' as const, description: '按项目精确过滤' },
      version: { type: 'string' as const, description: '按版本精确过滤' },
      keyword: { type: 'string' as const, description: '匹配标题 + 全部历史版本的结论/数据/待办/变更说明/文件路径' },
      tags: { type: 'array' as const, items: { type: 'string' as const }, description: '标签任一命中' },
      dateFrom: { type: 'string' as const, description: '起始日期 YYYY-MM-DD（按最新版日期）' },
      dateTo: { type: 'string' as const, description: '结束日期 YYYY-MM-DD' },
      limit: { type: 'number' as const, description: '返回条数上限，默认 20' },
      includeHistory: { type: 'boolean' as const, description: 'cardId 模式下是否返回全部历史全文，默认 false' },
    },
  },
};

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function formatDetail(detail: ConclusionDetail): string {
  const latest = detail.latest;
  const lines = [
    `### ${detail.title}（rev ${detail.rev}）`,
    [
      detail.project ?? '个人',
      detail.version,
      latest.date,
      latest.source.tool,
      latest.source.conversationName,
    ].filter(Boolean).join(' · '),
    '',
    '## 结论/决策',
    latest.decision,
  ];
  if (latest.data) lines.push('', '## 关键数据', latest.data);
  if (latest.openItems) lines.push('', '## 待办/未决', latest.openItems);
  if (latest.codeRefs?.length) {
    lines.push('', '## 代码/文件位置',
      ...latest.codeRefs.map((ref) => `- ${ref.path}${ref.startLine ? `:${ref.startLine}${ref.endLine ? `-${ref.endLine}` : ''}` : ''}${ref.note ? ` — ${ref.note}` : ''}`));
  }
  lines.push('', '## 演进');
  for (const revision of [...detail.revisions].reverse()) {
    lines.push(`- rev ${revision.rev} · ${revision.date} · ${revision.tool}${revision.conversationName ? ` · ${revision.conversationName}` : ''}${revision.changeNote ? ` — ${revision.changeNote}` : ''}`);
  }
  if (detail.history?.length) {
    lines.push('', '## 历史全文');
    for (const revision of [...detail.history].reverse()) {
      lines.push(
        `### rev ${revision.rev} · ${revision.date} · ${revision.source.tool}` +
        `${revision.changeNote ? ` — ${revision.changeNote}` : ''}`,
        '',
        revision.decision,
      );
      if (revision.data) lines.push('', '数据：', revision.data);
      if (revision.openItems) lines.push('', '待办：', revision.openItems);
    }
  }
  return lines.join('\n');
}

export async function handle(args: Record<string, unknown> | undefined, deps: ToolDeps) {
  args ??= {};
  try {
    if (typeof args.cardId === 'string' && args.cardId) {
      const detail = await deps.conclusionService.getDetail(args.cardId, args.includeHistory === true);
      return ok(formatDetail(detail));
    }

    const input: ConclusionQueryRequest = {
      scope: args.scope === 'project' || args.scope === 'personal'
        ? args.scope as ProblemScope : undefined,
      project: text(args.project),
      version: text(args.version),
      keyword: text(args.keyword),
      tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
      dateFrom: text(args.dateFrom),
      dateTo: text(args.dateTo),
      limit: typeof args.limit === 'number' ? args.limit : 20,
    };
    const summaries = await deps.conclusionService.query(input);
    if (summaries.length === 0) return ok('未找到匹配的结论卡。');

    return ok(`共 ${summaries.length} 张：\n\n${summaries.map((card) => [
      `### ${card.title}（${card.id} · rev ${card.rev}）`,
      [
        card.project ?? '个人',
        card.version,
        card.latestDate,
        card.source.tool,
        card.source.conversationName,
      ].filter(Boolean).join(' · '),
      card.matchedRev ? `命中历史版本：rev ${card.matchedRev}` : '',
      '',
      card.latestDecisionExcerpt,
    ].filter(Boolean).join('\n')).join('\n\n---\n\n')}`);
  } catch (err) {
    return fail(err);
  }
}
```

- [ ] **Step 7: 注册工具**

修改 `backend/src/interfaces/mcp/tools/index.ts`：
- import 两个新 `toolDef` / `handle`。
- `ALL_TOOLS` 在 `knowledgeDef` 前加入 `recordConclusionDef, queryConclusionsDef`。
- `HANDLERS` 加 `record_conclusion: recordConclusionHandler, query_conclusions: queryConclusionsHandler`。

修改 `backend/src/interfaces/mcp/server.ts`：
- import `ConclusionService`、`JsonConclusionRepository`、`conclusionFilePath`、`conclusionBackupsDirPath`、`resolveMcpSource`。
- 字段 `private conclusionService: ConclusionService;`
- 构造中装配：
```ts
this.conclusionService = new ConclusionService(
  new JsonConclusionRepository(conclusionFilePath(), conclusionBackupsDirPath()),
);
```
- 工具调用处理器传入：
```ts
return handler(args, {
  knowledgeService: this.knowledgeService,
  worklogService: this.worklogService,
  conclusionService: this.conclusionService,
  mcpSource: resolveMcpSource(this.server.getClientVersion()),
});
```
- 顶部注释工具数 10 → 12，并补两个工具名。

- [ ] **Step 8: 更新现有 MCP 测试夹具并运行**

`ToolDeps` 新增了两个必填字段，需同步修改 `backend/src/interfaces/mcp/tools/worklog/__tests__/worklog-tools.test.ts`：

```ts
deps = {
  knowledgeService: {} as ToolDeps['knowledgeService'],
  worklogService: new WorklogService(
    new JsonWorklogRepository(path.join(tmpDir, 'worklog.json'), path.join(tmpDir, 'backups')),
  ),
  conclusionService: {} as ToolDeps['conclusionService'],
  mcpSource: { tool: 'manual' },
};
```

同时把该文件里的工具数量断言从 10 改为 12：

```ts
expect(registered.size).toBe(12); // 9 worklog + 2 conclusion + save_to_knowledge
```

Run: `cd backend && npx vitest run src/interfaces/mcp/tools/conclusion src/interfaces/mcp/tools/worklog`
Expected: PASS（结论 3 个用例 + worklog 原有用例）。

- [ ] **Step 9: 全后端类型检查 + 相关测试**

Run:
```bash
cd backend && npx tsc --noEmit && npx vitest run src/domain/conclusion src/application/conclusion src/interfaces
```
Expected: 全部 PASS。

- [ ] **Step 10: 提交**

```bash
git add backend/src/interfaces/mcp
git commit -m "feat(conclusion): MCP 双工具——读当前进度/定位/追加

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 8: 前端独立视图

**Files:**
- Create: `frontend/src/api/conclusion.ts`
- Create: `frontend/src/components/conclusion/searchFilter.ts`
- Create: `frontend/src/components/conclusion/ConclusionProjectList.tsx`
- Create: `frontend/src/components/conclusion/ConclusionCardItem.tsx`
- Create: `frontend/src/components/conclusion/ConclusionForm.tsx`
- Create: `frontend/src/components/conclusion/ConclusionMetaForm.tsx`
- Create: `frontend/src/components/conclusion/RevisionTimeline.tsx`
- Create: `frontend/src/components/conclusion/ConclusionView.tsx`
- Create: `frontend/src/components/views/ConclusionView.tsx`
- Modify: `frontend/src/components/SidebarNav.tsx`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/components/conclusion/__tests__/searchFilter.test.ts`
- Test: `frontend/src/components/conclusion/__tests__/conclusionComponents.test.tsx`

**Interfaces:**
- Consumes: 共享类型、`http`。
- Produces: 视图 `ConclusionView`；侧边栏 `ViewKey` 新增 `'conclusion'`。

- [ ] **Step 1: 写纯函数测试**

创建 `frontend/src/components/conclusion/__tests__/searchFilter.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import type { ConclusionSummary } from '@ai-task-flow/shared';
import { filterConclusions, groupConclusions } from '../searchFilter';

function card(over: Partial<ConclusionSummary>): ConclusionSummary {
  return {
    id: 'c_1', scope: 'project', project: 'p', title: 't', rev: 1,
    latestDate: '2026-11-18', latestDecisionExcerpt: 'd',
    source: { tool: 'manual' }, createdAt: 1, updatedAt: 1, ...over,
  };
}

const cards: ConclusionSummary[] = [
  card({ id: 'c_a', project: 'ai-task-flow', latestDate: '2026-11-18', updatedAt: 9 }),
  card({ id: 'c_b', project: 'ai-task-flow', latestDate: '2026-11-17', updatedAt: 1 }),
  card({ id: 'c_c', project: 'rpp', latestDate: '2026-11-16', updatedAt: 2 }),
  card({ id: 'c_d', scope: 'personal', project: undefined, latestDate: '2026-11-15', updatedAt: 3 }),
];

describe('groupConclusions', () => {
  it('should group by project and personal, newest first', () => {
    const grouped = groupConclusions(cards);
    expect(grouped.projects.map((p) => p.name)).toEqual(['ai-task-flow', 'rpp']);
    expect(grouped.projects[0].cards.map((c) => c.id)).toEqual(['c_a', 'c_b']);
    expect(grouped.personal.map((c) => c.id)).toEqual(['c_d']);
  });
});

describe('filterConclusions', () => {
  it('should filter by project and personal', () => {
    expect(filterConclusions(cards, { type: 'project', project: 'rpp' }).map((c) => c.id))
      .toEqual(['c_c']);
    expect(filterConclusions(cards, { type: 'personal' }).map((c) => c.id))
      .toEqual(['c_d']);
    expect(filterConclusions(cards, { type: 'all' })).toHaveLength(4);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/components/conclusion/__tests__/searchFilter.test.ts`
Expected: FAIL，找不到 `../searchFilter`。

- [ ] **Step 3: 实现纯函数**

创建 `frontend/src/components/conclusion/searchFilter.ts`：

```ts
import type { ConclusionSummary } from '@ai-task-flow/shared';

export type ConclusionSelection =
  | { type: 'all' }
  | { type: 'project'; project: string }
  | { type: 'personal' };

function newestFirst(a: ConclusionSummary, b: ConclusionSummary): number {
  return b.latestDate.localeCompare(a.latestDate) || b.updatedAt - a.updatedAt;
}

export function groupConclusions(cards: ConclusionSummary[]): {
  projects: Array<{ name: string; cards: ConclusionSummary[] }>;
  personal: ConclusionSummary[];
} {
  const projects = new Map<string, ConclusionSummary[]>();
  const personal: ConclusionSummary[] = [];

  for (const card of cards) {
    if (card.scope === 'personal') {
      personal.push(card);
      continue;
    }
    const name = card.project ?? '未归类';
    const list = projects.get(name) ?? [];
    list.push(card);
    projects.set(name, list);
  }

  return {
    projects: [...projects.entries()]
      .map(([name, list]) => ({ name, cards: [...list].sort(newestFirst) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    personal: [...personal].sort(newestFirst),
  };
}

export function filterConclusions(
  cards: ConclusionSummary[],
  selection: ConclusionSelection,
): ConclusionSummary[] {
  const filtered = cards.filter((card) => {
    if (selection.type === 'all') return true;
    if (selection.type === 'personal') return card.scope === 'personal';
    return card.scope === 'project' && card.project === selection.project;
  });
  return [...filtered].sort(newestFirst);
}
```

- [ ] **Step 4: 写 API 客户端**

创建 `frontend/src/api/conclusion.ts`：

```ts
import type {
  Conclusion,
  ConclusionAppendRequest,
  ConclusionAppendResponse,
  ConclusionCreateRequest,
  ConclusionCreateResponse,
  ConclusionPatchRequest,
  ConclusionQueryRequest,
  ConclusionSummary,
} from '@ai-task-flow/shared';
import { http } from './http';

function queryString(input: ConclusionQueryRequest): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export const conclusionApi = {
  list: (input: ConclusionQueryRequest = {}) =>
    http.get<{ conclusions: ConclusionSummary[] }>(`/conclusions${queryString(input)}`, true),

  get: (id: string) => http.get<Conclusion>(`/conclusions/${id}`, true),

  create: (input: ConclusionCreateRequest) =>
    http.post<ConclusionCreateResponse>('/conclusions', input, true),

  append: (id: string, input: ConclusionAppendRequest) =>
    http.post<ConclusionAppendResponse>(`/conclusions/${id}/revisions`, input, true),

  patch: (id: string, input: ConclusionPatchRequest) =>
    http.patch<Conclusion>(`/conclusions/${id}`, input, true),

  remove: (id: string) => http.delete<{ deleted: boolean }>(`/conclusions/${id}`, true),
};
```

- [ ] **Step 5: 实现左栏分组**

创建 `frontend/src/components/conclusion/ConclusionProjectList.tsx`：

```tsx
import type { ConclusionSummary } from '@ai-task-flow/shared';
import { Folder, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { groupConclusions, type ConclusionSelection } from './searchFilter';

interface Props {
  cards: ConclusionSummary[];
  selection: ConclusionSelection;
  onSelect: (selection: ConclusionSelection) => void;
}

export function ConclusionProjectList({ cards, selection, onSelect }: Props) {
  const grouped = groupConclusions(cards);
  const isActive = (target: ConclusionSelection) => {
    if (target.type !== selection.type) return false;
    if (target.type === 'project' && selection.type === 'project') {
      return target.project === selection.project;
    }
    return true;
  };

  return (
    <div className="space-y-1">
      <Button
        variant={isActive({ type: 'all' }) ? 'secondary' : 'ghost'}
        size="sm"
        className="w-full justify-start gap-2"
        onClick={() => onSelect({ type: 'all' })}
      >
        全部
        <span className="text-muted-foreground ml-auto text-xs">{cards.length}</span>
      </Button>

      {grouped.projects.map((project) => (
        <Button
          key={project.name}
          variant={isActive({ type: 'project', project: project.name }) ? 'secondary' : 'ghost'}
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => onSelect({ type: 'project', project: project.name })}
        >
          <Folder className="size-3.5 shrink-0" />
          <span className="truncate">{project.name}</span>
          <span className="text-muted-foreground ml-auto text-xs">{project.cards.length}</span>
        </Button>
      ))}

      {grouped.personal.length > 0 && (
        <Button
          variant={isActive({ type: 'personal' }) ? 'secondary' : 'ghost'}
          size="sm"
          className={cn('w-full justify-start gap-2')}
          onClick={() => onSelect({ type: 'personal' })}
        >
          <User className="size-3.5 shrink-0" />
          个人
          <span className="text-muted-foreground ml-auto text-xs">{grouped.personal.length}</span>
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 6: 实现演进时间线**

创建 `frontend/src/components/conclusion/RevisionTimeline.tsx`：

```tsx
import type { ConclusionRevision } from '@ai-task-flow/shared';

interface Props {
  revisions: ConclusionRevision[];
}

export function RevisionTimeline({ revisions }: Props) {
  const newestFirst = [...revisions].sort((a, b) => b.rev - a.rev);

  return (
    <ol className="mt-3 space-y-3 border-l pl-4">
      {newestFirst.map((revision) => (
        <li key={revision.rev} className="relative">
          <span className="bg-background absolute top-1.5 -left-[1.28rem] size-2 rounded-full border" />
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
            <span className="text-foreground font-medium">rev {revision.rev}</span>
            <span>{revision.date}</span>
            <span>{revision.source.tool}</span>
            {revision.source.conversationName && <span>· {revision.source.conversationName}</span>}
          </div>
          {revision.changeNote && (
            <p className="mt-1 text-xs">变更：{revision.changeNote}</p>
          )}
          <details className="mt-1">
            <summary className="text-muted-foreground cursor-pointer text-xs">查看本版全文</summary>
            <div className="mt-2 space-y-2 text-sm">
              <section>
                <h4 className="text-xs font-semibold">结论/决策</h4>
                <p className="whitespace-pre-wrap">{revision.decision}</p>
              </section>
              {revision.data && (
                <section>
                  <h4 className="text-xs font-semibold">关键数据</h4>
                  <p className="whitespace-pre-wrap">{revision.data}</p>
                </section>
              )}
              {revision.openItems && (
                <section>
                  <h4 className="text-xs font-semibold">待办/未决</h4>
                  <p className="whitespace-pre-wrap">{revision.openItems}</p>
                </section>
              )}
              {revision.codeRefs?.length ? (
                <section>
                  <h4 className="text-xs font-semibold">代码/文件位置</h4>
                  <ul className="font-mono text-xs">
                    {revision.codeRefs.map((ref, index) => (
                      <li key={`${ref.path}:${ref.startLine ?? ''}:${index}`}>
                        {ref.path}
                        {ref.startLine ? `:${ref.startLine}${ref.endLine ? `-${ref.endLine}` : ''}` : ''}
                        {ref.note ? ` — ${ref.note}` : ''}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          </details>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 7: 实现卡片**

创建 `frontend/src/components/conclusion/ConclusionCardItem.tsx`：

```tsx
import type { Conclusion, ConclusionSummary } from '@ai-task-flow/shared';
import { ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RevisionTimeline } from './RevisionTimeline';

interface Props {
  summary: ConclusionSummary;
  expanded: boolean;
  detail?: Conclusion;
  onToggle: () => void;
  onEdit: () => void;
  onPatch: () => void;
  onDelete: () => void;
}

export function ConclusionCardItem({ summary, expanded, detail, onToggle, onEdit, onPatch, onDelete }: Props) {
  const latest = detail?.revisions[detail.revisions.length - 1];

  return (
    <article className="bg-card rounded-lg border p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{summary.title}</h3>
            <span className="text-muted-foreground text-xs">rev {summary.rev}</span>
            {summary.matchedRev && (
              <Badge variant="secondary" className="text-[10px]">命中 rev {summary.matchedRev}</Badge>
            )}
          </div>
          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span>{summary.project ?? '个人'}</span>
            {summary.version && <span>{summary.version}</span>}
            <span>{summary.latestDate}</span>
            <span>{summary.source.tool}</span>
            {summary.source.conversationName && <span>· {summary.source.conversationName}</span>}
            {summary.tags?.map((tag) => <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>)}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onToggle} title="展开/收起">
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          <span className="ml-1 text-xs">演进 ({summary.rev})</span>
        </Button>
      </div>

      {!expanded && (
        <p className="text-muted-foreground mt-3 line-clamp-3 text-sm whitespace-pre-wrap">
          {summary.latestDecisionExcerpt}
        </p>
      )}

      {expanded && latest && (
        <div className="mt-4 space-y-3 text-sm">
          <section>
            <h4 className="text-xs font-semibold">结论/决策</h4>
            <p className="mt-1 whitespace-pre-wrap">{latest.decision}</p>
          </section>
          {latest.data && (
            <section>
              <h4 className="text-xs font-semibold">关键数据</h4>
              <p className="mt-1 whitespace-pre-wrap">{latest.data}</p>
            </section>
          )}
          {latest.openItems && (
            <section>
              <h4 className="text-xs font-semibold">待办/未决</h4>
              <p className="mt-1 whitespace-pre-wrap">{latest.openItems}</p>
            </section>
          )}
          {latest.codeRefs?.length ? (
            <section>
              <h4 className="text-xs font-semibold">代码/文件位置</h4>
              <ul className="mt-1 font-mono text-xs">
                {latest.codeRefs.map((ref, index) => (
                  <li key={`${ref.path}:${ref.startLine ?? ''}:${index}`}>
                    {ref.path}
                    {ref.startLine ? `:${ref.startLine}${ref.endLine ? `-${ref.endLine}` : ''}` : ''}
                    {ref.note ? ` — ${ref.note}` : ''}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <RevisionTimeline revisions={detail.revisions} />
          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="mr-1 size-3.5" />编辑（追加新版）
            </Button>
            <Button variant="outline" size="sm" onClick={onPatch}>
              改信息
            </Button>
            <Button variant="ghost" size="sm" onClick={onDelete}>
              <Trash2 className="mr-1 size-3.5" />删除
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}
```

- [ ] **Step 8: 实现表单**

创建 `frontend/src/components/conclusion/ConclusionForm.tsx`：

```tsx
import { useState } from 'react';
import type { Conclusion, ConclusionCodeRef } from '@ai-task-flow/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export interface ConclusionFormValue {
  scope: 'project' | 'personal';
  project?: string;
  version?: string;
  title: string;
  tags?: string[];
  decision: string;
  data?: string;
  openItems?: string;
  codeRefs?: ConclusionCodeRef[];
  changeNote?: string;
  expectedRev?: number;
}

interface Props {
  mode: 'create' | 'append';
  initial?: Conclusion;
  projects: string[];
  onSubmit: (value: ConclusionFormValue) => Promise<void>;
  onCancel: () => void;
}

function parseCodeRefs(text: string): ConclusionCodeRef[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [pathPart, note] = line.split('#').map((part) => part.trim());
    const match = pathPart.match(/^(.+?)(?::(\d+)(?:-(\d+))?)?$/);
    if (!match) return { path: line };
    return {
      path: match[1],
      ...(match[2] ? { startLine: Number(match[2]) } : {}),
      ...(match[3] ? { endLine: Number(match[3]) } : {}),
      ...(note ? { note } : {}),
    };
  });
}

function formatCodeRefs(refs?: ConclusionCodeRef[]): string {
  return (refs ?? []).map((ref) => {
    const range = ref.startLine ? `:${ref.startLine}${ref.endLine ? `-${ref.endLine}` : ''}` : '';
    return `${ref.path}${range}${ref.note ? ` # ${ref.note}` : ''}`;
  }).join('\n');
}

export function ConclusionForm({ mode, initial, projects, onSubmit, onCancel }: Props) {
  const latest = initial?.revisions[initial.revisions.length - 1];
  const [scope, setScope] = useState<'project' | 'personal'>(initial?.scope ?? 'project');
  const [project, setProject] = useState(initial?.project ?? '');
  const [version, setVersion] = useState(initial?.version ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '));
  const [decision, setDecision] = useState(latest?.decision ?? '');
  const [data, setData] = useState(latest?.data ?? '');
  const [openItems, setOpenItems] = useState(latest?.openItems ?? '');
  const [codeRefs, setCodeRefs] = useState(formatCodeRefs(latest?.codeRefs));
  const [changeNote, setChangeNote] = useState(mode === 'append' ? '人工修订' : '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await onSubmit({
        scope,
        project: scope === 'project' ? project.trim() : undefined,
        version: scope === 'project' ? version.trim() || undefined : undefined,
        title: title.trim(),
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        decision,
        data,
        openItems,
        codeRefs: parseCodeRefs(codeRefs),
        changeNote: changeNote.trim() || undefined,
        expectedRev: latest?.rev,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-card space-y-3 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <Button
          type="button" size="sm"
          variant={scope === 'project' ? 'secondary' : 'ghost'}
          onClick={() => setScope('project')}
        >项目问题</Button>
        <Button
          type="button" size="sm"
          variant={scope === 'personal' ? 'secondary' : 'ghost'}
          onClick={() => setScope('personal')}
        >个人问题</Button>
      </div>

      {scope === 'project' && (
        <div className="grid grid-cols-2 gap-2">
          <Input list="conclusion-projects" placeholder="项目名" value={project} onChange={(e) => setProject(e.target.value)} />
          <datalist id="conclusion-projects">
            {projects.map((name) => <option key={name} value={name} />)}
          </datalist>
          <Input placeholder="版本（可选）" value={version} onChange={(e) => setVersion(e.target.value)} />
        </div>
      )}

      <Input placeholder="标题" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Input placeholder="标签（逗号分隔）" value={tags} onChange={(e) => setTags(e.target.value)} />

      <label className="block text-xs font-semibold">结论/决策 + 理由（必填）</label>
      <Textarea rows={4} value={decision} onChange={(e) => setDecision(e.target.value)} />

      <label className="block text-xs font-semibold">关键数据/命令结果</label>
      <Textarea rows={3} value={data} onChange={(e) => setData(e.target.value)} />

      <label className="block text-xs font-semibold">待办/未决问题</label>
      <Textarea rows={2} value={openItems} onChange={(e) => setOpenItems(e.target.value)} />

      <label className="block text-xs font-semibold">代码/文件位置（每行 `路径:起始行-结束行 # 说明`）</label>
      <Textarea rows={2} className="font-mono text-xs" value={codeRefs} onChange={(e) => setCodeRefs(e.target.value)} />

      <Input
        placeholder={mode === 'append' ? '变更说明（必填）' : '变更说明（可选）'}
        value={changeNote}
        onChange={(e) => setChangeNote(e.target.value)}
      />

      <div className="flex gap-2">
        <Button size="sm" disabled={saving} onClick={() => void handleSubmit()}>
          {saving ? '保存中…' : mode === 'append' ? '追加新版' : '创建'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>取消</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: 实现改信息表单**

创建 `frontend/src/components/conclusion/ConclusionMetaForm.tsx`：

```tsx
import { useState } from 'react';
import type { Conclusion } from '@ai-task-flow/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface ConclusionMetaValue {
  scope: 'project' | 'personal';
  project?: string;
  version?: string;
  title: string;
  tags?: string[];
}

interface Props {
  initial: Conclusion;
  projects: string[];
  onSubmit: (value: ConclusionMetaValue) => Promise<void>;
  onCancel: () => void;
}

export function ConclusionMetaForm({ initial, projects, onSubmit, onCancel }: Props) {
  const [scope, setScope] = useState<'project' | 'personal'>(initial.scope);
  const [project, setProject] = useState(initial.project ?? '');
  const [version, setVersion] = useState(initial.version ?? '');
  const [title, setTitle] = useState(initial.title);
  const [tags, setTags] = useState((initial.tags ?? []).join(', '));
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await onSubmit({
        scope,
        project: scope === 'project' ? project.trim() : undefined,
        version: scope === 'project' ? version.trim() || undefined : undefined,
        title: title.trim(),
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-card space-y-3 rounded-lg border p-4">
      <div className="flex gap-2">
        <Button size="sm" variant={scope === 'project' ? 'secondary' : 'ghost'} onClick={() => setScope('project')}>项目问题</Button>
        <Button size="sm" variant={scope === 'personal' ? 'secondary' : 'ghost'} onClick={() => setScope('personal')}>个人问题</Button>
      </div>
      {scope === 'project' && (
        <div className="grid grid-cols-2 gap-2">
          <Input list="conclusion-meta-projects" placeholder="项目名" value={project} onChange={(e) => setProject(e.target.value)} />
          <datalist id="conclusion-meta-projects">
            {projects.map((name) => <option key={name} value={name} />)}
          </datalist>
          <Input placeholder="版本（可选）" value={version} onChange={(e) => setVersion(e.target.value)} />
        </div>
      )}
      <Input placeholder="标题" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Input placeholder="标签（逗号分隔）" value={tags} onChange={(e) => setTags(e.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" disabled={saving} onClick={() => void submit()}>
          {saving ? '保存中…' : '保存信息'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>取消</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 10: 实现视图主体**

创建 `frontend/src/components/conclusion/ConclusionView.tsx`：

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Conclusion, ConclusionSummary } from '@ai-task-flow/shared';
import { Plus, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { useUIStore } from '@/stores/uiStore';
import { conclusionApi } from '@/api/conclusion';
import { ConclusionProjectList } from './ConclusionProjectList';
import { ConclusionCardItem } from './ConclusionCardItem';
import { ConclusionForm, type ConclusionFormValue } from './ConclusionForm';
import { ConclusionMetaForm, type ConclusionMetaValue } from './ConclusionMetaForm';
import { filterConclusions, type ConclusionSelection } from './searchFilter';

const errMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function ConclusionView() {
  const [cards, setCards] = useState<ConclusionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<ConclusionSelection>({ type: 'all' });
  const [keyword, setKeyword] = useState('');
  const [searchResults, setSearchResults] = useState<ConclusionSummary[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Conclusion | null>(null);
  const [form, setForm] = useState<{ mode: 'create' | 'append'; initial?: Conclusion } | null>(null);
  const [metaForm, setMetaForm] = useState<Conclusion | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const current = ++seq.current;
    try {
      const res = await conclusionApi.list();
      if (current !== seq.current) return;
      setCards(res.conclusions);
    } catch {
      toast.error('结论卡加载失败，请确认后端已启动');
    } finally {
      if (current === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const enterTick = useUIStore((s) => s.viewEnterTick?.conclusion ?? 0);
  useEffect(() => {
    if (enterTick > 0) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 打点变化即意图
  }, [enterTick]);

  useEffect(() => {
    const text = keyword.trim();
    if (!text) {
      setSearchResults(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void conclusionApi.list({ keyword: text })
        .then((res) => setSearchResults(res.conclusions))
        .catch(() => toast.error('搜索失败'));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  const visible = useMemo(
    () => searchResults ?? filterConclusions(cards, selection),
    [searchResults, cards, selection],
  );
  const projects = useMemo(
    () => [...new Set(cards.filter((c) => c.scope === 'project').map((c) => c.project ?? '未归类'))],
    [cards],
  );

  const toggle = async (summary: ConclusionSummary) => {
    if (expandedId === summary.id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(summary.id);
    setDetail(null);
    try {
      const full = await conclusionApi.get(summary.id);
      setDetail(full);
    } catch (err) {
      toast.error(`读取详情失败：${errMessage(err)}`);
    }
  };

  const submit = async (value: ConclusionFormValue) => {
    try {
      if (form?.mode === 'append' && form.initial) {
        await conclusionApi.append(form.initial.id, {
          expectedRev: value.expectedRev,
          scope: value.scope,
          project: value.project,
          version: value.version,
          title: value.title,
          tags: value.tags,
          decision: value.decision,
          data: value.data,
          openItems: value.openItems,
          codeRefs: value.codeRefs,
          changeNote: value.changeNote ?? '人工修订',
        });
        toast.success('已追加新版');
      } else {
        await conclusionApi.create({
          scope: value.scope,
          project: value.project,
          version: value.version,
          title: value.title,
          tags: value.tags,
          decision: value.decision,
          data: value.data,
          openItems: value.openItems,
          codeRefs: value.codeRefs,
        });
        toast.success('已创建结论卡');
      }
      setForm(null);
      setExpandedId(null);
      setDetail(null);
      await refresh();
    } catch (err) {
      toast.error(`保存失败：${errMessage(err)}`);
    }
  };

  const patchMeta = async (value: ConclusionMetaValue) => {
    if (!metaForm) return;
    try {
      await conclusionApi.patch(metaForm.id, value);
      const full = await conclusionApi.get(metaForm.id);
      setMetaForm(null);
      setDetail(full);
      await refresh();
      toast.success('信息已更新');
    } catch (err) {
      toast.error(`更新信息失败：${errMessage(err)}`);
    }
  };

  const remove = async (summary: ConclusionSummary) => {
    if (!window.confirm(`删除「${summary.title}」？删除前会自动备份。`)) return;
    try {
      await conclusionApi.remove(summary.id);
      if (expandedId === summary.id) {
        setExpandedId(null);
        setDetail(null);
      }
      await refresh();
      toast.success('已删除（删除前已自动备份）');
    } catch (err) {
      toast.error(`删除失败：${errMessage(err)}`);
    }
  };

  if (loading) {
    return <div className="text-muted-foreground flex h-full items-center justify-center text-sm">加载结论卡…</div>;
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r @2xl:w-64">
        <div className="flex items-center gap-1 border-b px-3 py-2">
          <span className="flex-1 text-sm font-semibold">结论</span>
          <Button variant="ghost" size="sm" className="size-7 p-0" title="刷新" onClick={() => void refresh()}>
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
        <div className="border-b p-2">
          <div className="relative">
            <Search className="text-muted-foreground absolute top-2.5 left-2 size-3.5" />
            <Input
              className="h-8 pl-7 text-xs"
              placeholder="搜索标题/历史结论…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <ConclusionProjectList cards={cards} selection={selection} onSelect={setSelection} />
        </div>
        <p className="text-muted-foreground border-t p-2 text-[10px] leading-relaxed">
          删除前自动备份到 ~/.ai-task-flow/conclusion-backups/
        </p>
      </aside>

      <section className="flex-1 overflow-y-auto">
        <div className="flex items-center gap-2 border-b px-4 py-2">
          <span className="flex-1 text-sm font-semibold">
            {searchResults ? `搜索结果 · ${searchResults.length}` : `${visible.length} 张结论卡`}
          </span>
          <Button size="sm" onClick={() => setForm({ mode: 'create' })}>
            <Plus className="mr-1 size-3.5" />新建结论
          </Button>
        </div>

        <div className="space-y-3 p-4">
          {form && (
            <ConclusionForm
              mode={form.mode}
              initial={form.initial}
              projects={projects}
              onSubmit={submit}
              onCancel={() => setForm(null)}
            />
          )}

          {metaForm && (
            <ConclusionMetaForm
              initial={metaForm}
              projects={projects}
              onSubmit={patchMeta}
              onCancel={() => setMetaForm(null)}
            />
          )}

          {visible.length === 0 && !form && (
            <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-sm leading-relaxed">
              <p className="font-medium">还没有结论卡。</p>
              <p className="mt-2">让 AI 记录时，可以直接说：</p>
              <pre className="bg-muted mt-2 rounded p-2 text-xs whitespace-pre-wrap">
                {`把刚才的结论记到 ai-task-flow，项目 ${projects[0] ?? '<项目名>'}：
结论、关键数据、待办、涉及文件`}
              </pre>
            </div>
          )}

          {visible.map((summary) => (
            <ConclusionCardItem
              key={summary.id}
              summary={summary}
              expanded={expandedId === summary.id}
              detail={expandedId === summary.id ? detail ?? undefined : undefined}
              onToggle={() => void toggle(summary)}
              onEdit={() => {
                if (detail && expandedId === summary.id) {
                  setForm({ mode: 'append', initial: detail });
                }
              }}
              onPatch={() => {
                if (detail && expandedId === summary.id) setMetaForm(detail);
              }}
              onDelete={() => void remove(summary)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
```

创建薄包装 `frontend/src/components/views/ConclusionView.tsx`：

```tsx
import { ConclusionView as ConclusionPanel } from '@/components/conclusion/ConclusionView';

export function ConclusionView() {
  return <ConclusionPanel />;
}
```

- [ ] **Step 11: 接入侧边栏与 App**

修改 `frontend/src/components/SidebarNav.tsx`：
- import 加 `Lightbulb`。
- `ViewKey` 加 `'conclusion'`。
- `NAV_ITEMS` 在 worklog 后插入 `{ key: 'conclusion', label: '结论', icon: Lightbulb }`。
- 顶部注释 4 视图改 5 视图。

修改 `frontend/src/App.tsx`：
- import `ConclusionView`。
- `VIEWS` 增加 `conclusion: ConclusionView`。

- [ ] **Step 12: 写组件测试**

创建 `frontend/src/components/conclusion/__tests__/conclusionComponents.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Conclusion, ConclusionSummary } from '@ai-task-flow/shared';
import { ConclusionCardItem } from '../ConclusionCardItem';

function summary(over: Partial<ConclusionSummary> = {}): ConclusionSummary {
  return {
    id: 'c_1', scope: 'project', project: 'ai-task-flow', title: '全局搜索方案',
    rev: 2, latestDate: '2026-11-18', latestDecisionExcerpt: '最新结论摘要',
    source: { tool: 'claude-code', conversationName: '话题A' },
    createdAt: 1, updatedAt: 2, ...over,
  };
}

function detail(): Conclusion {
  return {
    id: 'c_1', scope: 'project', project: 'ai-task-flow', title: '全局搜索方案',
    revisions: [
      {
        rev: 1, decision: '旧结论', data: '旧数据',
        source: { tool: 'claude-code' }, date: '2026-11-17', createdAt: 1,
        changeNote: '初始',
      },
      {
        rev: 2, decision: '新结论', openItems: '待办X',
        source: { tool: 'zcode', conversationName: '话题B' }, date: '2026-11-18', createdAt: 2,
        changeNote: '补数据后改结论',
      },
    ],
    createdAt: 1, updatedAt: 2,
  };
}

describe('ConclusionCardItem', () => {
  it('should show latest excerpt when collapsed and latest content when expanded', () => {
    const props = {
      summary: summary(),
      onToggle: vi.fn(),
      onEdit: vi.fn(),
      onPatch: vi.fn(),
      onDelete: vi.fn(),
    };
    const { rerender } = render(<ConclusionCardItem {...props} expanded={false} />);
    expect(screen.getByText('最新结论摘要')).toBeTruthy();
    expect(screen.queryByText('新结论')).toBeNull();

    rerender(<ConclusionCardItem {...props} expanded detail={detail()} />);
    // 最新版正文与演进时间线都可能出现同一段文字，用 getAllByText 断言存在
    expect(screen.getAllByText('新结论').length).toBeGreaterThan(0);
    expect(screen.getAllByText('待办X').length).toBeGreaterThan(0);
    expect(screen.getByText(/补数据后改结论/)).toBeTruthy();
    expect(screen.getByText('初始')).toBeTruthy();
  });
});
```

- [ ] **Step 13: 运行前端测试**

Run:
```bash
cd frontend && npx vitest run src/components/conclusion
```
Expected: PASS（3 个用例：分组 1 + 筛选 1 + 组件 1）。

- [ ] **Step 14: 类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 error。

- [ ] **Step 15: 提交**

```bash
git add frontend/src/api/conclusion.ts frontend/src/components/conclusion frontend/src/components/views/ConclusionView.tsx frontend/src/components/SidebarNav.tsx frontend/src/App.tsx
git commit -m "feat(conclusion): 前端结论视图——项目分组/卡片四节/演进时间线

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 9: E2E、文档与全量回归

**Files:**
- Create: `tests/curl/test_conclusion_crud.sh`
- Modify: `README.md`
- Modify: `.claude/CLAUDE.md`
- Modify: `docs/mcp-registration.md`

**Interfaces:**
- Consumes: Task 6 的 HTTP API。
- Produces: 可重复的 curl 验收脚本；文档与工具清单同步。

- [ ] **Step 1: 写 E2E 脚本**

创建 `tests/curl/test_conclusion_crud.sh`：

```bash
#!/bin/bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:47821}"

fail() {
  echo "FAIL: $1"
  exit 1
}

echo "=== 结论卡 E2E ==="

STATUS=$(curl -s "$BASE_URL/health" | jq -r '.status // empty')
[ "$STATUS" = "ok" ] || fail "后端不可达 ($BASE_URL/health)"

echo "--- 1. 创建 ---"
CREATE=$(curl -s -X POST "$BASE_URL/api/conclusions" \
  -H "Content-Type: application/json" \
  -d '{"scope":"project","project":"e2e-conclusion","title":"E2E 结论","decision":"旧结论：前端过滤","data":"旧数据"}')
ID=$(echo "$CREATE" | jq -r '.id // empty')
[ -n "$ID" ] || fail "创建失败: $CREATE"
echo "PASS: id=$ID"

echo "--- 2. 读取当前进度 ---"
DETAIL=$(curl -s "$BASE_URL/api/conclusions/$ID")
[ "$(echo "$DETAIL" | jq -r '.revisions[0].decision')" = "旧结论：前端过滤" ] || fail "详情读取错误: $DETAIL"
echo "PASS"

echo "--- 3. 部分字段追加（decision 沿用，data 更新） ---"
APPEND=$(curl -s -X POST "$BASE_URL/api/conclusions/$ID/revisions" \
  -H "Content-Type: application/json" \
  -d '{"expectedRev":1,"data":"新数据","changeNote":"补充数据"}')
[ "$(echo "$APPEND" | jq -r '.rev')" = "2" ] || fail "追加失败: $APPEND"
DETAIL=$(curl -s "$BASE_URL/api/conclusions/$ID")
[ "$(echo "$DETAIL" | jq -r '.revisions[1].decision')" = "旧结论：前端过滤" ] || fail "decision 未沿用"
[ "$(echo "$DETAIL" | jq -r '.revisions[1].data')" = "新数据" ] || fail "data 未更新"
echo "PASS"

echo "--- 4. 搜索命中历史版本 ---"
SEARCH=$(curl -s "$BASE_URL/api/conclusions?keyword=前端过滤")
[ "$(echo "$SEARCH" | jq -r '.conclusions[0].matchedRev')" = "1" ] || fail "历史命中错误: $SEARCH"
echo "PASS"

echo "--- 5. expectedRev 冲突 ---"
CODE=$(curl -s -o /tmp/conclusion-conflict.json -w "%{http_code}" -X POST "$BASE_URL/api/conclusions/$ID/revisions" \
  -H "Content-Type: application/json" \
  -d '{"expectedRev":1,"data":"stale","changeNote":"stale"}')
[ "$CODE" = "409" ] || fail "期望 409，实际 $CODE: $(cat /tmp/conclusion-conflict.json)"
echo "PASS"

echo "--- 6. 缺 changeNote 拒绝 ---"
CODE=$(curl -s -o /tmp/conclusion-bad.json -w "%{http_code}" -X POST "$BASE_URL/api/conclusions/$ID/revisions" \
  -H "Content-Type: application/json" \
  -d '{"data":"x"}')
[ "$CODE" = "400" ] || fail "期望 400，实际 $CODE"
echo "PASS"

echo "--- 7. 改元信息 ---"
PATCH=$(curl -s -X PATCH "$BASE_URL/api/conclusions/$ID" \
  -H "Content-Type: application/json" \
  -d '{"title":"E2E 结论（改名）"}')
[ "$(echo "$PATCH" | jq -r '.title')" = "E2E 结论（改名）" ] || fail "PATCH 失败: $PATCH"
echo "PASS"

echo "--- 8. 删除并保留历史可查（备份在数据目录） ---"
DEL=$(curl -s -X DELETE "$BASE_URL/api/conclusions/$ID")
[ "$(echo "$DEL" | jq -r '.deleted')" = "true" ] || fail "删除失败: $DEL"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/conclusions/$ID")
[ "$CODE" = "404" ] || fail "删除后应 404，实际 $CODE"
echo "PASS"

echo "=== 全部通过 ==="
```

赋可执行权限（Git Bash 下可跳过）：
```bash
chmod +x tests/curl/test_conclusion_crud.sh
```

- [ ] **Step 2: 跑全量后端与前端测试**

Run:
```bash
cd backend && npx vitest run
cd ../frontend && npm test
cd ../extension && npm test
```
Expected: 全部 PASS，无新增失败。

- [ ] **Step 3: 构建全量**

Run: `cd /d/Study/ai-task-flow && npm run build`
Expected: shared/backend/frontend 全部构建成功。

- [ ] **Step 4: 手工冒烟（需后端+前端运行）**

Run:
```bash
npm run dev
```
然后：
1. 打开 `http://127.0.0.1:5678`，侧边栏出现「结论」。
2. 在 Claude Code 中说：「把刚才的结论记到 ai-task-flow，项目 ai-task-flow：结论 X，数据 Y」。
3. 页面「结论」视图刷新可见，来源显示 `claude-code`，`rev 1`。
4. 说「更新刚才那张结论，补充数据 Z，changeNote 补数据」。
5. 页面展开卡片：最新版显示 Z，演进时间线出现 rev 2 与变更说明；`decision` 仍为 X。
6. 在页面点「编辑（追加新版）」，改标题保存，出现 rev 3 且来源为 `manual`。
7. 点「改信息」修改标题/归属并保存，版本号不变（不产生新 revision）。

- [ ] **Step 5: 更新 README**

`README.md`：
- 功能模块表新增：

```markdown
| **结论卡** | 长对话结论按主题沉淀：结论/数据/待办/代码位置；逐版完整历史，默认看最新 |
```

- MCP 工具清单 10 → 12，追加 `record_conclusion` / `query_conclusions`。
- 「核心循环」可补一句：讨论定稿后让 AI 记一张结论卡，下次直接看最新版。
- 测试数量按本次实际输出更新（不要写死未验证的数字）。

- [ ] **Step 6: 更新 `.claude/CLAUDE.md`**

- 「MCP Server」节：工具数 10 → 12；工具列表追加 `record_conclusion` / `query_conclusions`。
- 「后端架构」业务模块清单追加 `conclusion`。
- 「持久化与数据目录」数据文件追加 `conclusions.json`，备份目录 `conclusion-backups/`。
- 「前端」视图列表：worklog、**conclusion**、knowledge、vocab、mindmap。
- 「文档地图」无需新增（spec 与计划已在 `docs/plans/`）。

- [ ] **Step 7: 更新 `docs/mcp-registration.md`**

- 「工具(10)」改为「工具(12)」，列出两个新工具。
- 「当前版本」的 dist 构建来源 commit 改为本次收尾 commit 的前一个提交（或构建时 `git log --oneline -1`），构建时间写实际时间。
- 数据行补 `~/.ai-task-flow/conclusions.json`（备份 `conclusion-backups/`）。

- [ ] **Step 8: 提交**

```bash
git add tests/curl/test_conclusion_crud.sh README.md .claude/CLAUDE.md docs/mcp-registration.md
git commit -m "docs: 结论卡 E2E 与文档收尾——工具数 12/模块/数据文件

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-Review Checklist（执行者收尾时逐项确认）

- [ ] 每个 Task 的测试都先红后绿，未跳过失败验证。
- [ ] `appendRevision` 的「省略=沿用、空值=清空、无变化=400」三条都有测试覆盖。
- [ ] `expectedRev` 在服务层与 HTTP/MCP 两侧都有 409 路径测试。
- [ ] MCP `query_conclusions({cardId})` 返回最新版**完整四节**，不是摘要。
- [ ] 来源元信息：Claude Code 的 `CLAUDE_CODE_SESSION_ID`、ZCode 的 clientInfo、进程指纹三条路径都实测/单测。
- [ ] 前端列表只展示摘要；展开时拉详情；空节不渲染。
- [ ] 删除前产生备份；纯追加不产生备份。
- [ ] worklog 的现有测试未被改动且全绿。
- [ ] README / CLAUDE.md / mcp-registration 的工具数与模块清单已同步。
- [ ] 所有提交仅在本地，未 push。
