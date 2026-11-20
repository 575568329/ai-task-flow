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
