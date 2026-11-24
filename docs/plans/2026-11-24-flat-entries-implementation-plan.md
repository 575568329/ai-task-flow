# 取消需求层（主题→版本→条目）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除需求层，条目直接挂在版本下，模型简化为 主题 → 版本 → 条目。

**Architecture:** `WorklogVersion` 用 `entries[]` 取代 `requirements[]`；删除需求相关类型、CRUD、MCP 工具与前端组件。迁移 v3 把每个版本下所有需求的条目合并到版本。知识库停止写入/展示 `requirementId`（历史字段保留）。

**Tech Stack:** TypeScript ESM(Node16)、Fastify、MCP SDK、React 19 + Vite、vitest。

## Global Constraints

- 中文注释与文案；Conventional Commits。
- ESM + Node16：相对 import 必须带 `.js`。
- 不引入新运行时依赖。
- 条目数守恒：迁移不删除条目。
- 迁移幂等、先备份、标记原子写。
- 每个任务跑对应测试；收尾全量 + curl E2E。

---

### Task 1: shared 类型扁平化

**Files:**
- Modify: `shared/src/types/worklog.ts`
- Test: `backend/src/application/worklog/__tests__/types.smoke.test.ts`

**Interfaces:**
- Produces:
  - `WorklogVersion { id; name; programId; description?; createdAt; entries: WorklogEntry[] }`
  - `WorklogRecordRequest { versionId; title; detail; stage; project?; relatedProjects?; files?; diff?; tags?; sourcePath? }`
  - `WorklogQueryRequest { versionId?; project?; ... }`（无 requirementId）
  - `WorklogQueryResultEntry { versionName; ... }`（无 requirementTitle）
- Removes: `WorklogRequirement`、`WorklogRequirementCreateRequest`、`WorklogRequirementSummary`

- [ ] **Step 1: 改类型并更新 smoke 测试**

```ts
const version: WorklogVersion = {
  id: 'v1', name: 'V8.0.8', programId: 'g1', createdAt: 1,
  entries: [{ id: 'e1', title: 't', detail: 'd', date: '2026-11-24', createdAt: 1, updatedAt: 1 }],
};
expect(version.entries[0].id).toBe('e1');
```

- [ ] **Step 2: 构建并跑 smoke**

Run: `npm run build:shared && cd backend && npx vitest run src/application/worklog/__tests__/types.smoke.test.ts`
Expected: PASS；全量会大面积失败（预期）。

- [ ] **Step 3: 提交**

```bash
git add shared/src/types/worklog.ts backend/src/application/worklog/__tests__/types.smoke.test.ts
git commit -m "refactor(shared): 版本直接持有条目，移除需求类型"
```

---

### Task 2: WorklogService 扁平化

**Files:**
- Modify: `backend/src/application/worklog/WorklogService.ts`
- Modify: `backend/src/domain/worklog/WorklogTree.ts`
- Test: `backend/src/application/worklog/__tests__/*`

**Interfaces:**
- Produces:
  - `findEntryLocation(data, entryId): { version; entry } | undefined`
  - `record` 只要求 `versionId`
  - `query` 遍历 `versions[].entries`
  - 删除 `createRequirement` / `renameRequirement` / `deleteRequirement`
- Removes: `assertRequirementTitleFree`

- [ ] **Step 1: 改树查找**

```ts
export function findEntryLocation(data, entryId) {
  for (const version of data.versions) {
    const entry = (version.entries ?? []).find((e) => e.id === entryId);
    if (entry) return { version, entry };
  }
  return undefined;
}
```

- [ ] **Step 2: 改服务**

`record` 写入 `version.entries`；`query` 两层遍历；`update`/`deleteEntry` 用新 `findEntryLocation`；删除三个需求方法及其测试；`listVersions` 输出去掉需求数。

- [ ] **Step 3: 跑测试**

Run: `cd backend && npx vitest run src/application/worklog`
Expected: PASS（测试按新模型改写）。

- [ ] **Step 4: 提交**

```bash
git add backend/src/application/worklog backend/src/domain/worklog
git commit -m "refactor(worklog): 服务层移除需求层级"
```

---

### Task 3: 迁移 v3（条目提升）

**Files:**
- Modify: `backend/src/application/migration/VersionTreeMigration.ts`
- Test: `backend/src/application/migration/__tests__/VersionTreeMigration.test.ts`

**Interfaces:**
- Produces: `migrateFlatEntries(data): { data; report }`，幂等（无 `requirements` 字段则跳过）。

- [ ] **Step 1: 写失败测试**

```ts
it('merges requirement entries into version and drops requirements', () => {
  const data = {
    projects: [], programs: [],
    versions: [
      { id: 'v1', name: 'V1', programId: 'g1', createdAt: 1, requirements: [
        { id: 'r1', title: 'A', createdAt: 1, entries: [e1, e2] },
        { id: 'r2', title: 'B', createdAt: 2, entries: [e3] },
      ] },
    ],
  } as unknown as WorklogData;
  const { data: out, report } = migrateFlatEntries(data);
  expect(out.versions[0].entries.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  expect((out.versions[0] as any).requirements).toBeUndefined();
  expect(report.entriesMerged).toBe(3);
});
```

- [ ] **Step 2: 实现**

```ts
export function migrateFlatEntries(data: WorklogData): { data: WorklogData; report: FlatEntryReport } {
  const report: FlatEntryReport = { entriesMerged: 0 };
  let changed = false;
  const versions = data.versions.map((version) => {
    const legacy = (version as WorklogVersion & {
      requirements?: Array<{ entries?: WorklogEntry[] }>;
    }).requirements;
    if (!legacy) return version;
    changed = true;
    const entries = legacy.flatMap((r) => r.entries ?? []);
    report.entriesMerged += entries.length;
    const { requirements: _drop, ...rest } = version as WorklogVersion & { requirements?: unknown };
    return { ...rest, entries } as WorklogVersion;
  });
  return { data: changed ? { ...data, versions } : data, report };
}
```

执行器 `runFlatEntriesMigration`：锁 + `.migration-flat-entries.json` + `mutate({ backup: true })`，幂等；接入 `startApp`（v2 之后）。

- [ ] **Step 3: 测试与提交**

Run: `cd backend && npx vitest run src/application/migration`
Expected: PASS（含条目守恒、幂等、二次跳过）。

```bash
git add backend/src/application/migration backend/src/http-server.ts backend/src/config/dataDir.ts
git commit -m "feat(migration): 需求条目提升到版本"
```

---

### Task 4: MCP 移除需求

**Files:**
- Modify: `backend/src/interfaces/mcp/tools/worklog/record-work.ts`
- Modify: `backend/src/interfaces/mcp/tools/worklog/query-work.ts`
- Modify: `backend/src/interfaces/mcp/tools/worklog/list-versions.ts`
- Delete: `backend/src/interfaces/mcp/tools/worklog/list-requirements.ts`
- Modify: `backend/src/interfaces/mcp/tools/worklog/index.ts`
- Modify: `backend/src/interfaces/mcp/tools/index.ts`
- Modify: `shared/src/worklog/mcpToolCatalog.ts`
- Test: `backend/src/interfaces/mcp/tools/worklog/__tests__/worklog-tools.test.ts`
- Test: `tests/mcp/conclusion-stdio-smoke.mjs`（工具数 15 → 14）

- [ ] **Step 1: 改工具**

- `record_work` schema 删除 `requirementId`，`required` 去掉它；handler 不再传。
- `query_work` 删除 `requirementId`；输出去掉需求名。
- `list_versions` 输出去掉需求数。
- 删除 `list_requirements` 文件、注册与 catalog 条目。
- catalog 的 `record_work` 描述改为「版本必须由用户创建，AI 只传 versionId」。

- [ ] **Step 2: 修复测试并全量跑**

Run: `npm run build:shared && cd backend && npx vitest run`
Expected: 全绿。

- [ ] **Step 3: 构建与提交**

Run: `cd backend && npm run build`

```bash
git add backend/src/interfaces/mcp shared/src/worklog/mcpToolCatalog.ts tests/mcp
git commit -m "feat(mcp): 移除需求参数与 list_requirements"
```

---

### Task 5: 前端两层树

**Files:**
- Modify: `frontend/src/api/worklog.ts`
- Modify: `frontend/src/components/worklog/VersionRequirementTree.tsx`（改名 `ProgramVersionTree.tsx` 可选）
- Modify: `frontend/src/components/worklog/WorklogView.tsx`
- Modify: `frontend/src/components/worklog/NewEntryForm.tsx`
- Delete: `frontend/src/components/worklog/RequirementDialog.tsx`
- Modify: `frontend/src/components/conclusion`（无）
- Test: `frontend/src/components/worklog/__tests__/*`

- [ ] **Step 1: 改前端**

- api 删除需求方法；`createVersion` 不变。
- 树：主题 → 版本；版本行复制 id、右键重命名/删除；删除需求行与新建需求入口。
- `selection` 改为 `{ versionId? }`。
- `NewEntryForm` 只选版本。
- `searchFilter` 去掉 `requirementId`；删除 `getOutsideProjects` 与范围外提示（依赖需求范围）。
- 删除 `RequirementDialog` 及需求相关测试。

- [ ] **Step 2: 跑测试与构建**

Run: `cd frontend && npm test && npm run build`
Expected: PASS。

- [ ] **Step 3: 提交**

```bash
git add frontend/src
git commit -m "feat(ui): 工作记录树简化为 主题→版本"
```

---

### Task 6: 知识库移除需求关联

**Files:**
- Modify: `backend/src/interfaces/mcp/tools/save-to-knowledge.ts`
- Modify: `backend/src/application/knowledge/KnowledgeService.ts`
- Modify: `backend/src/interfaces/http/routes/knowledgeRoutes.ts`
- Modify: `frontend/src/components/knowledge/KnowledgeViewer.tsx`
- Modify: `frontend/src/components/knowledge/KnowledgeTree.tsx`
- Test: 对应测试

- [ ] **Step 1: 改写入/展示**

- `save_to_knowledge` schema 删除 `requirementId`；解析逻辑去掉需求校验。
- `KnowledgeFrontmatter.requirementId` 保留（兼容旧数据），但不再写入。
- 前端「编辑关联」去掉需求下拉；按版本视图的二级分组去掉需求层，直接 版本 → 文档。
- `groupDocsByView` 的 version 视图去掉需求分组。

- [ ] **Step 2: 跑测试与提交**

Run: `cd backend && npx vitest run src/application/knowledge src/interfaces/mcp`；`cd frontend && npm test`
Expected: PASS。

```bash
git add backend/src frontend/src
git commit -m "feat(knowledge): 移除需求关联写入与展示"
```

---

### Task 7: 全量验证与文档

**Files:**
- Modify: `README.md`、`.claude/CLAUDE.md`、`docs/mcp-registration.md`、`tests/curl/test_worklog_api.sh`

- [ ] **Step 1: 全量测试与构建**

```bash
npm run build:shared
cd backend && npx vitest run
cd ../frontend && npm test
cd ../extension && npm test
cd .. && npm run build
```

- [ ] **Step 2: curl E2E**

临时数据目录启动后端，更新脚本（去掉需求步骤）并实跑。

- [ ] **Step 3: 迁移演练**

复制真实 `worklog.json` 到临时目录，验证：主题不变、10 版本、条目 68 守恒、需求字段消失、二次跳过。

- [ ] **Step 4: 文档**

- README/CLAUDE：模型三层（主题→版本→条目），工具 14，迁移标记第三个。
- mcp-registration：工具 14、版本。

- [ ] **Step 5: 提交**

```bash
git add README.md .claude/CLAUDE.md docs/mcp-registration.md tests/curl/test_worklog_api.sh
git commit -m "docs: 需求层移除与工具数更新"
```

---

## 验收

树只有 主题→版本；记录只选版本；MCP 14 工具；迁移后条目 68 守恒、需求字段消失；全量测试与 curl 通过。
