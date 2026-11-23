# 工作记录重构（版本→需求→条目）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把工作记录从「项目→版本→条目」重构为「版本→需求→条目」，项目降为条目属性；同步给知识库加上版本/需求/项目/阶段元数据与多视图。

**Architecture:** `worklog.json` 顶层改为 `versions[]`，版本下挂需求，需求下挂条目；`projects[]` 保留为名称/id/路径字典。版本与需求**只能由用户在页面创建**，AI 通过 `versionId`/`requirementId` 写入。旧数据按版本名归并，每个版本生成一个「澳门底层数据建设」需求。知识库文档用 frontmatter 软关联，树支持多视图。

**Tech Stack:** TypeScript ESM(Node16)、Fastify、MCP SDK、React 19 + Vite、vitest、proper-lockfile、nanoid。

## Global Constraints

- 中文注释与文案；提交信息用 Conventional Commits。
- ESM + Node16：相对 import 必须带 `.js` 后缀。
- 不引入新运行时依赖（nanoid、proper-lockfile、write-file-atomic 已在依赖）。
- 版本/需求 **不提供 MCP 写接口**；AI 只能写用户指定的 id。
- 所有破坏性写入走 `mutate(..., { backup: true })`。
- 迁移幂等；迁移前备份；标记文件原子写。
- 路径/项目能力（`paths`、`sourcePath`、`relatedProjects`）保持不变。
- 前端不引入 router；视图 keep-alive 机制不变。
- 每个任务结束跑对应测试；每期结束跑全量。

---

## 第一期：数据模型与迁移

### Task 1: shared 类型重构

**Files:**
- Modify: `shared/src/types/worklog.ts`
- Test: `backend/src/application/worklog/__tests__/types.smoke.test.ts`（新建，类型级断言）

**Interfaces:**
- Produces：后续任务逐字依赖的类型与字段名
  - `WorklogData { projects: WorklogProject[]; versions: WorklogVersion[] }`
  - `WorklogVersion { id; name; description?; createdAt; requirements: WorklogRequirement[] }`
  - `WorklogRequirement { id; title; description?; projects?: string[]; projectIds?: string[]; createdAt; entries: WorklogEntry[] }`
  - `WorklogVersionCreateRequest { name; description? }`
  - `WorklogRequirementCreateRequest { versionId; title; description?; projects?: string[] }`
  - `WorklogRecordRequest { versionId; requirementId; title; detail; stage; project?; relatedProjects?; files?; diff?; tags?; sourcePath? }`
  - `WorklogQueryRequest { entryId?; versionId?; requirementId?; project?; keyword?; relatedProject?; tags?; stage?; dateFrom?; dateTo?; limit?; includeDiff? }`
  - `WorklogVersionSummary { id; name; requirementCount; entryCount; firstDate?; lastDate? }`
  - `WorklogRequirementSummary { id; versionId; title; projects?: string[]; entryCount }`
  - `WorklogEntry` 保留现有字段，新增 `project?`、`projectId?`
- Removes：`WorklogData.projects[].versions`（`WorklogProject` 只保留 `id/name/paths/missingPaths/createdAt`）

- [ ] **Step 1: 写类型级测试**

```ts
// backend/src/application/worklog/__tests__/types.smoke.test.ts
import { describe, it, expect } from 'vitest';
import type { WorklogData, WorklogVersion, WorklogRequirement } from '@ai-task-flow/shared';

describe('worklog types', () => {
  it('supports version → requirement → entry shape', () => {
    const data: WorklogData = {
      projects: [{ id: 'p_1', name: 'A', createdAt: 1 }],
      versions: [{
        id: 'v_1', name: 'V8.0.8', createdAt: 1,
        requirements: [{
          id: 'r_1', title: '澳门底层数据建设', createdAt: 1,
          entries: [{
            id: 'e_1', title: 't', detail: 'd', date: '2026-11-23',
            createdAt: 1, updatedAt: 1, project: 'A', projectId: 'p_1',
          }],
        }],
      }],
    };
    const version: WorklogVersion = data.versions[0];
    const requirement: WorklogRequirement = version.requirements[0];
    expect(requirement.entries[0].projectId).toBe('p_1');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && npx vitest run src/application/worklog/__tests__/types.smoke.test.ts`
Expected: FAIL（`versions` 不在 WorklogData 上）。

- [ ] **Step 3: 改类型**

```ts
// shared/src/types/worklog.ts（替换 WorklogProject/WorklogData，新增 Version/Requirement）
export interface WorklogProject {
  id: string;
  name: string;
  paths?: string[];
  missingPaths?: string[];
  createdAt: number;
}

export interface WorklogVersion {
  id: string;
  /** 全局唯一,如 V8.0.8 */
  name: string;
  description?: string;
  createdAt: number;
  requirements: WorklogRequirement[];
}

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

export interface WorklogData {
  /** 项目字典:路径归属与项目筛选用,不再作为树根 */
  projects: WorklogProject[];
  /** 顶层组织:版本 → 需求 → 条目 */
  versions: WorklogVersion[];
}
```

`WorklogEntry` 增加：

```ts
  /** 本条实际改动的项目(路径归属或显式传入) */
  project?: string;
  projectId?: string;
```

`WorklogRecordRequest` 替换为：

```ts
export interface WorklogRecordRequest {
  versionId: string;
  requirementId: string;
  title: string;
  detail: string;
  stage: WorkStage;
  project?: string;
  relatedProjects?: string[];
  files?: WorklogEntryFile[];
  diff?: string;
  tags?: string[];
  sourcePath?: string;
}
```

`WorklogQueryRequest` 增加 `versionId?`、`requirementId?`（保留其余）。
新增四个 summary/create 类型（见 Interfaces）。

- [ ] **Step 4: 构建并跑测试**

Run: `npm run build:shared && cd backend && npx vitest run src/application/worklog/__tests__/types.smoke.test.ts`
Expected: PASS。此时全量测试会大面积失败（旧代码仍用旧结构），属预期，下一任务修复。

- [ ] **Step 5: 提交**

```bash
git add shared/src/types/worklog.ts backend/src/application/worklog/__tests__/types.smoke.test.ts
git commit -m "refactor(shared): 工作记录类型改为 版本→需求→条目"
```

---

### Task 2: 树查找与校验纯函数

**Files:**
- Create: `backend/src/domain/worklog/WorklogTree.ts`
- Test: `backend/src/domain/worklog/__tests__/WorklogTree.test.ts`

**Interfaces:**
- Consumes: Task 1 类型
- Produces:
  - `findVersion(data, versionId): WorklogVersion | undefined`
  - `findRequirement(version, requirementId): WorklogRequirement | undefined`
  - `findEntryLocation(data, entryId): { version; requirement; entry } | undefined`
  - `assertVersionNameFree(data, name, exceptId?): void`（重名抛 `WorklogConflictError`）
  - `assertRequirementTitleFree(version, title, exceptId?): void`

- [ ] **Step 1: 写失败测试**

```ts
// backend/src/domain/worklog/__tests__/WorklogTree.test.ts
import { describe, it, expect } from 'vitest';
import type { WorklogData } from '@ai-task-flow/shared';
import { findEntryLocation, assertVersionNameFree } from '../WorklogTree.js';

const data: WorklogData = {
  projects: [],
  versions: [
    { id: 'v1', name: 'V8.0.8', createdAt: 1, requirements: [
      { id: 'r1', title: '需求A', createdAt: 1, entries: [
        { id: 'e1', title: 't', detail: 'd', date: 'd', createdAt: 1, updatedAt: 1 },
      ] },
    ] },
  ],
};

describe('WorklogTree', () => {
  it('finds entry with its version and requirement', () => {
    const found = findEntryLocation(data, 'e1');
    expect(found?.version.id).toBe('v1');
    expect(found?.requirement.id).toBe('r1');
  });
  it('returns undefined for unknown entry', () => {
    expect(findEntryLocation(data, 'nope')).toBeUndefined();
  });
  it('rejects duplicate version name', () => {
    expect(() => assertVersionNameFree(data, 'V8.0.8')).toThrow(/已存在/);
    expect(() => assertVersionNameFree(data, 'V8.0.8', 'v1')).not.toThrow();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && npx vitest run src/domain/worklog/__tests__/WorklogTree.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// backend/src/domain/worklog/WorklogTree.ts
import type { WorklogData, WorklogVersion, WorklogRequirement, WorklogEntry } from '@ai-task-flow/shared';
import { WorklogConflictError } from './errors.js';

export function findVersion(data: WorklogData, versionId: string): WorklogVersion | undefined {
  return data.versions.find((v) => v.id === versionId);
}

export function findRequirement(
  version: WorklogVersion,
  requirementId: string,
): WorklogRequirement | undefined {
  return version.requirements.find((r) => r.id === requirementId);
}

export function findEntryLocation(
  data: WorklogData,
  entryId: string,
): { version: WorklogVersion; requirement: WorklogRequirement; entry: WorklogEntry } | undefined {
  for (const version of data.versions) {
    for (const requirement of version.requirements) {
      const entry = requirement.entries.find((e) => e.id === entryId);
      if (entry) return { version, requirement, entry };
    }
  }
  return undefined;
}

export function assertVersionNameFree(data: WorklogData, name: string, exceptId?: string): void {
  if (data.versions.some((v) => v.name === name && v.id !== exceptId)) {
    throw new WorklogConflictError(`版本名 "${name}" 已存在`);
  }
}

export function assertRequirementTitleFree(
  version: WorklogVersion,
  title: string,
  exceptId?: string,
): void {
  if (version.requirements.some((r) => r.title === title && r.id !== exceptId)) {
    throw new WorklogConflictError(`需求 "${title}" 在版本 ${version.name} 中已存在`);
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && npx vitest run src/domain/worklog/__tests__/WorklogTree.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/src/domain/worklog/WorklogTree.ts backend/src/domain/worklog/__tests__/WorklogTree.test.ts
git commit -m "feat(worklog): 版本/需求树查找与唯一性校验"
```

---

### Task 3: WorklogService 版本/需求 CRUD

**Files:**
- Modify: `backend/src/application/worklog/WorklogService.ts`
- Test: `backend/src/application/worklog/__tests__/WorklogService.test.ts`

**Interfaces:**
- Consumes: `WorklogTree` 函数、`WorklogRepository`
- Produces:
  - `createVersion(input: WorklogVersionCreateRequest): Promise<{ id: string }>`
  - `renameVersion(id, name): Promise<void>`
  - `deleteVersion(id): Promise<void>`
  - `createRequirement(input: WorklogRequirementCreateRequest): Promise<{ id: string }>`
  - `renameRequirement(versionId, requirementId, title): Promise<void>`
  - `deleteRequirement(versionId, requirementId): Promise<void>`
  - `getTree(): Promise<WorklogData>`（含 `missingPaths`）
  - `getProjectRefs(): Promise<Array<{ id: string; name: string; paths?: string[] }>>`

- [ ] **Step 1: 写失败测试（节选核心用例）**

```ts
it('creates a version and a requirement, with unique ids', async () => {
  const v = await service.createVersion({ name: 'V8.0.8', description: '澳门迭代' });
  expect(v.id).toMatch(/^v_/);
  const r = await service.createRequirement({ versionId: v.id, title: '澳门底层数据建设', projects: ['题库'] });
  expect(r.id).toMatch(/^r_/);
  const tree = await service.getTree();
  expect(tree.versions[0].requirements[0].title).toBe('澳门底层数据建设');
});

it('rejects duplicate version name and duplicate requirement title', async () => {
  await service.createVersion({ name: 'V1' });
  await expect(service.createVersion({ name: 'V1' })).rejects.toThrow(/已存在/);
  const v = await service.createVersion({ name: 'V2' });
  await service.createRequirement({ versionId: v.id, title: 'R' });
  await expect(service.createRequirement({ versionId: v.id, title: 'R' })).rejects.toThrow(/已存在/);
});

it('rejects unknown project when creating requirement', async () => {
  const v = await service.createVersion({ name: 'V3' });
  await expect(service.createRequirement({ versionId: v.id, title: 'R', projects: ['不存在'] }))
    .rejects.toThrow(/项目不存在/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && npx vitest run src/application/worklog -t "version"`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
  async createVersion(input: WorklogVersionCreateRequest): Promise<{ id: string }> {
    const name = validateName(input.name, '版本名');
    return this.repo.mutate((data) => {
      assertVersionNameFree(data, name);
      const id = `v_${nanoid(8)}`;
      data.versions.push({
        id, name, ...(input.description ? { description: input.description } : {}),
        createdAt: Date.now(), requirements: [],
      });
      return { id };
    }, { backup: true });
  }

  async createRequirement(input: WorklogRequirementCreateRequest): Promise<{ id: string }> {
    const title = validateName(input.title, '需求名');
    return this.repo.mutate((data) => {
      const version = findVersion(data, input.versionId);
      if (!version) throw new WorklogNotFoundError(`版本 ${input.versionId} 不存在`);
      assertRequirementTitleFree(version, title);
      const projects: string[] = [];
      const projectIds: string[] = [];
      for (const name of input.projects ?? []) {
        const project = data.projects.find((p) => p.name === name);
        if (!project) throw new WorklogValidationError(`项目不存在:${name}`);
        projects.push(project.name);
        projectIds.push(project.id);
      }
      const id = `r_${nanoid(8)}`;
      version.requirements.push({
        id, title, createdAt: Date.now(), entries: [],
        ...(projects.length ? { projects, projectIds } : {}),
      });
      return { id };
    }, { backup: true });
  }
```

`deleteVersion` 删除整个版本；`renameVersion` 校验重名；`deleteRequirement` 删除需求及其条目；`getTree` 复用现有 `missingPaths` 逻辑；`getProjectRefs` 从 `data.projects` 投影。

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && npx vitest run src/application/worklog`
Expected: 新用例 PASS；旧用例因模型变更失败（Task 4 修复）。

- [ ] **Step 5: 提交**

```bash
git add backend/src/application/worklog
git commit -m "feat(worklog): 版本/需求 CRUD 与树读取"
```

---

### Task 4: 记录/更新/查询适配新模型

**Files:**
- Modify: `backend/src/application/worklog/WorklogService.ts`
- Test: `backend/src/application/worklog/__tests__/WorklogService.test.ts`

**Interfaces:**
- Consumes: `findVersion` / `findRequirement` / `findEntryLocation`
- Produces:
  - `record(input: WorklogRecordRequest): Promise<WorklogRecordResponse>`（要求 versionId/requirementId 已存在）
  - `update(entryId, patch)`：跨树查找条目
  - `deleteEntry(entryId)`：跨树删除
  - `query(input)`：支持 versionId / requirementId / project / stage / relatedProject / keyword / 日期

- [ ] **Step 1: 写失败测试**

```ts
it('records into an existing version and requirement', async () => {
  const v = await service.createVersion({ name: 'V8.0.8' });
  const r = await service.createRequirement({ versionId: v.id, title: 'R' });
  const res = await service.record({
    versionId: v.id, requirementId: r.id, title: '改动', detail: 'd', stage: 'dev',
  });
  expect(res.entryId).toMatch(/^e_/);
  const tree = await service.getTree();
  expect(tree.versions[0].requirements[0].entries).toHaveLength(1);
});

it('rejects unknown ids with actionable message', async () => {
  await expect(service.record({
    versionId: 'v_nope', requirementId: 'r_nope', title: 't', detail: 'd', stage: 'dev',
  })).rejects.toThrow(/版本 .* 不存在/);
});

it('rejects requirement that does not belong to the version', async () => {
  const v1 = await service.createVersion({ name: 'V1' });
  const v2 = await service.createVersion({ name: 'V2' });
  const r1 = await service.createRequirement({ versionId: v1.id, title: 'R' });
  await expect(service.record({
    versionId: v2.id, requirementId: r1.id, title: 't', detail: 'd', stage: 'dev',
  })).rejects.toThrow(/不属于该版本/);
});

it('queries by versionId and project', async () => {
  const v1 = await service.createVersion({ name: 'V1' });
  const v2 = await service.createVersion({ name: 'V2' });
  const r1 = await service.createRequirement({ versionId: v1.id, title: 'R1' });
  const r2 = await service.createRequirement({ versionId: v2.id, title: 'R2' });
  await service.record({ versionId: v1.id, requirementId: r1.id, title: 'a', detail: 'd', stage: 'dev', project: 'P' });
  await service.record({ versionId: v2.id, requirementId: r2.id, title: 'b', detail: 'd', stage: 'dev', project: 'P' });

  const byVersion = await service.query({ versionId: v1.id });
  expect(byVersion.map((e) => e.title)).toEqual(['a']);

  const byRequirement = await service.query({ requirementId: r2.id });
  expect(byRequirement.map((e) => e.title)).toEqual(['b']);
});
```

> 若项目中尚无 `WorklogNotFoundError`，在 `backend/src/domain/worklog/errors.ts` 按现有错误类写法新增（`httpStatus = 404`）；否则复用 `WorklogValidationError`，并把测试断言改为对应文案。

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && npx vitest run src/application/worklog -t "records into"`
Expected: FAIL。

- [ ] **Step 3: 实现 record**

```ts
  async record(input: WorklogRecordRequest): Promise<WorklogRecordResponse> {
    const title = validateName(input.title, '标题');
    if (!input.detail?.trim()) throw new WorklogValidationError('详细说明不能为空');
    const stage = validateStage(input.stage);
    return this.repo.mutate(async (data) => {
      const version = findVersion(data, input.versionId);
      if (!version) throw new WorklogNotFoundError(`版本 ${input.versionId} 不存在，请让用户在页面创建并复制 id`);
      const requirement = findRequirement(version, input.requirementId);
      if (!requirement) {
        throw new WorklogNotFoundError(
          `需求 ${input.requirementId} 不存在或不属于该版本，请让用户在页面创建并复制 id`,
        );
      }
      // 路径归属(保留原逻辑)
      const normalizedSource = input.sourcePath?.trim()
        ? await resolveMatchPath(input.sourcePath.trim()) : undefined;
      const refs = data.projects.filter((p) => p.id)
        .flatMap((p) => (p.paths ?? []).map((pth) => ({ projectId: p.id, path: pth })));
      const ownerId = normalizedSource ? findOwningProject(refs, normalizedSource) : undefined;
      const ownerProject = ownerId ? data.projects.find((p) => p.id === ownerId) : undefined;
      const explicitProject = input.project
        ? data.projects.find((p) => p.name === input.project) : undefined;
      if (input.project && !explicitProject) {
        throw new WorklogValidationError(`项目不存在:${input.project}`);
      }
      const effective = ownerProject ?? explicitProject;

      const now = Date.now();
      const entry: WorklogEntry = {
        id: newEntryId(), title, detail: String(input.detail), date: localDate(),
        createdAt: now, updatedAt: now, stage,
      };
      if (effective) { entry.project = effective.name; entry.projectId = effective.id; }
      if (normalizedSource) {
        entry.sourcePath = input.sourcePath!.trim();
        if (!ownerProject) entry.pathUnmatched = true;
      }
      if (input.files) entry.files = input.files;
      if (input.diff) entry.diff = input.diff;
      if (input.tags?.length) entry.tags = input.tags.map((t) => t.trim()).filter(Boolean);
      const related = resolveRelated(data, input.relatedProjects);
      if (related.ids.length) {
        entry.relatedProjectIds = related.ids;
        entry.relatedProjects = related.labels;
      }
      requirement.entries.push(entry);

      const warnings: string[] = [];
      if (related.ignored.length) warnings.push(`以下关联项目不存在，已忽略：${related.ignored.join(', ')}`);
      if (normalizedSource && !ownerProject && data.projects.some((p) => p.paths?.length)) {
        warnings.push('当前路径未归属任何项目，可在页面绑定路径');
      }
      return {
        entryId: entry.id,
        path: `${version.name}/${requirement.title}/${entry.id}`,
        ...(warnings.length ? { warnings } : {}),
      };
    });
  }
```

`update`/`deleteEntry` 用 `findEntryLocation` 定位；`query` 遍历 `versions → requirements → entries`，支持 `versionId`、`requirementId`、`project`、`stage`、`relatedProject`、`keyword`、日期，结果带 `versionName`、`requirementTitle`。

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && npx vitest run src/application/worklog`
Expected: PASS（旧用例需按新模型改写，改写属于本任务）。

- [ ] **Step 5: 提交**

```bash
git add backend/src/application/worklog
git commit -m "feat(worklog): 记录/查询适配 版本→需求→条目"
```

---

### Task 5: 迁移服务

**Files:**
- Create: `backend/src/application/migration/VersionTreeMigration.ts`
- Test: `backend/src/application/migration/__tests__/VersionTreeMigration.test.ts`

**Interfaces:**
- Produces:
  - `migrateToVersionTree(data: WorklogData): { data: WorklogData; report: VersionMigrationReport }`
  - `interface VersionMigrationReport { versionsCreated: number; requirementsCreated: number; entriesMoved: number; duplicateVersionNames: string[] }`
  - `runVersionTreeMigration({ dataDir, worklogRepo }): Promise<VersionMigrationReport & { skipped: boolean }>`

- [ ] **Step 1: 写失败测试**

```ts
it('merges same version names across projects and keeps every entry', () => {
  const legacy = {
    projects: [
      { id: 'p1', name: '资源加工平台', createdAt: 1, versions: [
        { name: 'V8.0.8', createdAt: 1, entries: [entry('e1'), entry('e2')] },
      ] },
      { id: 'p2', name: '组卷', createdAt: 2, versions: [
        { name: 'V8.0.8', createdAt: 2, entries: [entry('e3')] },
      ] },
    ],
  } as unknown as WorklogData;
  const { data, report } = migrateToVersionTree(legacy);
  expect(data.versions).toHaveLength(1);
  expect(data.versions[0].requirements).toHaveLength(1);
  expect(data.versions[0].requirements[0].title).toBe('澳门底层数据建设');
  expect(data.versions[0].requirements[0].entries).toHaveLength(3);
  expect(data.versions[0].requirements[0].entries.map((e) => e.project))
    .toEqual(['资源加工平台', '资源加工平台', '组卷']);
  expect(report.entriesMoved).toBe(3);
});

it('is idempotent', () => {
  const once = migrateToVersionTree(legacy).data;
  const twice = migrateToVersionTree(once).data;
  expect(twice).toEqual(once);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && npx vitest run src/application/migration -t "merges"`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
export function migrateToVersionTree(data: WorklogData): { data: WorklogData; report: VersionMigrationReport } {
  const report: VersionMigrationReport = {
    versionsCreated: 0, requirementsCreated: 0, entriesMoved: 0, duplicateVersionNames: [],
  };
  if (data.versions?.length) return { data, report }; // 已迁移，幂等

  const byName = new Map<string, WorklogVersion>();
  for (const project of data.projects) {
    const legacyVersions = (project as WorklogProject & {
      versions?: Array<{ name: string; entries: WorklogEntry[] }>;
    }).versions ?? [];
    for (const legacy of legacyVersions) {
      let version = byName.get(legacy.name);
      if (!version) {
        version = {
          id: `v_${nanoid(8)}`, name: legacy.name, createdAt: Date.now(),
          requirements: [],
        };
        byName.set(legacy.name, version);
        report.versionsCreated += 1;
      }
      let requirement = version.requirements[0];
      if (!requirement) {
        requirement = {
          id: `r_${nanoid(8)}`, title: '澳门底层数据建设', createdAt: Date.now(), entries: [],
        };
        version.requirements.push(requirement);
        report.requirementsCreated += 1;
      }
      for (const legacyEntry of legacy.entries) {
        const entry = { ...legacyEntry };
        entry.project = project.name;
        entry.projectId = project.id;
        requirement.entries.push(entry);
        report.entriesMoved += 1;
      }
    }
  }
  const projects = data.projects.map(({ versions: _drop, ...rest }) => rest) as WorklogProject[];
  return {
    data: { projects, versions: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)) },
    report,
  };
}
```

`runVersionTreeMigration`：锁 + 标记 `.migration-version-tree.json`（原子写）+ `mutate(..., { backup: true })`，幂等；风格照抄 `ProjectIdMigration.ts`。

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && npx vitest run src/application/migration`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/src/application/migration
git commit -m "feat(migration): 旧记录按版本归并为 版本→需求→条目"
```

---

### Task 6: 迁移接入启动 + 后端全量修复

**Files:**
- Modify: `backend/src/http-server.ts`
- Modify: `backend/src/interfaces/http/routes/worklogRoutes.ts`（CRUD 路由适配）
- Test: 现有后端测试按新模型修复

- [ ] **Step 1: 接入**

在现有 `ProjectIdMigration` 之后、`startHttpServer` 之前：

```ts
  try {
    const vReport = await runVersionTreeMigration({ dataDir, worklogRepo: worklogRepository });
    if (!vReport.skipped && (vReport.versionsCreated || vReport.entriesMoved)) {
      console.log(`[migration] 版本归并 ${vReport.versionsCreated} 个、条目 ${vReport.entriesMoved} 条`);
    }
  } catch (error) {
    console.error('[migration] 版本归并失败（不阻塞启动）:', error);
  }
```

- [ ] **Step 2: 适配 HTTP 路由**

`worklogRoutes.ts` 替换旧语义路由：

```
GET    /api/worklog                     → getTree()
POST   /api/worklog/versions            → createVersion
POST   /api/worklog/versions/:id/rename → renameVersion
DELETE /api/worklog/versions/:id        → deleteVersion
POST   /api/worklog/requirements        → createRequirement
POST   /api/worklog/requirements/:id/rename → renameRequirement
DELETE /api/worklog/requirements/:id    → deleteRequirement
POST   /api/worklog/entries             → record
PUT    /api/worklog/entries/:id         → update
DELETE /api/worklog/entries/:id         → deleteEntry
PUT/DELETE /api/worklog/projects/:name/paths （保留）
```

- [ ] **Step 3: 修复全部后端测试**

Run: `cd backend && npx vitest run`
Expected: 所有用例按新模型改写后 PASS。

- [ ] **Step 4: 构建**

Run: `cd backend && npm run build`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend
git commit -m "feat(worklog): 迁移接入启动并适配 HTTP 路由"
```

---

## 第二期：MCP 与前端主树

### Task 7: MCP record_work / query_work 新签名

**Files:**
- Modify: `backend/src/interfaces/mcp/tools/worklog/record-work.ts`
- Modify: `backend/src/interfaces/mcp/tools/worklog/query-work.ts`
- Modify: `shared/src/worklog/mcpToolCatalog.ts`
- Test: `backend/src/interfaces/mcp/tools/worklog/__tests__/worklog-tools.test.ts`

**Interfaces:**
- `record_work` schema 必填：`versionId`、`requirementId`、`title`、`detail`、`stage`；可选 `project`、`relatedProjects`、`files`、`diff`、`tags`。
- `query_work` 增加 `versionId`、`requirementId`；输出带版本/需求名称。

- [ ] **Step 1: 写失败测试**

```ts
it('rejects unknown version id with actionable message', async () => {
  const res = await handle({
    versionId: 'v_nope', requirementId: 'r_nope', title: 't', detail: 'd', stage: 'dev',
  }, deps);
  expect(res.isError).toBe(true);
  expect(text(res)).toContain('请让用户在页面创建并复制 id');
});

it('records into given ids and echoes version/requirement', async () => {
  const v = await deps.worklogService.createVersion({ name: 'V1' });
  const r = await deps.worklogService.createRequirement({ versionId: v.id, title: 'R' });
  const res = await handle({
    versionId: v.id, requirementId: r.id, title: 't', detail: 'd', stage: 'dev',
  }, deps);
  expect(res.isError).not.toBe(true);
  expect(text(res)).toContain('V1');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && npx vitest run src/interfaces/mcp/tools/worklog`
Expected: FAIL。

- [ ] **Step 3: 改 schema 与 handler**

```ts
// record-work.ts inputSchema
properties: {
  versionId: { type: 'string', description: '版本 id(如 v_ab12cd34),由用户在页面创建后复制' },
  requirementId: { type: 'string', description: '需求 id(如 r_ab12cd34),由用户在页面创建后复制' },
  title: { type: 'string', description: '一句话功能点' },
  detail: { type: 'string', description: '结构化详细说明' },
  stage: { ...STAGE_SCHEMA },
  project: { type: 'string', description: '本次实际改动的项目名(可选,不传按路径归属)' },
  relatedProjects: { type: 'array', items: { type: 'string' }, description: '同时涉及的其他项目名称(可选)' },
  files: { ... },
  diff: { type: 'string' },
  tags: { type: 'array', items: { type: 'string' } },
},
required: ['versionId', 'requirementId', 'title', 'detail', 'stage'],
```

handler 传 `sourcePath: process.cwd()`，其余透传；输出追加 warnings。

- [ ] **Step 4: 更新 catalog 描述**

`record_work` 描述开头加：「版本与需求必须由用户在页面创建，AI 只传 id；**不要尝试创建或猜名称**。id 不存在时会报错并列出可选值。」
`query_work` 描述加：支持 `versionId` / `requirementId` 过滤。

- [ ] **Step 5: 运行并提交**

Run: `npm run build:shared && cd backend && npx vitest run src/interfaces/mcp`
Expected: PASS。

```bash
git add backend/src/interfaces/mcp shared/src/worklog/mcpToolCatalog.ts
git commit -m "feat(mcp): record_work 改用 versionId/requirementId"
```

---

### Task 8: list_versions / list_requirements

**Files:**
- Create: `backend/src/interfaces/mcp/tools/worklog/list-versions.ts`
- Create: `backend/src/interfaces/mcp/tools/worklog/list-requirements.ts`
- Modify: `backend/src/interfaces/mcp/tools/worklog/index.ts`
- Modify: `backend/src/interfaces/mcp/tools/index.ts`
- Modify: `shared/src/worklog/mcpToolCatalog.ts`
- Test: `backend/src/interfaces/mcp/tools/worklog/__tests__/worklog-tools.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('lists versions with ids and counts', async () => {
  const v = await deps.worklogService.createVersion({ name: 'V8.0.8' });
  await deps.worklogService.createRequirement({ versionId: v.id, title: 'R' });
  const res = await listVersions({}, deps);
  expect(text(res)).toContain('V8.0.8');
  expect(text(res)).toContain(v.id);
});

it('lists requirements for a version', async () => {
  const res = await listRequirements({ versionId: v.id }, deps);
  expect(text(res)).toContain('R');
  expect(text(res)).toContain(r.id);
});
```

- [ ] **Step 2: 实现**

`list_versions` 输出：

```
- V8.0.8 (v_ab12cd34) · 需求 2 · 条目 15 · 2026-11-01~2026-11-20
```

`list_requirements` 输出：

```
- 澳门底层数据建设 (r_ef56gh78) · 关联: 题库,组卷 · 条目 11
```

- [ ] **Step 3: 注册工具**

`ALL_TOOLS` 与 `HANDLERS` 增加两项；catalog 增加两条描述，强调「只读，用于获取 id」。

- [ ] **Step 4: 冒烟测试同步**

`tests/mcp/conclusion-stdio-smoke.mjs` 断言工具数 12 → 14（若该脚本断言数量）。

- [ ] **Step 5: 运行并提交**

Run: `cd backend && npx vitest run src/interfaces/mcp && npm run build`
Expected: PASS。

```bash
git add backend/src/interfaces/mcp shared/src/worklog/mcpToolCatalog.ts tests/mcp
git commit -m "feat(mcp): 新增 list_versions/list_requirements"
```

---

### Task 9: 前端树改造为 版本→需求→条目

**Files:**
- Rename/Modify: `frontend/src/components/worklog/ProjectVersionTree.tsx` → `VersionRequirementTree.tsx`
- Modify: `frontend/src/components/worklog/WorklogView.tsx`
- Modify: `frontend/src/api/worklog.ts`
- Test: `frontend/src/components/worklog/__tests__/versionTree.test.tsx`

**Interfaces:**
- `worklogApi.getTree()` 返回新结构
- `worklogApi.createVersion/renameVersion/deleteVersion/createRequirement/renameRequirement/deleteRequirement`
- 树 props：`data: WorklogData`、`selection: { versionId?; requirementId? }`

- [ ] **Step 1: 写失败测试**

```tsx
const data: WorklogData = {
  projects: [{ id: 'p1', name: '资源加工平台', createdAt: 1 }],
  versions: [{
    id: 'v_1', name: 'V8.0.8', createdAt: 1,
    requirements: [{
      id: 'r_1', title: '澳门底层数据建设', projects: ['资源加工平台'], createdAt: 1,
      entries: [{
        id: 'e1', title: 't', detail: 'd', date: '2026-11-23',
        createdAt: 1, updatedAt: 1, project: '资源加工平台',
      }],
    }],
  }],
};

it('renders version → requirement tree with copyable ids', () => {
  render(<VersionRequirementTree data={data} selection={{}} onSelect={() => {}} />);
  expect(screen.getByText('V8.0.8')).toBeTruthy();
  expect(screen.getByText('澳门底层数据建设')).toBeTruthy();
  expect(screen.getByTitle('复制 v_1')).toBeTruthy();
});
```

- [ ] **Step 2: 实现树**

- 版本行：名称 + 复制 id + 展开箭头 + 需求数/条目数。
- 需求行：标题 + 复制 id + 关联项目徽标 + 条目数。
- 选中需求 → 右栏展示该需求下条目。
- 保留 `missingPaths` 的项目相关展示（项目筛选下拉处）。

- [ ] **Step 3: 改 WorklogView**

- 左树换新组件；右栏标题显示「版本 / 需求」。
- 新建按钮改「新建版本」；需求行右键「新建需求」。
- 移除旧「项目 / 版本」树逻辑与 `ProjectVersionTree` 引用。

- [ ] **Step 4: 运行并提交**

Run: `cd frontend && npm test`
Expected: PASS（旧树测试改写或删除）。

```bash
git add frontend/src/components/worklog frontend/src/api/worklog.ts
git commit -m "feat(ui): 工作记录树改为 版本→需求→条目"
```

---

### Task 10: 新建版本/需求与删除确认

**Files:**
- Create: `frontend/src/components/worklog/VersionDialog.tsx`
- Create: `frontend/src/components/worklog/DeleteVersionDialog.tsx`
- Create: `frontend/src/components/worklog/RequirementDialog.tsx`
- Modify: `frontend/src/components/worklog/VersionRequirementTree.tsx`
- Test: `frontend/src/components/worklog/__tests__/versionDialogs.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VersionDialog } from '../VersionDialog';
import { DeleteVersionDialog } from '../DeleteVersionDialog';

vi.mock('@/api/worklog', () => ({
  worklogApi: {
    createVersion: vi.fn(async () => ({ id: 'v_new' })),
    deleteVersion: vi.fn(async () => undefined),
  },
}));
vi.mock('@/components/ui/toaster', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('version dialogs', () => {
  it('creates a version and shows a copyable id', async () => {
    render(<VersionDialog open onClose={() => {}} onCreated={() => {}} />);
    fireEvent.change(screen.getByLabelText('版本名'), { target: { value: 'V8.0.9' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(await screen.findByText('v_new')).toBeTruthy();
    expect(screen.getByTitle('复制 v_new')).toBeTruthy();
  });

  it('requires typing the version name before delete', () => {
    render(<DeleteVersionDialog open versionName="V8.0.8" onClose={() => {}} onConfirm={() => {}} />);
    const confirm = screen.getByRole('button', { name: '确认删除' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('输入版本名确认'), { target: { value: 'V8.0.8' } });
    expect(confirm).toBeEnabled();
  });
});
```

- [ ] **Step 2: 实现**

- `VersionDialog`：名称 + 描述；提交后直接展示 `id` 与「复制」。
- `RequirementDialog`：标题 + 关联项目多选；提交后展示 `r_xxx` 与「复制」。
- 删除版本：输入版本名确认；删除需求：普通二次确认。

- [ ] **Step 3: 运行并提交**

Run: `cd frontend && npm test && npm run build`
Expected: PASS。

```bash
git add frontend/src/components/worklog
git commit -m "feat(ui): 版本/需求创建与强确认删除"
```

---

### Task 11: 筛选适配与组件回归

**Files:**
- Modify: `frontend/src/components/worklog/searchFilter.ts`
- Modify: `frontend/src/components/worklog/WorklogView.tsx`
- Test: `frontend/src/components/worklog/__tests__/searchFilter.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
const entry = (id: string, over: Partial<WorklogEntry> = {}): WorklogEntry => ({
  id, title: id, detail: 'd', date: '2026-11-23', createdAt: 1, updatedAt: 1, ...over,
});

const data: WorklogData = {
  projects: [{ id: 'p1', name: 'P', createdAt: 1 }],
  versions: [
    { id: 'v1', name: 'V1', createdAt: 1, requirements: [
      { id: 'r1', title: 'R1', createdAt: 1, entries: [entry('e1'), entry('e2')] },
      { id: 'r2', title: 'R2', createdAt: 1, entries: [entry('e3')] },
    ] },
    { id: 'v2', name: 'V2', createdAt: 1, requirements: [
      { id: 'r3', title: 'R3', createdAt: 1, entries: [entry('e4')] },
    ] },
  ],
};

it('filters entries by versionId and requirementId', () => {
  expect(filterEntries(data, { versionId: 'v1' }, '', [], undefined, '')
    .entries.map((e) => e.entry.id)).toEqual(['e1', 'e2', 'e3']);
  expect(filterEntries(data, { versionId: 'v1', requirementId: 'r2' }, '', [], undefined, '')
    .entries.map((e) => e.entry.id)).toEqual(['e3']);
});
```

- [ ] **Step 2: 实现**

`filterEntries(data, selection, keyword, stage, relatedProject, project)`：
- `selection.versionId` / `requirementId` 定位子树；
- 项目 / 阶段 / 关联 / 关键字叠加过滤；
- 无选择且无关键字 → 空（保持“默认不加载全部”）。

**需求范围外改动提示**（设计 §2.2）：选中需求时，计算该需求下条目的 `project` 集合与需求 `projects` 的差集；非空时在右栏标题下显示一行弱提示：

```tsx
{outsideProjects.length > 0 && (
  <p className="text-muted-foreground mt-1 text-xs">
    存在范围外改动：{outsideProjects.join('、')}
  </p>
)}
```

并在 `searchFilter.test.ts` 增加一条纯函数用例 `getOutsideProjects(requirement)`，覆盖「条目项目 ⊆ 需求范围」与「存在差集」两种情况。

- [ ] **Step 3: 运行并提交**

Run: `cd frontend && npm test && npm run build`
Expected: PASS。

```bash
git add frontend/src/components/worklog
git commit -m "feat(ui): 工作记录筛选适配版本/需求"
```

---

## 第三期：知识库

### Task 12: 知识库合并导入

**Files:**
- Create: `backend/src/application/knowledge/KnowledgeImportService.ts`
- Modify: `backend/src/http-server.ts`（启动时可选执行，或提供 HTTP 端点）
- Test: `backend/src/application/knowledge/__tests__/KnowledgeImportService.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { nanoid } from 'nanoid';

it('copies files and keeps both copies on conflict', async () => {
  const root = path.join(os.tmpdir(), `kimp-${nanoid()}`);
  const sourceDir = path.join(root, 'src');
  const targetDir = path.join(root, 'dst');
  await fs.mkdir(path.join(sourceDir, '技术方案'), { recursive: true });
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(path.join(sourceDir, '技术方案', 'a.md'), '# src a');
  await fs.writeFile(path.join(sourceDir, '技术方案', 'b.md'), '# src b');
  await fs.mkdir(path.join(targetDir, '技术方案'), { recursive: true });
  await fs.writeFile(path.join(targetDir, '技术方案', 'a.md'), '# existing a');

  const report = await importKnowledge({ sourceDir, targetDir });
  expect(report.copied).toBe(2);
  expect(report.conflicts).toHaveLength(1);
  expect(report.conflicts[0].renamedTo).toContain('-imported');
  const files = await fs.readdir(path.join(targetDir, '技术方案'));
  expect(files).toContain('a.md');
  expect(files.some((f) => f.startsWith('a-imported'))).toBe(true);
  await fs.rm(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: 实现**

- 递归复制 `./knowledge-base` → `resolveDataDir()/knowledge-base`；
- 同名写入 `<name>-imported<ext>`；
- 返回 `{ copied, conflicts: [{ from, to }] }`；
- 不删除源目录。

- [ ] **Step 3: 接入**

提供 `POST /api/knowledge/import`（仅本地调用），返回报告；页面知识库设置里提供按钮。

- [ ] **Step 4: 运行并提交**

Run: `cd backend && npx vitest run src/application/knowledge`
Expected: PASS。

```bash
git add backend/src/application/knowledge backend/src/interfaces/http/routes/knowledgeRoutes.ts
git commit -m "feat(knowledge): 一次性导入孤儿知识库并防覆盖"
```

---

### Task 13: 知识库元数据与 save_to_knowledge

**Files:**
- Modify: `backend/src/application/knowledge/KnowledgeService.ts`
- Modify: `backend/src/interfaces/mcp/tools/save-to-knowledge.ts`
- Modify: `shared/src/types/knowledge.ts`
- Test: `backend/src/application/knowledge/__tests__/KnowledgeService.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('writes version/requirement/project/stage into frontmatter', async () => {
  await service.saveDoc({
    title: '设计', content: '# x', dir: '技术方案',
    versionId: 'v_1', requirementId: 'r_1', projectId: 'p_1', stage: 'design',
  });
  const doc = await service.getDoc('技术方案/设计.md');
  expect(doc.frontmatter.versionId).toBe('v_1');
  expect(doc.frontmatter.stage).toBe('design');
});
```

- [ ] **Step 2: 实现**

- `KnowledgeDocMeta` 增加可选 `versionId/requirementId/projectId/stage`；
- 写入 frontmatter；读取时解析；
- `save_to_knowledge` schema 增加四个可选参数，「关联 id 不存在时降级为不写并提示」。

- [ ] **Step 3: 运行并提交**

Run: `cd backend && npx vitest run src/application/knowledge src/interfaces/mcp`
Expected: PASS。

```bash
git add backend/src/application/knowledge backend/src/interfaces/mcp/tools/save-to-knowledge.ts shared/src/types/knowledge.ts
git commit -m "feat(knowledge): 文档元数据支持版本/需求/项目/阶段"
```

---

### Task 14: 知识库多视图

**Files:**
- Modify: `frontend/src/components/knowledge/KnowledgeTree.tsx`
- Modify: `frontend/src/components/knowledge/useKnowledgeStore.ts`（或对应 store）
- Test: `frontend/src/components/knowledge/__tests__/knowledgeViews.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('groups docs by version and shows unlinked bucket', () => {
  const groups = groupDocsByView(docs, 'version');
  expect(groups[0].name).toBe('V8.0.8');
  expect(groups.some((g) => g.name === '未关联')).toBe(true);
});
```

- [ ] **Step 2: 实现**

- 新增纯函数 `groupDocsByView(docs, view: 'category' | 'version' | 'project' | 'stage')`；
- 树顶部视图切换（单选，localStorage 记忆）；
- 每个视图显示「已关联 N / 未关联 M」；
- 分类视图保持现有目录树。

- [ ] **Step 3: 运行并提交**

Run: `cd frontend && npm test && npm run build`
Expected: PASS。

```bash
git add frontend/src/components/knowledge
git commit -m "feat(ui): 知识库支持按分类/版本/项目/阶段多视图"
```

---

## 收尾

### Task 15: 全量验证与文档

**Files:**
- Modify: `README.md`、`.claude/CLAUDE.md`、`docs/mcp-registration.md`

- [ ] **Step 1: 全量测试与构建**

```bash
npm run build:shared
cd backend && npx vitest run
cd ../frontend && npm test
cd ../extension && npm test
cd .. && npm run build
```

- [ ] **Step 2: 迁移验证（临时数据目录）**

复制真实 `worklog.json` 到临时目录，启动后端，确认：
- 同名版本归并数量正确；
- 每个版本有「澳门底层数据建设」需求；
- 条目总数不变；
- 连续启动两次数据不变。

- [ ] **Step 3: 文档**

- README：模型改为 版本→需求→条目，说明「版本/需求由用户建，AI 传 id」。
- `.claude/CLAUDE.md`：MCP 签名、工具数 14、迁移标记文件、回滚约束。
- `docs/mcp-registration.md`：当前版本 commit + 构建时间 + 工具数。

- [ ] **Step 4: 提交**

```bash
git add README.md .claude/CLAUDE.md docs/mcp-registration.md
git commit -m "docs: 版本→需求→条目 模型与 MCP 变更说明"
```

---

## 依赖与验收

```
Task 1 ─> Task 2 ─> Task 3 ─> Task 4 ─> Task 5 ─> Task 6
                                        └─> Task 7 ─> Task 8
Task 6 ─> Task 9 ─> Task 10 ─> Task 11
Task 12 ─> Task 13 ─> Task 14
Task 11 + 14 ─> Task 15
```

**一期验收**：后端测试全绿；迁移后树结构正确、条目数不变。
**二期验收**：MCP 新签名可用；页面可建版本/需求并复制 id，AI 能写入指定 id。
**三期验收**：知识库合并无覆盖；多视图可切换；文档元数据可写可读。
