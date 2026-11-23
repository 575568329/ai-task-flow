# 项目路径身份与跨项目关联 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给项目引入稳定 `id` 与可多绑的本地路径，工作记录按最长前缀自动归属；跨项目需求用「主项目 + 关联项目」表达，且改名不再影响历史数据。

**Architecture:** 项目表唯一来源是 `worklog.json`；路径匹配在 Worklog 领域层完成；结论卡只存 `projectId` + 名称快照，不做跨文件级联。迁移只在 HTTP 启动时执行一次，用文件锁防双进程重复。

**Tech Stack:** TypeScript ESM(Node16)、Fastify、MCP SDK、React 19 + Vite、vitest、proper-lockfile、nanoid。

## Global Constraints

- 对话与注释一律中文；提交信息用 Conventional Commits。
- ESM + Node16：所有相对 import 必须带 `.js` 后缀。
- 不引入新运行时依赖；id 生成复用现有 `nanoid`。
- 新增字段全部可选，旧数据不做破坏性改写。
- 所有破坏性写入走仓储 `mutate(..., { backup: true })` 或迁移前快照。
- 路径归一化只用于比较；存储与展示保留用户原始写法。
- 前端路径与项目状态一律来自后端返回，不在浏览器做文件系统判断。
- 每个任务结束必须 `cd backend && npx vitest run` 与 `cd frontend && npm test` 全绿（按任务范围跑对应包）。

---

### Task 1: 路径匹配纯函数

**Files:**
- Create: `backend/src/domain/worklog/pathMatch.ts`
- Test: `backend/src/domain/worklog/__tests__/pathMatch.test.ts`

**Interfaces:**
- Produces:
  - `normalizePath(input: string): string`
  - `isPathWithin(parent: string, candidate: string): boolean`
  - `interface ProjectPathRef { projectId: string; path: string }`
  - `findOwningProject(refs: ProjectPathRef[], candidate: string): string | undefined`
  - `async resolveMatchPath(input: string): Promise<string>`

- [ ] **Step 1: 写失败测试**

```ts
// backend/src/domain/worklog/__tests__/pathMatch.test.ts
import { describe, it, expect } from 'vitest';
import { normalizePath, isPathWithin, findOwningProject } from '../pathMatch.js';

describe('normalizePath', () => {
  it('统一分隔符、去尾分隔符、Windows 转小写', () => {
    expect(normalizePath('D:\\Study\\ai-task-flow\\')).toBe('d:/study/ai-task-flow');
    expect(normalizePath('D:/Study\\ai-task-flow')).toBe('d:/study/ai-task-flow');
  });
  it('保留盘符根', () => {
    expect(normalizePath('D:\\')).toBe('d:/');
  });
});

describe('isPathWithin', () => {
  it('命中子路径', () => {
    expect(isPathWithin('D:\\a', 'D:\\a\\b')).toBe(true);
  });
  it('不得误匹配同前缀兄弟目录', () => {
    expect(isPathWithin('D:\\a', 'D:\\ab')).toBe(false);
  });
  it('尾分隔符不影响', () => {
    expect(isPathWithin('D:\\a\\', 'D:\\a')).toBe(true);
  });
  it('大小写与斜杠不敏感', () => {
    expect(isPathWithin('d:/A', 'D:\\a\\x')).toBe(true);
  });
});

describe('findOwningProject', () => {
  const refs = [
    { projectId: 'p_parent', path: 'D:\\xunfei\\资源加工平台' },
    { projectId: 'p_child', path: 'D:\\xunfei\\资源加工平台\\搜题平台' },
    { projectId: 'p_other', path: 'D:\\xunfei\\题库' },
  ];

  it('最长前缀优先', () => {
    expect(findOwningProject(refs, 'D:\\xunfei\\资源加工平台\\搜题平台\\前端\\x'))
      .toBe('p_child');
    expect(findOwningProject(refs, 'D:\\xunfei\\资源加工平台\\前端\\rpp-web'))
      .toBe('p_parent');
  });
  it('未命中返回 undefined', () => {
    expect(findOwningProject(refs, 'D:\\Study\\ai-task-flow')).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && npx vitest run src/domain/worklog/__tests__/pathMatch.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

```ts
// backend/src/domain/worklog/pathMatch.ts
import fs from 'node:fs/promises';
import path from 'node:path';

/** 归一化为比较键:反斜杠转正斜杠、折叠重复分隔符、去尾分隔符、Windows 转小写 */
export function normalizePath(input: string): string {
  let value = input.trim().replace(/\\/g, '/');
  value = value.replace(/\/{2,}/g, '/');
  if (value.length > 1 && !/^[a-zA-Z]:\/$/.test(value)) {
    value = value.replace(/\/+$/, '');
  }
  if (/^[a-zA-Z]:/.test(value)) value = value.toLowerCase();
  return value;
}

/** candidate 是否位于 parent 之内(按路径分隔符边界,避免 /a 匹配 /ab) */
export function isPathWithin(parent: string, candidate: string): boolean {
  const p = normalizePath(parent);
  const c = normalizePath(candidate);
  if (p === c) return true;
  return c.startsWith(p.endsWith('/') ? p : `${p}/`);
}

export interface ProjectPathRef {
  projectId: string;
  path: string;
}

/** 返回最长前缀命中的 projectId;无命中返回 undefined */
export function findOwningProject(refs: ProjectPathRef[], candidate: string): string | undefined {
  let best: { projectId: string; length: number } | undefined;
  for (const ref of refs) {
    if (!isPathWithin(ref.path, candidate)) continue;
    const length = normalizePath(ref.path).length;
    if (!best || length > best.length) best = { projectId: ref.projectId, length };
  }
  return best?.projectId;
}

/** realpath 解析;目录已删除/网络盘/无权限时降级 path.resolve,绝不抛错 */
export async function resolveMatchPath(input: string): Promise<string> {
  try {
    return await fs.realpath(input);
  } catch {
    return path.resolve(input);
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && npx vitest run src/domain/worklog/__tests__/pathMatch.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/src/domain/worklog/pathMatch.ts backend/src/domain/worklog/__tests__/pathMatch.test.ts
git commit -m "feat(worklog): 路径归一化与最长前缀归属纯函数"
```

---

### Task 2: shared 类型扩展

**Files:**
- Modify: `shared/src/types/worklog.ts`
- Modify: `shared/src/types/conclusion.ts`

**Interfaces:**
- Produces：后续任务依赖的字段名，必须逐字一致。
  - `WorklogProject.id: string`、`paths?: string[]`
  - `WorklogEntry.sourcePath?: string`、`relatedProjects?: string[]`、`relatedProjectIds?: string[]`、`pathUnmatched?: boolean`
  - `WorklogRecordResponse.projectId?: string`、`warnings?: string[]`
  - `WorklogQueryRequest.relatedProject?: string`
  - `WorklogQueryResultEntry.sourcePath?`、`relatedProjects?`、`pathUnmatched?`
  - `WorklogUpdateRequest.relatedProjects?: string[]`
  - `Conclusion.projectId?: string`、`relatedProjectIds?: string[]`、`relatedProjects?: string[]`
  - `ConclusionCreateRequest/AppendRequest/RecordRequest.relatedProjects?: string[]`
  - `ConclusionSummary/Detail.relatedProjects?: string[]`

- [ ] **Step 1: 修改 worklog 类型**

在 `WorklogProject` 中 `name` 前加：

```ts
  /** 稳定身份(p_xxx);迁移前旧数据可能缺失 */
  id: string;
  /** 归属路径,可多个;空/缺省 = 未绑定 */
  paths?: string[];
```

在 `WorklogEntry` 中追加：

```ts
  /** 记录时的 cwd(原始写法),用于追溯与重新归属 */
  sourcePath?: string;
  /** 关联项目名称快照(展示兜底) */
  relatedProjects?: string[];
  /** 关联项目稳定引用 */
  relatedProjectIds?: string[];
  /** 记录时路径未命中任何项目 */
  pathUnmatched?: boolean;
```

在 `WorklogRecordResponse` 中追加：

```ts
  projectId?: string;
  warnings?: string[];
```

在 `WorklogRecordRequest` 中追加：

```ts
  /** 记录端所在路径(MCP handler 自动填 process.cwd());不传则不做路径归属 */
  sourcePath?: string;
  /** 关联项目名称;解析失败的项会被忽略并在 warnings 中返回 */
  relatedProjects?: string[];
```

`WorklogQueryRequest` 追加：

```ts
  /** 按关联项目名称过滤 */
  relatedProject?: string;
```

`WorklogQueryResultEntry` 追加：

```ts
  sourcePath?: string;
  relatedProjects?: string[];
  pathUnmatched?: boolean;
```

`WorklogUpdateRequest` 追加：

```ts
  relatedProjects?: string[];
```

- [ ] **Step 2: 修改 conclusion 类型**

`Conclusion` 追加：

```ts
  /** 项目稳定引用;项目不存在时为空 */
  projectId?: string;
  /** 关联项目名称快照 */
  relatedProjects?: string[];
  /** 关联项目稳定引用 */
  relatedProjectIds?: string[];
```

`ConclusionCreateRequest`、`ConclusionAppendRequest`、`ConclusionRecordRequest` 各追加：

```ts
  /** 由接口层查 worklog 后填入;Service 只存储 */
  projectId?: string;
  relatedProjectIds?: string[];
  relatedProjects?: string[];
```

`ConclusionSummary`、`ConclusionDetail` 各追加：

```ts
  relatedProjects?: string[];
```

- [ ] **Step 3: 构建 shared**

Run: `npm run build:shared`
Expected: 无报错。

- [ ] **Step 4: 跑现有测试确认无回归**

Run: `cd backend && npx vitest run`
Expected: 211 passed。类型为可选字段，不应破坏现有用例。

- [ ] **Step 5: 提交**

```bash
git add shared/src/types/worklog.ts shared/src/types/conclusion.ts
git commit -m "feat(shared): 项目 id/路径与关联项目类型"
```

---

### Task 3: 项目 id 迁移

**Files:**
- Create: `backend/src/application/migration/ProjectIdMigration.ts`
- Test: `backend/src/application/migration/__tests__/ProjectIdMigration.test.ts`
- Modify: `backend/src/config/dataDir.ts`（新增迁移锁/标记路径）

**Interfaces:**
- Consumes: `WorklogRepository.load/mutate`、`ConclusionRepository.load/mutate`
- Produces:
  - `runProjectIdMigration(deps: MigrationDeps): Promise<MigrationReport>`
  - `interface MigrationReport { assignedIds: number; boundConclusions: number; duplicateNames: string[]; skipped: boolean }`

- [ ] **Step 1: 写失败测试（幂等 + 重名 + 结论绑定）**

```ts
// backend/src/application/migration/__tests__/ProjectIdMigration.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { JsonWorklogRepository } from '../../../infrastructure/persistence/JsonWorklogRepository.js';
import { JsonConclusionRepository } from '../../../infrastructure/persistence/JsonConclusionRepository.js';
import { runProjectIdMigration } from '../ProjectIdMigration.js';

describe('runProjectIdMigration', () => {
  let worklogRepo: JsonWorklogRepository;
  let conclusionRepo: JsonConclusionRepository;
  let dir: string;

  beforeEach(async () => {
    dir = path.join(os.tmpdir(), `mig-${nanoid()}`);
    await fs.mkdir(dir, { recursive: true });
    worklogRepo = new JsonWorklogRepository(path.join(dir, 'worklog.json'), path.join(dir, 'wb'));
    conclusionRepo = new JsonConclusionRepository(path.join(dir, 'conclusions.json'), path.join(dir, 'cb'));
    await worklogRepo.mutate((d) => {
      d.projects.push(
        { name: '资源加工平台', createdAt: 1, versions: [] } as never,
        { name: '题库', createdAt: 2, versions: [] } as never,
      );
    });
    await conclusionRepo.mutate((d) => {
      d.conclusions.push(
        { id: 'c1', scope: 'project', project: '题库', title: 't', tags: [], revisions: [] } as never,
        { id: 'c2', scope: 'project', project: '不存在', title: 't2', tags: [], revisions: [] } as never,
      );
    });
  });

  it('补 id 并按名称绑定结论卡,重复执行幂等', async () => {
    const r1 = await runProjectIdMigration({ dataDir: dir, worklogRepo, conclusionRepo });
    expect(r1.assignedIds).toBe(2);
    expect(r1.boundConclusions).toBe(1);

    const tree = await worklogRepo.load();
    const ids = tree.projects.map((p) => p.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => id.startsWith('p_'))).toBe(true);

    const cards = await conclusionRepo.load();
    const c1 = cards.conclusions.find((c) => c.id === 'c1')!;
    const c2 = cards.conclusions.find((c) => c.id === 'c2')!;
    expect(c1.projectId).toBe(tree.projects.find((p) => p.name === '题库')!.id);
    expect(c2.projectId).toBeUndefined();

    const r2 = await runProjectIdMigration({ dataDir: dir, worklogRepo, conclusionRepo });
    expect(r2.skipped).toBe(true);
  });

  it('重名项目只报告不自动合并', async () => {
    await worklogRepo.mutate((d) => {
      d.projects.push({ name: '题库', createdAt: 3, versions: [] } as never);
    });
    const r = await runProjectIdMigration({ dataDir: dir, worklogRepo, conclusionRepo });
    expect(r.duplicateNames).toContain('题库');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && npx vitest run src/application/migration`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现迁移**

```ts
// backend/src/application/migration/ProjectIdMigration.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import { nanoid } from 'nanoid';
import type { WorklogRepository } from '../../domain/worklog/repositories/WorklogRepository.js';
import type { ConclusionRepository } from '../../domain/conclusion/repositories/ConclusionRepository.js';

const MIGRATION_VERSION = 1;
const MARKER = '.migration-project-id.json';
const LOCK = '.migration-project-id.lock';

export interface MigrationReport {
  assignedIds: number;
  boundConclusions: number;
  duplicateNames: string[];
  skipped: boolean;
}

export interface MigrationDeps {
  dataDir: string;
  worklogRepo: WorklogRepository;
  conclusionRepo: ConclusionRepository;
}

async function readMarker(dataDir: string): Promise<number> {
  try {
    const raw = await fs.readFile(path.join(dataDir, MARKER), 'utf8');
    return (JSON.parse(raw) as { version?: number }).version ?? 0;
  } catch {
    return 0;
  }
}

/** 补项目 id + 结论卡按名称绑定;幂等,只在 HTTP 启动时调用 */
export async function runProjectIdMigration(deps: MigrationDeps): Promise<MigrationReport> {
  const report: MigrationReport = {
    assignedIds: 0, boundConclusions: 0, duplicateNames: [], suggestedPaths: {}, skipped: false,
  };
  await fs.mkdir(deps.dataDir, { recursive: true });
  if (await readMarker(deps.dataDir) >= MIGRATION_VERSION) {
    report.skipped = true;
    return report;
  }

  const release = await lockfile.lock(deps.dataDir, { stale: 30_000, retries: 10 });
  try {
    if (await readMarker(deps.dataDir) >= MIGRATION_VERSION) {
      report.skipped = true;
      return report;
    }

    const nameToId = new Map<string, string>();
    await deps.worklogRepo.mutate((data) => {
      for (const project of data.projects) {
        if (!project.id) {
          project.id = `p_${nanoid(8)}`;
          report.assignedIds += 1;
        }
        if (nameToId.has(project.name)) {
          if (!report.duplicateNames.includes(project.name)) report.duplicateNames.push(project.name);
          continue;
        }
        nameToId.set(project.name, project.id);
      }
    }, { backup: true });

    await deps.conclusionRepo.mutate((data) => {
      for (const card of data.conclusions) {
        if (card.projectId || !card.project) continue;
        const id = nameToId.get(card.project);
        if (id) {
          card.projectId = id;
          report.boundConclusions += 1;
        }
      }
    }, { backup: true });

    await fs.writeFile(
      path.join(deps.dataDir, MARKER),
      JSON.stringify({ version: MIGRATION_VERSION, at: new Date().toISOString() }, null, 2),
      'utf8',
    );
    return report;
  } finally {
    await release();
  }
}
```

> `ConclusionRepository` 已有 `mutate<T>(fn, options?: { backup?: boolean })`（`backend/src/domain/conclusion/repositories/ConclusionRepository.ts:12`），无需新增接口。

**路径建议**：在报告里附带建议路径，供页面展示（不自动写入）：

```ts
export interface MigrationReport {
  assignedIds: number;
  boundConclusions: number;
  duplicateNames: string[];
  /** 项目名 → 存在的同名候选目录(仅 D:\xunfei、D:\Study 两个根) */
  suggestedPaths: Record<string, string>;
  skipped: boolean;
}
```

在 worklog mutate 之后追加：

```ts
    const tree = await deps.worklogRepo.load();
    for (const project of tree.projects) {
      if (project.paths?.length) continue;
      for (const root of ['D:\\xunfei', 'D:\\Study']) {
        const candidate = path.join(root, project.name);
        try {
          await fs.access(candidate);
          report.suggestedPaths[project.name] = candidate;
          break;
        } catch { /* 不存在则继续 */ }
      }
    }
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && npx vitest run src/application/migration`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/src/application/migration backend/src/config/dataDir.ts
git commit -m "feat(migration): 项目补 id 与结论卡绑定(幂等+锁)"
```

---

### Task 4: 工作记录路径归属

**Files:**
- Modify: `backend/src/application/worklog/WorklogService.ts:82-132`
- Test: `backend/src/application/worklog/__tests__/WorklogService.test.ts`

**Interfaces:**
- Consumes: `findOwningProject`、`resolveMatchPath`（Task 1）
- Produces: `record()` 返回 `projectId`、`warnings`；条目写入 `sourcePath` / `pathUnmatched`

- [ ] **Step 1: 写失败测试**

```ts
it('should assign owner project by longest path prefix', async () => {
  await service.bindProjectPaths('资源加工平台', ['D:\\xunfei\\资源加工平台']);
  await service.bindProjectPaths('搜题平台', ['D:\\xunfei\\资源加工平台\\搜题平台']);

  const r = await service.record({
    project: '随便写的名字',
    version: 'V1',
    title: 't',
    detail: 'd',
    sourcePath: 'D:\\xunfei\\资源加工平台\\搜题平台\\前端\\x',
  });
  expect(r.projectId).toBeDefined();
  const tree = await service.getTree();
  const owner = tree.projects.find((p) => p.id === r.projectId)!;
  expect(owner.name).toBe('搜题平台');
  expect(owner.versions[0].entries[0].sourcePath)
    .toBe('D:\\xunfei\\资源加工平台\\搜题平台\\前端\\x');
});

it('should fall back to given project name when path matches nothing', async () => {
  const r = await service.record({
    project: 'Demo', version: 'V1', title: 't', detail: 'd',
    sourcePath: 'D:\\nowhere\\x',
  });
  const tree = await service.getTree();
  const entry = tree.projects.find((p) => p.name === 'Demo')!.versions[0].entries[0];
  expect(entry.pathUnmatched).toBe(true);
  expect(r.warnings?.some((w) => w.includes('未归属'))).toBe(true);
});
```

> `sourcePath` 需在 `WorklogRecordRequest` 中新增（Task 2 已加字段则补）：

```ts
  /** 记录端所在路径(MCP 自动填 cwd);不传则不做路径归属 */
  sourcePath?: string;
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && npx vitest run src/application/worklog/__tests__/WorklogService.test.ts -t "path prefix"`
Expected: FAIL。

- [ ] **Step 3: 实现归属**

在 `record()` 的 `repo.mutate` 内、查找 `proj` 之前加入：

```ts
    const normalizedSource = input.sourcePath?.trim()
      ? await resolveMatchPath(input.sourcePath.trim())
      : undefined;
    let ownerId: string | undefined;
    if (normalizedSource) {
      const refs = data.projects.flatMap((p) =>
        (p.paths ?? []).map((pth) => ({ projectId: p.id, path: pth })),
      );
      ownerId = findOwningProject(refs, normalizedSource);
    }
    const ownerProject = ownerId ? data.projects.find((p) => p.id === ownerId) : undefined;
```

把项目查找改为：

```ts
    let proj = ownerProject ?? data.projects.find((p) => p.name === project);
```

给新建项目补 id：

```ts
      proj = { id: `p_${nanoid(8)}`, name: project, createdAt: Date.now(), versions: [] };
```

条目创建后写入：

```ts
      if (normalizedSource) entry.sourcePath = input.sourcePath!.trim();
      if (normalizedSource && !ownerProject) entry.pathUnmatched = true;
```

返回值补：

```ts
      const warnings: string[] = [];
      if (normalizedSource && !ownerProject) {
        warnings.push('当前路径未归属任何项目，可在页面绑定路径');
      }
      return { entryId: entry.id, path: `${proj.name}/${version}/${entry.id}`,
        projectId: proj.id, createdProject, createdVersion, ...(warnings.length ? { warnings } : {}) };
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && npx vitest run src/application/worklog`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/src/application/worklog
git commit -m "feat(worklog): 按项目路径最长前缀归属记录"
```

---

### Task 5: 关联项目与改名快照同步

**Files:**
- Modify: `backend/src/application/worklog/WorklogService.ts`
- Test: `backend/src/application/worklog/__tests__/WorklogService.test.ts`

**Interfaces:**
- Produces：`record`/`update` 写入 `relatedProjectIds` + `relatedProjects`；无法解析的名称进 `warnings` 并丢弃。

- [ ] **Step 1: 写失败测试**

```ts
it('should resolve related projects and ignore unknown names with warning', async () => {
  await service.record({ project: 'A', version: 'V1', title: 'a', detail: 'd' });
  await service.record({ project: 'B', version: 'V1', title: 'b', detail: 'd' });

  const r = await service.record({
    project: 'A', version: 'V1', title: '跨项目', detail: 'd',
    relatedProjects: ['B', '拼错的'],
  });
  expect(r.warnings?.some((w) => w.includes('拼错的'))).toBe(true);

  const tree = await service.getTree();
  const entry = tree.projects.find((p) => p.name === 'A')!
    .versions[0].entries.find((e) => e.title === '跨项目')!;
  expect(entry.relatedProjects).toEqual(['B']);
  expect(entry.relatedProjectIds).toEqual([
    tree.projects.find((p) => p.name === 'B')!.id,
  ]);
});

it('should sync related project name snapshot on rename', async () => {
  await service.record({ project: 'A', version: 'V1', title: 'a', detail: 'd' });
  await service.record({ project: 'B', version: 'V1', title: 'b', detail: 'd' });
  await service.record({ project: 'A', version: 'V1', title: 'x', detail: 'd', relatedProjects: ['B'] });

  await service.renameProject('B', 'B2');
  const tree = await service.getTree();
  const entry = tree.projects.find((p) => p.name === 'A')!
    .versions[0].entries.find((e) => e.title === 'x')!;
  expect(entry.relatedProjects).toEqual(['B2']);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && npx vitest run src/application/worklog -t "related"`
Expected: FAIL。

- [ ] **Step 3: 实现**

在 `record` 内加解析函数（模块级，便于复用）：

```ts
function resolveRelated(data: WorklogData, names: string[] | undefined) {
  const ids: string[] = [];
  const labels: string[] = [];
  const ignored: string[] = [];
  for (const name of names ?? []) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const project = data.projects.find((p) => p.name === trimmed);
    if (!project) { ignored.push(trimmed); continue; }
    if (!ids.includes(project.id)) {
      ids.push(project.id);
      labels.push(project.name);
    }
  }
  return { ids, labels, ignored };
}
```

`record` 内、条目入列前：

```ts
      const related = resolveRelated(data, input.relatedProjects);
      if (related.ids.length) {
        entry.relatedProjectIds = related.ids;
        entry.relatedProjects = related.labels;
      }
      if (related.ignored.length) {
        warnings.push(`以下关联项目不存在，已忽略：${related.ignored.join(', ')}`);
      }
```

（`warnings` 数组需在 mutate 回调顶部声明，Task 4 已引入。）

`renameProject` 的 mutate 内，改名之后追加：

```ts
        for (const version of proj.versions) {
          for (const entry of version.entries) {
            if (!entry.relatedProjects?.includes(project)) continue;
            entry.relatedProjects = entry.relatedProjects.map((n) => (n === project ? target : n));
          }
        }
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && npx vitest run src/application/worklog`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/src/application/worklog
git commit -m "feat(worklog): 关联项目解析与改名快照同步"
```

---

### Task 6: 项目路径 CRUD 与 HTTP 接口

**Files:**
- Modify: `backend/src/application/worklog/WorklogService.ts`
- Modify: `backend/src/interfaces/http/routes/worklogRoutes.ts`
- Test: `backend/src/application/worklog/__tests__/WorklogService.test.ts`

**Interfaces:**
- Produces:
  - `bindProjectPaths(projectName: string, paths: string[]): Promise<void>`
  - `unbindProjectPath(projectName: string, path: string): Promise<void>`
  - `PUT /api/worklog/projects/:name/paths`，body `{ paths: string[] }`
  - `DELETE /api/worklog/projects/:name/paths`，query `?path=...`

- [ ] **Step 1: 写失败测试**

```ts
it('should reject a path already bound to another project', async () => {
  await service.record({ project: 'A', version: 'V1', title: 'a', detail: 'd' });
  await service.record({ project: 'B', version: 'V1', title: 'b', detail: 'd' });
  await service.bindProjectPaths('A', ['D:\\x\\shared']);

  await expect(service.bindProjectPaths('B', ['D:\\x\\shared']))
    .rejects.toThrow(/已被项目/);
});

it('should bind and unbind multiple paths', async () => {
  await service.record({ project: 'A', version: 'V1', title: 'a', detail: 'd' });
  await service.bindProjectPaths('A', ['D:\\x\\a', 'D:\\y\\a']);
  let tree = await service.getTree();
  expect(tree.projects.find((p) => p.name === 'A')!.paths).toEqual(['D:\\x\\a', 'D:\\y\\a']);

  await service.unbindProjectPath('A', 'D:\\x\\a');
  tree = await service.getTree();
  expect(tree.projects.find((p) => p.name === 'A')!.paths).toEqual(['D:\\y\\a']);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && npx vitest run src/application/worklog -t "bind"`
Expected: FAIL。

- [ ] **Step 3: 实现服务方法**

```ts
  /** 绑定项目路径(整体替换);同一路径不得被两个项目占用 */
  async bindProjectPaths(projectName: string, paths: string[]): Promise<void> {
    const name = validateName(projectName, '项目名');
    const cleaned = [...new Set(paths.map((p) => p.trim()).filter(Boolean))];
    for (const p of cleaned) {
      if (!path.isAbsolute(p)) throw new WorklogValidationError(`路径必须是绝对路径:${p}`);
    }
    await this.repo.mutate((data) => {
      const proj = findProject(data, name);
      for (const other of data.projects) {
        if (other.name === name) continue;
        for (const p of cleaned) {
          if ((other.paths ?? []).some((op) => normalizePath(op) === normalizePath(p))) {
            throw new WorklogConflictError(`路径 ${p} 已被项目 "${other.name}" 占用`);
          }
        }
      }
      proj.paths = cleaned;
    }, { backup: true });
  }

  /** 解绑单个路径 */
  async unbindProjectPath(projectName: string, targetPath: string): Promise<void> {
    const name = validateName(projectName, '项目名');
    await this.repo.mutate((data) => {
      const proj = findProject(data, name);
      const key = normalizePath(targetPath);
      proj.paths = (proj.paths ?? []).filter((p) => normalizePath(p) !== key);
    }, { backup: true });
  }
```

导入：`import path from 'node:path'`、`normalizePath` 来自 `../../domain/worklog/pathMatch.js`。

**替换现有 `getTree()`**，附加路径失效标记（项目数量少，直接 `access` 可接受）：

```ts
  /** 全树 + 每个项目不存在的路径(前端据此标红) */
  async getTree(): Promise<WorklogData> {
    const data = await this.repo.load();
    for (const project of data.projects) {
      const missing: string[] = [];
      for (const p of project.paths ?? []) {
        try {
          await fs.access(p);
        } catch {
          missing.push(p);
        }
      }
      if (missing.length) {
        (project as WorklogProject & { missingPaths?: string[] }).missingPaths = missing;
      }
    }
    return data;
  }
```

`WorklogProject` 类型追加可选字段（Task 2 一并加）：

```ts
  /** 仅由 getTree 计算,不持久化 */
  missingPaths?: string[];
```

- [ ] **Step 4: 加 HTTP 路由**

在 `worklogRoutes.ts` 中按现有路由风格追加：

```ts
  fastify.put<{ Params: { name: string }; Body: { paths?: string[] } }>(
    '/api/worklog/projects/:name/paths',
    async (request) => {
      const paths = Array.isArray(request.body?.paths) ? request.body.paths : [];
      await worklogService.bindProjectPaths(request.params.name, paths);
      return { ok: true };
    },
  );

  fastify.delete<{ Params: { name: string }; Querystring: { path?: string } }>(
    '/api/worklog/projects/:name/paths',
    async (request) => {
      const target = request.query.path?.trim();
      if (!target) throw new WorklogValidationError('path 不能为空');
      await worklogService.unbindProjectPath(request.params.name, target);
      return { ok: true };
    },
  );
```

- [ ] **Step 5: 跑测试并提交**

Run: `cd backend && npx vitest run src/application/worklog src/interfaces/http`
Expected: PASS。

```bash
git add backend/src/application/worklog backend/src/interfaces/http/routes/worklogRoutes.ts
git commit -m "feat(worklog): 项目路径绑定/解绑与 HTTP 接口"
```

---

### Task 7: 结论卡 projectId 与关联项目

**Files:**
- Modify: `backend/src/interfaces/mcp/tools/conclusion/record-conclusion.ts`（解析 projectId）
- Modify: `backend/src/interfaces/http/routes/conclusionRoutes.ts`（同样解析）
- Modify: `backend/src/application/conclusion/ConclusionService.ts`（存储与查询）
- Test: `backend/src/application/conclusion/__tests__/ConclusionService.test.ts`

**Interfaces:**
- Consumes: `WorklogService.getTree()`（仅接口层调用）
- Produces：
  - `ConclusionService.create/append/record` 接收 `projectId?`、`relatedProjects?`
  - 降级规则：未知关联项目忽略并返回 `warnings`

- [ ] **Step 1: 写失败测试**

```ts
it('should store projectId and related projects', async () => {
  const card = await service.create({
    scope: 'project',
    project: 'A',
    title: 't',
    decision: 'd',
    projectId: 'p_a',
    relatedProjects: ['B'],
    relatedProjectIds: ['p_b'],
  });
  expect(card.projectId).toBe('p_a');
  expect(card.relatedProjects).toEqual(['B']);
  expect(card.relatedProjectIds).toEqual(['p_b']);
});
```

> 说明：`projectId` 与关联 id 由接口层（MCP/HTTP）查 worklog 后填入；Service 只做存储与校验，不依赖 worklog。

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && npx vitest run src/application/conclusion -t "projectId"`
Expected: FAIL。

- [ ] **Step 3: 落地 Service**

- `createConclusion` / `appendRevision` 增加可选参数：`projectId?: string`、`relatedProjectIds?: string[]`、`relatedProjects?: string[]`。
- 写入位置：卡片级 `projectId`、`relatedProjectIds`、`relatedProjects`（沿用现有 revision 结构，不改 revision 字段）。
- `query` 的摘要与 `getDetail` 输出上述字段。

- [ ] **Step 4: 接口层解析关联项目**

在 MCP `record-conclusion.ts` 与 HTTP `conclusionRoutes.ts` 中，写入前用 `deps.worklogService.getTree()` 构造 `name → id` 映射：

```ts
function resolveRelated(tree: WorklogData, names: string[] | undefined) {
  const ignored: string[] = [];
  const ids: string[] = [];
  const labels: string[] = [];
  for (const raw of names ?? []) {
    const name = raw.trim();
    if (!name) continue;
    const p = tree.projects.find((x) => x.name === name);
    if (!p) { ignored.push(name); continue; }
    ids.push(p.id);
    labels.push(p.name);
  }
  return { ids, labels, ignored };
}
```

主项目：`const owner = tree.projects.find((p) => p.name === project)`；`projectId = owner?.id`；找不到不报错。

- [ ] **Step 5: 跑测试并提交**

Run: `cd backend && npx vitest run src/application/conclusion src/interfaces`
Expected: PASS。

```bash
git add backend/src/application/conclusion backend/src/interfaces
git commit -m "feat(conclusion): projectId 与关联项目(未知项忽略)"
```

---

### Task 8: MCP 工具变更

**Files:**
- Modify: `backend/src/interfaces/mcp/tools/worklog/record-work.ts`
- Modify: `backend/src/interfaces/mcp/tools/worklog/query-work.ts`
- Modify: `backend/src/interfaces/mcp/tools/worklog/list-projects.ts`
- Modify: `backend/src/interfaces/mcp/tools/conclusion/record-conclusion.ts`
- Modify: `backend/src/interfaces/mcp/tools/conclusion/query-conclusions.ts`
- Modify: `shared/src/worklog/mcpToolCatalog.ts`
- Test: `backend/src/interfaces/mcp/tools/worklog/__tests__/*`（按现有测试文件补）

**Interfaces:**
- `record_work` 入参新增 `relatedProjects?: string[]`；`sourcePath` 由 handler 自动填 `process.cwd()`，不暴露给 AI。
- `list_projects` 输出路径尾段。

- [ ] **Step 1: 写失败测试**

在现有 worklog 工具测试中追加：

```ts
it('should pass cwd as sourcePath and return warnings', async () => {
  const res = await handle({ project: 'A', version: 'V1', title: 't', detail: 'd' }, deps);
  expect(res.isError).not.toBe(true);
  expect(worklogService.record).toHaveBeenCalledWith(
    expect.objectContaining({ sourcePath: process.cwd() }),
  );
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && npx vitest run src/interfaces/mcp/tools/worklog`
Expected: FAIL。

- [ ] **Step 3: 修改 record_work**

- schema 增加 `relatedProjects: { type: 'array', items: { type: 'string' }, description: '同时涉及的其他项目名称(可选)' }`。
- handler 传参：

```ts
      sourcePath: process.cwd(),
      relatedProjects: Array.isArray(args.relatedProjects) ? (args.relatedProjects as string[]) : undefined,
```

- 输出把 `result.warnings` 拼进返回文案。

- [ ] **Step 4: 修改 query_work / list_projects**

- `query_work` schema 加 `relatedProject`（名称），传 service。
- 输出 meta 行追加 `关联:${e.relatedProjects?.join(',')}`（有值时）。
- `list_projects` 输出改为：

```ts
  const tail = (p?: string) => p ? `…${p.split(/[\\/]/).slice(-2).join('\\')}` : '未绑定路径';
  // 每行: `- ${name} (${tail(paths?.[0])})`
```

- [ ] **Step 5: 更新 catalog 描述**

`shared/src/worklog/mcpToolCatalog.ts`：

- `record_work` 描述追加：「relatedProjects 传同时涉及的其他项目名；记录时自动带上当前工作目录用于路径归属」。
- `list_projects` 描述追加：「输出项目 id 与路径尾段，绑定路径请让用户在页面操作」。
- `query_work` 描述追加：「可按 relatedProject 过滤」。

- [ ] **Step 6: 构建与测试并提交**

Run: `npm run build:shared && cd backend && npx vitest run src/interfaces/mcp`
Expected: PASS。

```bash
git add backend/src/interfaces/mcp shared/src/worklog/mcpToolCatalog.ts
git commit -m "feat(mcp): 记录自动带路径与关联项目,列表输出路径尾段"
```

---

### Task 9: 迁移接入启动流程

**Files:**
- Modify: `backend/src/http-server.ts`（`startApp` 内，仓储创建后、`startHttpServer` 前）
- Test: 手动验证 + 现有 `server.test.ts` 不回归

- [ ] **Step 1: 接入**

```ts
  const { runProjectIdMigration } = await import('./application/migration/ProjectIdMigration.js');
  const migration = await runProjectIdMigration({
    dataDir,
    worklogRepo: worklogService['repo'], // 若为私有字段,改为把 repo 变量提升为局部常量并复用
    conclusionRepo: conclusionService['repo'],
  });
  if (migration.assignedIds || migration.duplicateNames.length) {
    console.log(`[migration] 补项目 id ${migration.assignedIds} 个` +
      (migration.duplicateNames.length ? `；重名项目: ${migration.duplicateNames.join(', ')}` : ''));
  }
```

> 推荐做法：在 `startApp` 中把 `new JsonWorklogRepository(...)` / `new JsonConclusionRepository(...)` 先赋给局部变量再注入 Service，迁移直接复用变量，不要访问私有字段。

- [ ] **Step 2: 验证幂等**

连续启动两次后端，第二次日志不出现补 id 输出；数据文件不变。

- [ ] **Step 3: 跑测试并提交**

Run: `cd backend && npx vitest run`
Expected: 全部 PASS。

```bash
git add backend/src/http-server.ts
git commit -m "feat(migration): HTTP 启动时执行项目 id 迁移"
```

---

### Task 10: 前端项目树（三态 + 路径绑定）

**Files:**
- Modify: `frontend/src/api/worklog.ts`
- Modify: `frontend/src/components/worklog/ProjectVersionTree.tsx`
- Create: `frontend/src/components/worklog/ProjectPathDialog.tsx`
- Test: `frontend/src/components/worklog/__tests__/projectTree.test.tsx`

**Interfaces:**
- `worklogApi.bindPaths(project: string, paths: string[])`
- `worklogApi.unbindPath(project: string, path: string)`
- 树节点 props：`project.paths`、`project.missingPaths?`

- [ ] **Step 1: 写失败测试**

```tsx
it('should show path tail and unbound state', () => {
  render(<ProjectVersionTree data={{ projects: [
    { id: 'p1', name: '资源加工平台', createdAt: 1, paths: ['D:\\xunfei\\资源加工平台'], versions: [] },
    { id: 'p2', name: '组卷', createdAt: 2, versions: [] },
  ] }} selection={{}} onSelect={() => {}} />);

  expect(screen.getByText(/xunfei\\资源加工平台/)).toBeTruthy();
  expect(screen.getByText('未绑定路径')).toBeTruthy();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd frontend && npx vitest run src/components/worklog/__tests__/projectTree.test.tsx`
Expected: FAIL。

- [ ] **Step 3: API**

在 `frontend/src/api/worklog.ts` 增加：

```ts
  bindPaths: (project: string, paths: string[]) =>
    http.put<{ ok: boolean }>(`/worklog/projects/${encodeURIComponent(project)}/paths`, { paths }),
  unbindPath: (project: string, path: string) =>
    http.delete<{ ok: boolean }>(
      `/worklog/projects/${encodeURIComponent(project)}/paths?path=${encodeURIComponent(path)}`,
    ),
```

- [ ] **Step 4: 树与弹窗**

- 节点第二行显示 `paths[0]` 的尾两段（`…\xunfei\资源加工平台`），无 paths 显示「未绑定路径」。
- 右键菜单增加「绑定路径…」，打开 `ProjectPathDialog`：textarea 每行一个路径，保存调 `bindPaths`，成功后 `refresh()`。
- 后端返回 `missingPaths` 时，节点路径标红 + title「路径不存在」。

- [ ] **Step 5: 跑测试并提交**

Run: `cd frontend && npm test`
Expected: PASS。

```bash
git add frontend/src/api/worklog.ts frontend/src/components/worklog
git commit -m "feat(ui): 项目树显示路径并可绑定/解绑"
```

---

### Task 11: 前端工作记录详情与筛选

**Files:**
- Modify: `frontend/src/components/worklog/EntryItem.tsx`
- Modify: `frontend/src/components/worklog/searchFilter.ts`
- Modify: `frontend/src/components/worklog/WorklogView.tsx`
- Test: `frontend/src/components/worklog/__tests__/searchFilter.test.ts`、`worklogComponents.test.tsx`

- [ ] **Step 1: 写失败测试**

```ts
it('should filter by related project', () => {
  const data: WorklogData = {
    projects: [{
      id: 'p_a', name: 'A', createdAt: 1,
      versions: [{
        name: 'V1', createdAt: 1,
        entries: [
          entry({ id: 'e1', title: '跨项目改动', detail: 'd', createdAt: 2, relatedProjects: ['题库'] }),
          entry({ id: 'e2', title: '普通改动', detail: 'd', createdAt: 1 }),
        ],
      }],
    }],
  };
  expect(filterEntries(data, { project: 'A' }, '', [], '题库').entries.map((e) => e.entry.id))
    .toEqual(['e1']);
  expect(filterEntries(data, { project: 'A' }, '', [], '题库2').entries).toHaveLength(0);
  // 不传关联项目 = 不过滤
  expect(filterEntries(data, { project: 'A' }, '', [])).toHaveLength(2);
});
```

> `entry()` 是现有测试文件里的条目工厂；`filterEntries` 第 5 参数为 `relatedProject?: string`，缺省 `undefined` 表示不过滤。

> `filterEntries` 签名扩展为 `(data, selection, keyword, stage, relatedProject?)`，默认 `''` 表示不过滤。

- [ ] **Step 2: 运行确认失败**

Run: `cd frontend && npx vitest run src/components/worklog/__tests__/searchFilter.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

- `searchFilter.ts`：增加 `relatedProject?: string` 参数，匹配 `entry.relatedProjects?.includes(...)`。
- `EntryItem`：元信息行显示 `关联: 题库` 徽标；`entry.pathUnmatched` 时显示「当前路径未归属项目」提示。
- `WorklogView`：工具条增加「关联项目」下拉（选项来自树里所有 `relatedProjects` 去重），与阶段筛选并列。
- 树节点「另有 N 条关联记录」：前端已有全树数据，本地统计即可，无需新接口：

```ts
  const relatedCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const project of data.projects) {
      for (const version of project.versions) {
        for (const entry of version.entries) {
          for (const id of entry.relatedProjectIds ?? []) {
            counts[id] = (counts[id] ?? 0) + 1;
          }
        }
      }
    }
    return counts;
  }, [data]);
```

把 `relatedCounts` 传给 `ProjectVersionTree`，节点在 `counts[project.id] > 0` 时显示弱提示，点击把该关联项目设为筛选值。

- [ ] **Step 4: 跑测试并提交**

Run: `cd frontend && npm test`
Expected: PASS。

```bash
git add frontend/src/components/worklog
git commit -m "feat(ui): 工作记录关联项目展示与筛选"
```

---

### Task 12: 前端结论卡关联项目与名称映射

**Files:**
- Modify: `frontend/src/components/conclusion/ConclusionView.tsx`
- Modify: `frontend/src/components/conclusion/ConclusionCardItem.tsx`
- Modify: `frontend/src/components/conclusion/ConclusionForm.tsx`
- Test: `frontend/src/components/conclusion/__tests__/*`

- [ ] **Step 1: 写失败测试**

```tsx
it('should render related projects on card', async () => {
  // mock conclusionApi.list 返回 relatedProjects: ['题库']
  expect(await screen.findByText(/关联.*题库/)).toBeTruthy();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd frontend && npx vitest run src/components/conclusion`
Expected: FAIL。

- [ ] **Step 3: 实现**

- `ConclusionView` 挂载时 `worklogApi.getTree()` 一次，构建 `id → name` 映射；卡片展示时优先用映射，失败用 `summary.project` 快照。
- `ConclusionCardItem`：元信息行追加关联项目徽标。
- `ConclusionForm`：新增「关联项目」多行输入（逗号分隔），提交 `relatedProjects`。
- 项目不存在时显示「项目已删除」弱提示，不阻塞编辑。
- 结论页空态补一句说明，避免用户误解为何结论卡不按目录归类：

```tsx
<p className="text-muted-foreground mt-2 text-xs">
  结论卡按会话归档，路径只用于展示；按项目路径归属的是工作记录。
</p>
```

- [ ] **Step 4: 跑测试并提交**

Run: `cd frontend && npm test`
Expected: PASS。

```bash
git add frontend/src/components/conclusion
git commit -m "feat(ui): 结论卡关联项目与项目名映射"
```

---

### Task 13: 端到端验证与收尾

**Files:**
- Modify: `README.md`（模块说明补路径与关联项目）
- Modify: `docs/mcp-registration.md`（构建版本）
- Modify: `.claude/CLAUDE.md`（数据模型与红线补充）

- [ ] **Step 1: 全量测试**

Run:
```bash
npm run build:shared
cd backend && npx vitest run
cd ../frontend && npm test
cd ../extension && npm test
```
Expected: 全绿。

- [ ] **Step 2: 实机验证**

```bash
npm run build
node cli/bin/ai-task-flow.js --no-open --port 47902
```

人工确认：

- [ ] 项目树显示路径尾段 / 未绑定
- [ ] 绑定路径后，在对应目录触发的记录自动归到该项目
- [ ] 跨项目记录在主项目下可见，关联徽标正确
- [ ] 结论卡关联项目展示与筛选
- [ ] 项目改名后结论卡显示新名称（靠 id 映射）

- [ ] **Step 3: 更新文档**

- `README.md`：模块表补「项目路径绑定」「关联项目」。
- `docs/mcp-registration.md`：dist 构建来源 commit 与时间。
- `.claude/CLAUDE.md`：数据模型段落补 `id/paths/sourcePath/relatedProjectIds`，红线补「路径绑定仅页面操作」。

- [ ] **Step 4: 提交**

```bash
git add README.md docs/mcp-registration.md .claude/CLAUDE.md
git commit -m "docs: 项目路径身份与关联项目说明"
```

---

## 任务依赖

```
Task 1 (纯函数) ─┬─> Task 4 (归属) ─> Task 5 (关联) ─> Task 6 (路径 CRUD)
Task 2 (类型)  ─┘                                     │
Task 3 (迁移) ─────────────────────────────────────────┴─> Task 9 (接入)
Task 7 (结论) ─> Task 12 (前端结论)
Task 8 (MCP)  ─> Task 11 (前端 worklog)
Task 10 (前端树) ─> Task 11 / Task 12
```

## 验收标准（全部满足才算完成）

1. 在 `D:\xunfei\资源加工平台\前端\rpp-web` 记录，自动归到已绑定该路径的项目；在 `...\搜题平台\...` 记录归到搜题平台（最长前缀）。
2. 路径未绑定时记录不丢，MCP 返回未归属提示，详情页可跳转绑定。
3. 关联项目拼错不丢记录，返回被忽略名单。
4. 结论卡改名后显示新名称，`conclusions.json` 未被 worklog 写入。
5. 迁移连续执行两次结果一致，重名项目有报告。
6. 后端 211+ / 前端 137+ 测试全绿，构建通过。
