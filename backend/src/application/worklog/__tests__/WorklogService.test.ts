// backend/src/application/worklog/__tests__/WorklogService.test.ts
// WorklogService + JsonWorklogRepository 集成测试(真文件,临时目录隔离)。
// 覆盖:record 建层/查询过滤/partial 更新与挪版本/rename 冲突/备份滚动/双实例跨进程模拟。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WorklogService } from '../WorklogService.js';
import { JsonWorklogRepository } from '../../../infrastructure/persistence/JsonWorklogRepository.js';

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function yesterday(): string {
  const d = new Date(Date.now() - 24 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe('WorklogService', () => {
  let tmpDir: string;
  let filePath: string;
  let backupsDir: string;
  let service: WorklogService;

  beforeEach(async () => {
    const { nanoid } = await import('nanoid');
    tmpDir = path.join(os.tmpdir(), `worklog-test-${nanoid()}`);
    filePath = path.join(tmpDir, 'worklog.json');
    backupsDir = path.join(tmpDir, 'worklog-backups');
    service = new WorklogService(new JsonWorklogRepository(filePath, backupsDir));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function listBackups(): Promise<string[]> {
    try {
      const names = await fs.readdir(backupsDir);
      return names.filter((n) => n.endsWith('.json')).sort();
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------
  // record
  // ---------------------------------------------------------------
  describe('record', () => {
    it('should create project and version automatically on first record', async () => {
      const res = await service.record({
        project: 'ai-task-flow', version: 'v1.2.0',
        title: '砍掉任务派发链路', detail: '删除 workflow 域',
      });
      expect(res.createdProject).toBe(true);
      expect(res.createdVersion).toBe(true);
      expect(res.entryId).toBeTruthy();
      expect(res.path).toBe(`ai-task-flow/v1.2.0/${res.entryId}`);

      const tree = await service.listProjects();
      expect(tree).toHaveLength(1);
      expect(tree[0].name).toBe('ai-task-flow');
      expect(tree[0].versions[0].name).toBe('v1.2.0');
      expect(tree[0].versions[0].entryCount).toBe(1);
    });

    it('should not mark created flags when project/version already exist', async () => {
      await service.record({ project: 'p1', version: 'v1', title: 'a', detail: 'd1' });
      const res = await service.record({ project: 'p1', version: 'v1', title: 'b', detail: 'd2' });
      expect(res.createdProject).toBe(false);
      expect(res.createdVersion).toBe(false);
    });

    it('should generate unique ids and local date', async () => {
      const r1 = await service.record({ project: 'p', version: 'v', title: 'a', detail: 'd' });
      const r2 = await service.record({ project: 'p', version: 'v', title: 'b', detail: 'd' });
      expect(r1.entryId).not.toBe(r2.entryId);

      const results = await service.query({ project: 'p' });
      expect(results.every((e) => e.date === today())).toBe(true);
    });

    it('should reject invalid names (empty / contains slash)', async () => {
      await expect(service.record({ project: ' ', version: 'v', title: 't', detail: 'd' }))
        .rejects.toThrow(/项目名/);
      await expect(service.record({ project: 'a/b', version: 'v', title: 't', detail: 'd' }))
        .rejects.toThrow(/项目名/);
      await expect(service.record({ project: 'p', version: 'v/1', title: 't', detail: 'd' }))
        .rejects.toThrow(/版本名/);
    });
  });

  // ---------------------------------------------------------------
  // query
  // ---------------------------------------------------------------
  describe('query', () => {
    beforeEach(async () => {
      await service.record({
        project: 'ai-task-flow', version: 'v1.0', title: '登录页加记住密码',
        detail: '修改 LoginForm 组件', tags: ['feat'],
        files: [{ path: 'frontend/src/LoginForm.tsx', startLine: 10, endLine: 40 }],
      });
      await service.record({
        project: 'ai-task-flow', version: 'v1.1', title: '修复白屏 bug',
        detail: 'KnowledgeScanner 容错 ENOENT', tags: ['fix'], diff: 'diff --git a/x',
      });
      await service.record({
        project: 'other-proj', version: 'v2.0', title: 'LOGIN refactor',
        detail: '重构登录', tags: ['refactor'],
      });
    });

    it('should filter by project and version exactly', async () => {
      const byProject = await service.query({ project: 'ai-task-flow' });
      expect(byProject).toHaveLength(2);
      const byVersion = await service.query({ project: 'ai-task-flow', version: 'v1.0' });
      expect(byVersion).toHaveLength(1);
      expect(byVersion[0].title).toBe('登录页加记住密码');
    });

    it('should match keyword case-insensitively across title/detail/files.path', async () => {
      const byTitle = await service.query({ keyword: 'login' });
      expect(byTitle).toHaveLength(2); // LOGIN refactor(title) + LoginForm(files.path)
      const byDetail = await service.query({ keyword: 'enoent' });
      expect(byDetail).toHaveLength(1);
    });

    it('should filter by tags with any-match', async () => {
      const results = await service.query({ tags: ['fix', 'refactor'] });
      expect(results).toHaveLength(2);
    });

    it('should apply dateFrom/dateTo inclusive on entry.date', async () => {
      // 全部是今天,昨天的边界应排除
      const all = await service.query({});
      expect(all).toHaveLength(3);
      const pastOnly = await service.query({ dateTo: yesterday() });
      expect(pastOnly).toHaveLength(0);
      const todayOnly = await service.query({ dateFrom: today(), dateTo: today() });
      expect(todayOnly).toHaveLength(3);
    });

    it('should respect limit and includeDiff switch', async () => {
      const limited = await service.query({ limit: 2 });
      expect(limited).toHaveLength(2);

      const withoutDiff = await service.query({ keyword: '白屏' });
      expect(withoutDiff[0].diff).toBeUndefined();
      const withDiff = await service.query({ keyword: '白屏', includeDiff: true });
      expect(withDiff[0].diff).toBe('diff --git a/x');
    });

    it('should return files as path list in query results', async () => {
      const results = await service.query({ keyword: '记住密码' });
      expect(results[0].files).toEqual(['frontend/src/LoginForm.tsx']);
    });

    it('should query exactly by entryId and ignore other filters', async () => {
      const all = await service.query({});
      const target = all.find((e) => e.title === '修复白屏 bug');
      expect(target).toBeDefined();

      const hit = await service.query({ entryId: target!.id });
      expect(hit).toHaveLength(1);
      expect(hit[0].id).toBe(target!.id);

      // 与 target 不匹配的项目/标签也不该挡住精确查询
      const ignored = await service.query({ entryId: target!.id, project: 'other-proj', tags: ['feat'] });
      expect(ignored).toHaveLength(1);
      expect(ignored[0].id).toBe(target!.id);

      expect(await service.query({ entryId: 'e_not_exist' })).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------
  // update(partial)
  // ---------------------------------------------------------------
  describe('update', () => {
    it('should only patch provided fields and keep diff/files intact', async () => {
      const r = await service.record({
        project: 'p', version: 'v1', title: '原标题', detail: '原详情',
        diff: 'diff --git', files: [{ path: 'a.ts' }],
      });
      await service.update(r.entryId, { title: '新标题' });

      const [entry] = await service.query({ keyword: '新标题', includeDiff: true });
      expect(entry.title).toBe('新标题');
      expect(entry.detail).toBe('原详情');      // 未传字段保留
      expect(entry.diff).toBe('diff --git');     // diff 不丢(页面 partial 编辑场景)
      expect(entry.files).toEqual(['a.ts']);     // files 不丢
    });

    it('should move entry to another version, creating it if absent', async () => {
      const r = await service.record({ project: 'p', version: 'v1', title: 't', detail: 'd' });
      await service.update(r.entryId, { version: 'v2' }); // v2 不存在 → 自动建

      const inV2 = await service.query({ project: 'p', version: 'v2' });
      expect(inV2).toHaveLength(1);
      const inV1 = await service.query({ project: 'p', version: 'v1' });
      expect(inV1).toHaveLength(0);
    });

    it('should throw readable error for unknown entryId', async () => {
      await expect(service.update('e_nonexist', { title: 'x' })).rejects.toThrow(/不存在/);
    });
  });

  // ---------------------------------------------------------------
  // delete + rename(破坏性操作 → 备份)
  // ---------------------------------------------------------------
  describe('delete & rename with backup', () => {
    beforeEach(async () => {
      await service.record({ project: 'p', version: 'v1', title: 'a', detail: 'd' });
      await service.record({ project: 'p', version: 'v1', title: 'b', detail: 'd' });
    });

    it('should backup before deleteEntry/deleteVersion/deleteProject', async () => {
      const [entry] = await service.query({ keyword: 'a' });
      await service.deleteEntry(entry.id);
      expect(await listBackups()).toHaveLength(1);

      await service.deleteVersion('p', 'v1');
      expect(await listBackups()).toHaveLength(2);

      await service.record({ project: 'q', version: 'v', title: 'x', detail: 'd' });
      await service.deleteProject('q');
      expect(await listBackups()).toHaveLength(3);
    });

    it('should backup before rename and apply rename', async () => {
      await service.renameVersion('p', 'v1', 'v1.0');
      expect(await listBackups()).toHaveLength(1);
      const tree = await service.listProjects();
      expect(tree[0].versions[0].name).toBe('v1.0');
      expect(tree[0].versions[0].entryCount).toBe(2); // 条目随版本保留
    });

    it('should reject rename to existing name without modifying data', async () => {
      await service.record({ project: 'p', version: 'v2', title: 'c', detail: 'd' });
      await expect(service.renameVersion('p', 'v1', 'v2')).rejects.toThrow(/已存在/);
      await expect(service.renameProject('p', 'p')).rejects.toThrow(/已存在/);
      const tree = await service.listProjects();
      expect(tree[0].versions.map((v) => v.name)).toEqual(['v1', 'v2']);
    });

    it('should keep at most 10 rolling backups', async () => {
      for (let i = 0; i < 12; i++) {
        const r = await service.record({ project: `p${i}`, version: 'v', title: 't', detail: 'd' });
        await service.deleteEntry(r.entryId);
      }
      expect(await listBackups()).toHaveLength(10);
    });

    it('should not collide when two backups happen within same millisecond', async () => {
      // 连续两次删除,快照文件名含随机后缀,不会互覆
      const r1 = await service.record({ project: 'x1', version: 'v', title: 't', detail: 'd' });
      const r2 = await service.record({ project: 'x2', version: 'v', title: 't', detail: 'd' });
      await Promise.all([service.deleteEntry(r1.entryId), service.deleteEntry(r2.entryId)]);
      expect(await listBackups()).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------
  // list_projects 汇总
  // ---------------------------------------------------------------
  it('listProjects should summarize entryCount and first/last date', async () => {
    await service.record({ project: 'p', version: 'v1', title: 'a', detail: 'd' });
    await service.record({ project: 'p', version: 'v2', title: 'b', detail: 'd' });
    const tree = await service.listProjects();
    expect(tree).toHaveLength(1);
    expect(tree[0].versions).toHaveLength(2);
    for (const v of tree[0].versions) {
      expect(v.entryCount).toBe(1);
      expect(v.firstDate).toBe(today());
      expect(v.lastDate).toBe(today());
    }
  });

  // ---------------------------------------------------------------
  // 项目路径绑定/解绑
  // ---------------------------------------------------------------
  describe('project paths', () => {
    // 平台无关:用 path.resolve 生成当前平台绝对路径,Windows/Linux CI 都能跑
    const pathA1 = path.resolve('x-a');
    const pathA2 = path.resolve('x-y-a');

    it('should reject a path already bound to another project', async () => {
      await service.record({ project: 'A', version: 'V1', title: 'a', detail: 'd' });
      await service.record({ project: 'B', version: 'V1', title: 'b', detail: 'd' });
      await service.bindProjectPaths('A', [pathA1]);

      await expect(service.bindProjectPaths('B', [pathA1]))
        .rejects.toThrow(/已被项目/);
      // 冲突时不得改动 B 的绑定
      expect((await service.getTree()).projects.find((p) => p.name === 'B')!.paths).toBeUndefined();
    });

    it('should bind and unbind multiple paths', async () => {
      await service.record({ project: 'A', version: 'V1', title: 'a', detail: 'd' });
      await service.bindProjectPaths('A', [pathA1, pathA2]);
      let tree = await service.getTree();
      expect(tree.projects.find((p) => p.name === 'A')!.paths).toEqual([pathA1, pathA2]);

      await service.unbindProjectPath('A', pathA1);
      tree = await service.getTree();
      expect(tree.projects.find((p) => p.name === 'A')!.paths).toEqual([pathA2]);
    });

    it('should reject relative paths and dedupe repeated ones', async () => {
      await service.record({ project: 'A', version: 'V1', title: 'a', detail: 'd' });
      await expect(service.bindProjectPaths('A', ['relative/dir']))
        .rejects.toThrow(/绝对路径/);

      await service.bindProjectPaths('A', [pathA1, ` ${pathA1} `, pathA2]);
      const tree = await service.getTree();
      expect(tree.projects.find((p) => p.name === 'A')!.paths).toEqual([pathA1, pathA2]);
    });

    it('should unbind by normalized comparison', async () => {
      await service.record({ project: 'A', version: 'V1', title: 'a', detail: 'd' });
      await service.bindProjectPaths('A', [pathA1]);
      // 带尾分隔符的形式归一化后应命中同一条绑定
      await service.unbindProjectPath('A', `${pathA1}${path.sep}`);
      expect((await service.getTree()).projects.find((p) => p.name === 'A')!.paths).toEqual([]);
    });

    it('should mark missing paths in getTree without persisting them', async () => {
      const { nanoid } = await import('nanoid');
      const missing = path.join(os.tmpdir(), `no-such-dir-${nanoid()}`);
      await service.record({ project: 'A', version: 'V1', title: 'a', detail: 'd' });
      await service.bindProjectPaths('A', [tmpDir, missing]);

      const tree = await service.getTree();
      expect(tree.projects.find((p) => p.name === 'A')!.missingPaths).toEqual([missing]);
      // missingPaths 仅为读时计算,不得写回 worklog.json
      const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      expect(raw.projects[0].missingPaths).toBeUndefined();
    });

    it('should require an existing project when binding', async () => {
      await expect(service.bindProjectPaths('no-such-project', [pathA1]))
        .rejects.toThrow(/不存在/);
    });
  });

  // ---------------------------------------------------------------
  // record 按项目路径归属(最长前缀)
  // ---------------------------------------------------------------
  describe('path ownership', () => {
    // 平台无关:基于 os.tmpdir 构造嵌套绝对路径;目录不存在 → resolveMatchPath 降级 path.resolve,
    // 与绑定值完全一致,不受 realpath 大小写/符号链接影响
    const base = path.resolve(os.tmpdir(), 'worklog-path-owner');
    const parentPath = path.join(base, '资源加工平台');
    const childPath = path.join(parentPath, '搜题平台');

    it('should assign owner project by longest path prefix', async () => {
      await service.record({ project: '资源加工平台', version: 'V1', title: 'a', detail: 'd' });
      await service.record({ project: '搜题平台', version: 'V1', title: 'a', detail: 'd' });
      await service.bindProjectPaths('资源加工平台', [parentPath]);
      await service.bindProjectPaths('搜题平台', [childPath]);

      const sourcePath = path.join(childPath, '前端', 'x');
      const r = await service.record({
        project: '随便写的名字',
        version: 'V1',
        title: 't',
        detail: 'd',
        sourcePath,
      });

      expect(r.projectId).toBeDefined();
      const tree = await service.getTree();
      const owner = tree.projects.find((p) => p.id === r.projectId)!;
      expect(owner.name).toBe('搜题平台'); // 长前缀优先于父项目
      const entry = owner.versions[0].entries.find((e) => e.id === r.entryId)!;
      expect(entry.sourcePath).toBe(sourcePath); // 保留用户原始写法
      expect(entry.pathUnmatched).toBeUndefined();
      // 未归属的 AI 项目名不得被创建成新项目
      expect(tree.projects.some((p) => p.name === '随便写的名字')).toBe(false);
    });

    it('should fall back to given project name when path matches nothing', async () => {
      const unmatchedPath = path.join(base, 'nowhere', 'x');
      const r = await service.record({
        project: 'Demo', version: 'V1', title: 't', detail: 'd',
        sourcePath: unmatchedPath,
      });

      const tree = await service.getTree();
      const demo = tree.projects.find((p) => p.name === 'Demo')!;
      const entry = demo.versions[0].entries[0];
      expect(entry.pathUnmatched).toBe(true);
      expect(entry.sourcePath).toBe(unmatchedPath); // 未命中也要留痕,便于后续重新归属
      expect(r.projectId).toBe(demo.id);
      expect(r.warnings?.some((w) => w.includes('未归属'))).toBe(true);
    });

    it('should keep legacy behavior when sourcePath is absent', async () => {
      const r = await service.record({ project: 'Legacy', version: 'V1', title: 't', detail: 'd' });
      expect(r.warnings).toBeUndefined();
      const tree = await service.getTree();
      const entry = tree.projects.find((p) => p.name === 'Legacy')!.versions[0].entries[0];
      expect(entry.sourcePath).toBeUndefined();
      expect(entry.pathUnmatched).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------
  // 关联项目(名称解析 → id + 名称快照;改名同步)
  // ---------------------------------------------------------------
  describe('related projects', () => {
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

    it('should not write related fields when no name resolves', async () => {
      await service.record({ project: 'A', version: 'V1', title: 'a', detail: 'd' });
      const r = await service.record({
        project: 'A', version: 'V1', title: 'x', detail: 'd',
        relatedProjects: ['  ', '不存在'],
      });
      expect(r.warnings?.some((w) => w.includes('不存在'))).toBe(true);
      const tree = await service.getTree();
      const entry = tree.projects.find((p) => p.name === 'A')!
        .versions[0].entries.find((e) => e.title === 'x')!;
      expect(entry.relatedProjects).toBeUndefined();
      expect(entry.relatedProjectIds).toBeUndefined();
    });

    it('should sync related project name snapshot on rename', async () => {
      await service.record({ project: 'A', version: 'V1', title: 'a', detail: 'd' });
      await service.record({ project: 'B', version: 'V1', title: 'b', detail: 'd' });
      await service.record({
        project: 'A', version: 'V1', title: 'x', detail: 'd', relatedProjects: ['B'],
      });

      await service.renameProject('B', 'B2');
      const tree = await service.getTree();
      const entry = tree.projects.find((p) => p.name === 'A')!
        .versions[0].entries.find((e) => e.title === 'x')!;
      expect(entry.relatedProjects).toEqual(['B2']);
      // id 引用不随改名变化
      expect(entry.relatedProjectIds).toEqual([
        tree.projects.find((p) => p.name === 'B2')!.id,
      ]);
    });

    it('should set/keep/clear related projects via update', async () => {
      await service.record({ project: 'B', version: 'V1', title: 'b', detail: 'd' });
      await service.record({ project: 'C', version: 'V1', title: 'c', detail: 'd' });
      const r = await service.record({ project: 'A', version: 'V1', title: 't', detail: 'd' });

      // 设置:未知名称忽略并告警
      const u1 = await service.update(r.entryId, { relatedProjects: ['B', '不存在'] });
      expect(u1.warnings?.some((w) => w.includes('不存在'))).toBe(true);
      expect((await service.query({ entryId: r.entryId }))[0].relatedProjects).toEqual(['B']);

      // 改传新值 = 整体替换
      await service.update(r.entryId, { relatedProjects: ['C'] });
      expect((await service.query({ entryId: r.entryId }))[0].relatedProjects).toEqual(['C']);

      // undefined = 不改,其他字段更新不影响关联
      await service.update(r.entryId, { title: '改名' });
      expect((await service.query({ entryId: r.entryId }))[0].relatedProjects).toEqual(['C']);

      // 空数组 = 清空关联
      await service.update(r.entryId, { relatedProjects: [] });
      const cleared = (await service.query({ entryId: r.entryId }))[0];
      expect(cleared.relatedProjects).toBeUndefined();
      const tree = await service.getTree();
      const entry = tree.projects.find((p) => p.name === 'A')!
        .versions[0].entries.find((e) => e.id === r.entryId)!;
      expect(entry.relatedProjectIds).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------
  // 双实例(模拟 HTTP 进程与 MCP 进程)并发
  // ---------------------------------------------------------------
  it('should persist and filter by stage', async () => {
    const created = await service.record({
      project: 'p', version: 'v', title: 't', detail: 'd', stage: 'dev',
    });
    const dev = await service.query({ project: 'p', stage: 'dev' });
    expect(dev).toHaveLength(1);
    expect(dev[0].stage).toBe('dev');

    await service.update(created.entryId, { stage: 'review' });
    expect(await service.query({ project: 'p', stage: 'review' })).toHaveLength(1);
    expect(await service.query({ project: 'p', stage: 'dev' })).toHaveLength(0);
  });

  it('should reject an invalid stage', async () => {
    await expect(service.record({
      project: 'p', version: 'v', title: 't', detail: 'd', stage: 'bad' as never,
    })).rejects.toThrow();
  });

  it('should not lose updates across two repository instances', async () => {
    const serviceB = new WorklogService(new JsonWorklogRepository(filePath, backupsDir));
    // 同项目同版本并发写 20 条,两实例各 10
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        (i % 2 === 0 ? service : serviceB).record({
          project: 'p', version: 'v', title: `entry-${i}`, detail: 'd',
        }),
      ),
    );
    const results = await serviceB.query({ project: 'p', limit: 100 });
    expect(results).toHaveLength(20);
  });
});
