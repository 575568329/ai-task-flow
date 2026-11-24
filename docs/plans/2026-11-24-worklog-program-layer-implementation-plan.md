# 建设主题层（主题→版本→需求→条目）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在工作记录顶层新增「建设主题」（澳门/大陆建设计划），版本归属主题，形成 主题→版本→需求→条目 四级结构。

**Architecture:** `WorklogData` 增加 `programs[]`，`WorklogVersion` 增加 `programId`；版本仍扁平存储，树渲染按 programId 分组。迁移 v2 从现有版本的「澳门底层数据建设」需求聚合出主题并回填 programId，保留同名需求。MCP 新增 `list_programs`，版本列表带主题名。

**Tech Stack:** TypeScript ESM(Node16)、Fastify、MCP SDK、React 19 + Vite、vitest。

## Global Constraints

- 中文注释与文案；Conventional Commits。
- ESM + Node16：相对 import 必须带 `.js`。
- 不引入新运行时依赖。
- 主题只能由用户页面创建；AI 不提供写接口。
- 版本必须归属已存在的主题。
- 迁移幂等、先备份；不删除任何条目。
- 每个任务结束跑对应测试；收尾跑全量。

---

### Task 1: shared 类型与主题纯函数

**Files:**
- Modify: `shared/src/types/worklog.ts`
- Create: `backend/src/domain/worklog/WorklogProgramTree.ts`
- Test: `backend/src/domain/worklog/__tests__/WorklogProgramTree.test.ts`

**Interfaces:**
- Produces:
  - `WorklogProgram { id; name; description?; createdAt }`
  - `WorklogData { projects; programs; versions }`
  - `WorklogVersion.programId: string`
  - `WorklogProgramCreateRequest { name; description? }`
  - `WorklogProgramSummary { id; name; versionCount; entryCount }`
  - `findProgram(data, programId): WorklogProgram | undefined`
  - `assertProgramNameFree(data, name, exceptId?): void`
  - `versionsOfProgram(data, programId): WorklogVersion[]`

- [ ] **Step 1: 写失败测试**

```ts
// backend/src/domain/worklog/__tests__/WorklogProgramTree.test.ts
import { describe, it, expect } from 'vitest';
import type { WorklogData } from '@ai-task-flow/shared';
import { findProgram, assertProgramNameFree, versionsOfProgram } from '../WorklogProgramTree.js';

const data: WorklogData = {
  projects: [],
  programs: [
    { id: 'g1', name: '澳门底层数据建设', createdAt: 1 },
    { id: 'g2', name: '大陆数据建设', createdAt: 2 },
  ],
  versions: [
    { id: 'v1', name: 'V8.0.8', programId: 'g1', createdAt: 1, requirements: [] },
    { id: 'v2', name: 'V8.0.9', programId: 'g1', createdAt: 2, requirements: [] },
    { id: 'v3', name: 'V1.0.0', programId: 'g2', createdAt: 3, requirements: [] },
  ],
};

describe('WorklogProgramTree', () => {
  it('finds program by id', () => {
    expect(findProgram(data, 'g1')?.name).toBe('澳门底层数据建设');
  });
  it('lists versions of a program', () => {
    expect(versionsOfProgram(data, 'g1').map((v) => v.name)).toEqual(['V8.0.8', 'V8.0.9']);
  });
  it('rejects duplicate program name', () => {
    expect(() => assertProgramNameFree(data, '澳门底层数据建设')).toThrow(/已存在/);
    expect(() => assertProgramNameFree(data, '澳门底层数据建设', 'g1')).not.toThrow();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && npx vitest run src/domain/worklog/__tests__/WorklogProgramTree.test.ts`
Expected: FAIL。

- [ ] **Step 3: 改类型**

```ts
// shared/src/types/worklog.ts
export interface WorklogProgram {
  id: string;
  /** 全局唯一,如「澳门底层数据建设」 */
  name: string;
  description?: string;
  createdAt: number;
}

export interface WorklogData {
  projects: WorklogProject[];
  /** 建设主题(顶层) */
  programs: WorklogProgram[];
  /** 版本扁平存储,通过 programId 归属主题 */
  versions: WorklogVersion[];
}

export interface WorklogVersion {
  id: string;
  name: string;
  /** 所属主题 id */
  programId: string;
  description?: string;
  createdAt: number;
  requirements: WorklogRequirement[];
}

export interface WorklogProgramCreateRequest {
  name: string;
  description?: string;
}

/** 版本创建:必须归属已存在的主题 */
export interface WorklogVersionCreateRequest {
  name: string;
  programId: string;
  description?: string;
}

export interface WorklogProgramSummary {
  id: string;
  name: string;
  versionCount: number;
  entryCount: number;
}
```

- [ ] **Step 4: 实现纯函数**

```ts
// backend/src/domain/worklog/WorklogProgramTree.ts
import type { WorklogData, WorklogProgram, WorklogVersion } from '@ai-task-flow/shared';
import { WorklogConflictError } from './errors.js';

export function findProgram(data: WorklogData, programId: string): WorklogProgram | undefined {
  return data.programs?.find((p) => p.id === programId);
}

export function assertProgramNameFree(data: WorklogData, name: string, exceptId?: string): void {
  if ((data.programs ?? []).some((p) => p.name === name && p.id !== exceptId)) {
    throw new WorklogConflictError(`主题名 "${name}" 已存在`);
  }
}

export function versionsOfProgram(data: WorklogData, programId: string): WorklogVersion[] {
  return data.versions.filter((v) => v.programId === programId);
}
```

- [ ] **Step 5: 构建与测试**

Run: `npm run build:shared && cd backend && npx vitest run src/domain/worklog/__tests__/WorklogProgramTree.test.ts`
Expected: PASS。全量会因旧数据无 `programs` 而失败，属预期（Task 2/3 修复）。

- [ ] **Step 6: 提交**

```bash
git add shared/src/types/worklog.ts backend/src/domain/worklog/WorklogProgramTree.ts backend/src/domain/worklog/__tests__/WorklogProgramTree.test.ts
git commit -m "feat(worklog): 新增建设主题类型与树纯函数"
```

---

### Task 2: WorklogService 主题 CRUD 与版本归属

**Files:**
- Modify: `backend/src/application/worklog/WorklogService.ts`
- Test: `backend/src/application/worklog/__tests__/WorklogProgram.test.ts`

**Interfaces:**
- Produces:
  - `createProgram(input): Promise<{ id }>`
  - `renameProgram(id, name): Promise<void>`
  - `deleteProgram(id): Promise<void>`（级联版本/需求/条目，备份）
  - `createVersion` 入参增加必填 `programId`
  - `getTree` 返回 `programs`
  - `listPrograms()`（供 MCP）

- [ ] **Step 1: 写失败测试**

```ts
it('creates a program and a version under it', async () => {
  const g = await service.createProgram({ name: '澳门底层数据建设' });
  expect(g.id).toMatch(/^g_/);
  const v = await service.createVersion({ name: 'V8.0.8', programId: g.id });
  const tree = await service.getTree();
  expect(tree.versions.find((x) => x.id === v.id)?.programId).toBe(g.id);
});

it('rejects version with unknown program', async () => {
  await expect(service.createVersion({ name: 'V1', programId: 'g_nope' }))
    .rejects.toThrow(/主题 .* 不存在/);
});

it('deletes program with versions and backs up', async () => {
  const g = await service.createProgram({ name: 'G' });
  await service.createVersion({ name: 'V', programId: g.id });
  await service.deleteProgram(g.id);
  const tree = await service.getTree();
  expect(tree.programs.find((p) => p.id === g.id)).toBeUndefined();
  expect(tree.versions).toHaveLength(0);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && npx vitest run src/application/worklog -t "program"`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
  async createProgram(input: WorklogProgramCreateRequest): Promise<{ id: string }> {
    const name = validateName(input.name, '主题名');
    return this.repo.mutate((data) => {
      data.programs ??= [];
      assertProgramNameFree(data, name);
      const id = `g_${nanoid(8)}`;
      data.programs.push({
        id, name, ...(input.description ? { description: input.description } : {}),
        createdAt: Date.now(),
      });
      return { id };
    }, { backup: true });
  }

  async deleteProgram(id: string): Promise<void> {
    await this.repo.mutate((data) => {
      const program = findProgram(data, id);
      if (!program) throw new WorklogNotFoundError(`主题 ${id} 不存在`);
      const versionIds = new Set(versionsOfProgram(data, id).map((v) => v.id));
      data.versions = data.versions.filter((v) => !versionIds.has(v.id));
      data.programs = data.programs.filter((p) => p.id !== id);
    }, { backup: true });
  }
```

`createVersion` 增加 `programId` 校验（`findProgram`，不存在抛 `WorklogNotFoundError` 并列出候选主题）；`getTree` 确保 `programs: data.programs ?? []`；`listPrograms` 汇总版本数/条目数。

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && npx vitest run src/application/worklog`
Expected: PASS（旧的 createVersion 测试需补 programId，属本任务改写）。

- [ ] **Step 5: 提交**

```bash
git add backend/src/application/worklog
git commit -m "feat(worklog): 建设主题 CRUD 与版本归属"
```

---

### Task 3: 迁移 v2 提升主题

**Files:**
- Modify: `backend/src/application/migration/VersionTreeMigration.ts`
- Test: `backend/src/application/migration/__tests__/VersionTreeMigration.test.ts`

**Interfaces:**
- Produces: `migrateProgramLayer(data): { data; report }`，幂等（已有 `programs` 且所有版本有 `programId` 则跳过）。

- [ ] **Step 1: 写失败测试**

```ts
it('promotes 澳门底层数据建设 requirement to a program and keeps the requirement', () => {
  const migrated = {
    projects: [],
    versions: [
      { id: 'v1', name: 'V8.0.8', createdAt: 1, requirements: [
        { id: 'r1', title: '澳门底层数据建设', createdAt: 1, entries: [] },
      ] },
      { id: 'v2', name: 'V8.0.9', createdAt: 2, requirements: [
        { id: 'r2', title: '澳门底层数据建设', createdAt: 2, entries: [] },
      ] },
    ],
  } as unknown as WorklogData;
  const { data, report } = migrateProgramLayer(migrated);
  expect(data.programs).toHaveLength(1);
  expect(data.programs[0].name).toBe('澳门底层数据建设');
  expect(data.versions.every((v) => v.programId === data.programs[0].id)).toBe(true);
  // 同名需求保留
  expect(data.versions[0].requirements[0].title).toBe('澳门底层数据建设');
  expect(report.programsCreated).toBe(1);
});

it('is idempotent', () => {
  const once = migrateProgramLayer(migrated).data;
  const twice = migrateProgramLayer(once).data;
  expect(twice).toEqual(once);
});
```

- [ ] **Step 2: 实现**

```ts
export function migrateProgramLayer(data: WorklogData): { data: WorklogData; report: ProgramMigrationReport } {
  const report: ProgramMigrationReport = { programsCreated: 0, versionsAssigned: 0 };
  if ((data.programs?.length ?? 0) > 0 && data.versions.every((v) => v.programId)) {
    return { data, report };
  }
  const programs = [...(data.programs ?? [])];
  const byName = new Map(programs.map((p) => [p.name, p]));
  const defaultName = '未分类建设';
  const versions = data.versions.map((version) => {
    const target = version.requirements.find((r) => r.title === '澳门底层数据建设')?.title ?? defaultName;
    let program = byName.get(target);
    if (!program) {
      program = { id: `g_${nanoid(8)}`, name: target, createdAt: Date.now() };
      byName.set(target, program);
      programs.push(program);
      report.programsCreated += 1;
    }
    report.versionsAssigned += 1;
    return { ...version, programId: program.id };
  });
  return { data: { ...data, programs, versions }, report };
}
```

执行器 `runProgramLayerMigration` 照抄 v1：锁 + 标记 `.migration-program-layer.json`（原子写）+ `mutate({ backup: true })`。

- [ ] **Step 3: 接入 `startApp`**（在 v1 迁移之后）

- [ ] **Step 4: 测试与提交**

Run: `cd backend && npx vitest run src/application/migration`
Expected: PASS。

```bash
git add backend/src/application/migration backend/src/http-server.ts
git commit -m "feat(migration): 旧数据提升建设主题层"
```

---

### Task 4: MCP list_programs 与主题名输出

**Files:**
- Create: `backend/src/interfaces/mcp/tools/worklog/list-programs.ts`
- Modify: `backend/src/interfaces/mcp/tools/worklog/list-versions.ts`
- Modify: `backend/src/interfaces/mcp/tools/worklog/index.ts`
- Modify: `backend/src/interfaces/mcp/tools/index.ts`
- Modify: `shared/src/worklog/mcpToolCatalog.ts`
- Test: `backend/src/interfaces/mcp/tools/worklog/__tests__/worklog-tools.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('lists programs with ids and counts', async () => {
  const g = await deps.worklogService.createProgram({ name: '澳门底层数据建设' });
  const res = await listPrograms({}, deps);
  expect(text(res)).toContain('澳门底层数据建设');
  expect(text(res)).toContain(g.id);
});

it('lists versions filtered by programId and shows program name', async () => {
  const res = await listVersions({ programId: g.id }, deps);
  expect(text(res)).toContain('澳门底层数据建设');
});
```

- [ ] **Step 2: 实现**

`list_programs` 输出：

```
- 澳门底层数据建设 (g_ab12cd34) · 版本 2 · 条目 20
```

`list_versions` 增加可选 `programId`，每行带主题名：

```
- V8.0.8 (v_xxx) · 澳门底层数据建设 · 需求 1 · 条目 20
```

- [ ] **Step 3: 注册与 catalog**

`ALL_TOOLS`/`HANDLERS` 15；catalog 增加 `list_programs`，`list_versions` 描述补「可按 programId 过滤、输出主题名」。

- [ ] **Step 4: 冒烟与提交**

工具数 14 → 15（`tests/mcp/conclusion-stdio-smoke.mjs` 同步）。

Run: `npm run build:shared && cd backend && npx vitest run src/interfaces/mcp && npm run build`
Expected: PASS。

```bash
git add backend/src/interfaces/mcp shared/src/worklog/mcpToolCatalog.ts tests/mcp
git commit -m "feat(mcp): 新增 list_programs，版本输出主题"
```

---

### Task 5: 前端四层树与主题入口

**Files:**
- Modify: `frontend/src/api/worklog.ts`
- Modify: `frontend/src/components/worklog/VersionRequirementTree.tsx`
- Modify: `frontend/src/components/worklog/WorklogView.tsx`
- Create: `frontend/src/components/worklog/ProgramDialog.tsx`
- Create: `frontend/src/components/worklog/DeleteProgramDialog.tsx`
- Test: `frontend/src/components/worklog/__tests__/programTree.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
it('renders program → version → requirement', () => {
  render(<VersionRequirementTree data={data} selection={{}} onSelect={() => {}} />);
  expect(screen.getByText('澳门底层数据建设')).toBeTruthy();
  expect(screen.getByText('V8.0.8')).toBeTruthy();
  expect(screen.getByText('需求A')).toBeTruthy();
});
```

- [ ] **Step 2: 实现**

- `worklogApi.createProgram/renameProgram/deleteProgram`，`createVersion` 带 `programId`。
- 树：主题行（名称、复制 id、版本数）→ 版本行 → 需求行。
- 主题行右键：「新建版本」「重命名」「删除主题」。
- 侧栏顶部「新建主题」；版本创建弹窗必须选主题。
- `selection` 仍为 `{ versionId, requirementId }`（主题不参与选中，只做分组）。
- 删除主题用 `DeleteProgramDialog`（输入主题名确认，文案说明级联删除）。

- [ ] **Step 3: 测试与提交**

Run: `cd frontend && npm test && npm run build`
Expected: PASS。

```bash
git add frontend/src
git commit -m "feat(ui): 工作记录树增加建设主题层"
```

---

### Task 6: 全量验证与文档

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

- [ ] **Step 2: 迁移演练（临时数据目录）**

复制真实 `worklog.json` 到临时目录 → 设置 `AI_TASK_FLOW_DATA_DIR` 启动 → 验证：
- 生成 1 个主题「澳门底层数据建设」；
- 10 个版本全部 `programId` 指向它；
- 每个版本的同名需求保留；
- 条目数仍 67；
- 二次启动跳过。

- [ ] **Step 3: 文档**

- README：模型改为 主题→版本→需求→条目；工具数 15。
- CLAUDE.md：工具清单 15、数据模型、迁移 v2 标记。
- mcp-registration：版本与工具数。

- [ ] **Step 4: 提交**

```bash
git add README.md .claude/CLAUDE.md docs/mcp-registration.md
git commit -m "docs: 建设主题层模型与 MCP 说明"
```

---

## 依赖与验收

```
Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6
```

**验收**：树显示 主题→版本→需求；旧数据全部归入「澳门底层数据建设」；条目 67 不变；MCP 15 工具；全量测试与构建通过。
