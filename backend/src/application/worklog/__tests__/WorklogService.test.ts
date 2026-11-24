// backend/src/application/worklog/__tests__/WorklogService.test.ts
// WorklogService + JsonWorklogRepository 集成测试(真文件,临时目录隔离)。
// 模型:主题 → 版本 → 条目;项目为条目属性与路径归属字典。
// 覆盖:record 写入既有版本、id 错误路径、查询过滤、partial 更新、
//       删除级联与备份滚动、项目路径绑定、路径归属与告警降噪、关联项目、stage、双实例并发。
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
  let repo: JsonWorklogRepository;
  let service: WorklogService;
  /** 版本必须归属主题:首次需要时直写仓储预置(避免 createProgram 的备份噪声) */
  let cachedProgramId: string | undefined;

  async function ensureProgram(): Promise<string> {
    if (cachedProgramId) return cachedProgramId;
    cachedProgramId = await repo.mutate((data) => {
      const id = 'g_test';
      data.programs.push({ id, name: '测试主题', createdAt: Date.now() });
      return id;
    });
    return cachedProgramId;
  }

  beforeEach(async () => {
    const { nanoid } = await import('nanoid');
    tmpDir = path.join(os.tmpdir(), `worklog-test-${nanoid()}`);
    filePath = path.join(tmpDir, 'worklog.json');
    backupsDir = path.join(tmpDir, 'worklog-backups');
    repo = new JsonWorklogRepository(filePath, backupsDir);
    service = new WorklogService(repo);
    cachedProgramId = undefined;
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

  /**
   * 直写仓储种子项目:新模型下 record 不再自动创建项目,
   * 项目只来自迁移/页面(路径绑定),测试里统一用它准备「已存在的项目」。
   */
  async function seedProject(name: string, extra?: { id?: string | null; paths?: string[] }): Promise<string> {
    const id = extra?.id === null ? undefined : (extra?.id ?? `p_${name}`);
    return repo.mutate((data) => {
      const existing = data.projects.find((p) => p.name === name);
      if (existing) return existing.id;
      data.projects.push({
        id,
        name,
        createdAt: Date.now(),
        ...(extra?.paths ? { paths: extra.paths } : {}),
      } as (typeof data.projects)[number]);
      return id ?? '';
    });
  }

  /** 建版本(record 的前置条件;版本必须归属主题) */
  async function seedVersion(versionName = 'V1') {
    const version = await service.createVersion({ name: versionName, programId: await ensureProgram() });
    return { versionId: version.id };
  }

  // ---------------------------------------------------------------
  // record
  // ---------------------------------------------------------------
  describe('record', () => {
    it('should record into an existing version', async () => {
      const { versionId } = await seedVersion('V8.0.8');
      const res = await service.record({
        versionId, title: '改动', detail: 'd', stage: 'dev',
      });

      expect(res.entryId).toMatch(/^e_/);
      expect(res.path).toBe(`V8.0.8/${res.entryId}`);
      // 版本不再自动创建,兼容字段恒 false
      expect(res.createdProject).toBe(false);
      expect(res.createdVersion).toBe(false);

      const tree = await service.getTree();
      expect(tree.projects).toHaveLength(0); // record 不再创建项目
      expect(tree.versions).toHaveLength(1);
      expect(tree.versions[0].entries).toHaveLength(1);
    });

    it('should reject unknown version id with actionable message', async () => {
      await expect(service.record({
        versionId: 'v_nope', title: 't', detail: 'd', stage: 'dev',
      })).rejects.toThrow(/版本 v_nope 不存在/);
      await expect(service.record({
        versionId: 'v_nope', title: 't', detail: 'd', stage: 'dev',
      })).rejects.toThrow(/请让用户在页面创建并复制 id/);
    });

    it('should append migration hint when no versions exist yet', async () => {
      // 旧库未迁移时 versions 为空:提示先启动 Web 服务完成迁移,而不是只让用户创建版本
      await expect(service.record({
        versionId: 'v_nope', title: 't', detail: 'd', stage: 'dev',
      })).rejects.toThrow(/如从旧版本升级.*npm start.*完成数据迁移/);
    });

    it('should not append migration hint when versions already exist', async () => {
      // 已有版本时 id 写错属于普通输入错误,不应误导用户去「迁移数据」
      await service.createVersion({ name: 'V1', programId: await ensureProgram() });
      await expect(service.record({
        versionId: 'v_nope', title: 't', detail: 'd', stage: 'dev',
      })).rejects.not.toThrow(/如从旧版本升级/);
    });

    it('should record without stage as unlabelled', async () => {
      const { versionId } = await seedVersion();
      const res = await service.record({ versionId, title: '未标注', detail: 'd' });

      const [entry] = await service.query({ entryId: res.entryId });
      expect(entry.title).toBe('未标注');
      expect(entry.stage).toBeUndefined();
    });

    it('should reject an explicit project that does not exist', async () => {
      const { versionId } = await seedVersion();
      await expect(service.record({
        versionId, title: 't', detail: 'd', stage: 'dev', project: '不存在',
      })).rejects.toThrow(/项目不存在:不存在/);
    });

    it('should allow slashes in entry titles and trim project names', async () => {
      await seedProject('A');
      const { versionId } = await seedVersion();
      const r = await service.record({
        versionId, title: '修复 A/B 白屏', detail: 'd', stage: 'dev', project: '  A  ',
      });
      const [entry] = await service.query({ entryId: r.entryId });
      expect(entry.title).toBe('修复 A/B 白屏');
      expect(entry.project).toBe('A');
    });

    it('should reject an explicitly empty project name', async () => {
      const { versionId } = await seedVersion();
      await expect(service.record({
        versionId, title: 't', detail: 'd', stage: 'dev', project: '   ',
      })).rejects.toThrow(/项目名不能为空/);
    });

    it('should list existing versions as candidates in error messages', async () => {
      const version = await service.createVersion({ name: 'V8.0.7', programId: await ensureProgram() });

      await expect(service.record({
        versionId: 'v_nope', title: 't', detail: 'd', stage: 'dev',
      })).rejects.toThrow(new RegExp(`现有版本：V8\\.0\\.7\\(${version.id}\\)`));
    });

    it('should validate title/detail/stage/files', async () => {
      const { versionId } = await seedVersion();
      await expect(service.record({
        versionId, title: ' ', detail: 'd', stage: 'dev',
      })).rejects.toThrow(/标题不能为空/);
      await expect(service.record({
        versionId, title: 't', detail: '  ', stage: 'dev',
      })).rejects.toThrow(/详细说明不能为空/);
      await expect(service.record({
        versionId, title: 't', detail: 'd', stage: 'bad' as never,
      })).rejects.toThrow(/stage 非法/);
      await expect(service.record({
        versionId, title: 't', detail: 'd', stage: 'dev', files: [{ nope: 1 }] as never,
      })).rejects.toThrow(/files 必须为/);
    });

    it('should generate unique ids and local date; keep entry without project', async () => {
      const { versionId } = await seedVersion();
      const r1 = await service.record({ versionId, title: 'a', detail: 'd', stage: 'dev' });
      const r2 = await service.record({ versionId, title: 'b', detail: 'd', stage: 'dev' });
      expect(r1.entryId).not.toBe(r2.entryId);

      const results = await service.query({ versionId });
      expect(results.every((e) => e.date === today())).toBe(true);
      expect(results.every((e) => e.project === undefined)).toBe(true);
      expect(results.every((e) => e.versionName === 'V1')).toBe(true);
    });
  });

  // ---------------------------------------------------------------
  // query
  // ---------------------------------------------------------------
  describe('query', () => {
    let v1: { versionId: string };
    let v2: { versionId: string };

    beforeEach(async () => {
      await seedProject('ai-task-flow');
      await seedProject('other-proj');
      v1 = await seedVersion('V1');
      v2 = await seedVersion('V2');

      await service.record({
        versionId: v1.versionId, project: 'ai-task-flow',
        title: '登录页加记住密码', detail: '修改 LoginForm 组件', tags: ['feat'], stage: 'dev',
        files: [{ path: 'frontend/src/LoginForm.tsx', startLine: 10, endLine: 40 }],
      });
      await service.record({
        versionId: v1.versionId, project: 'ai-task-flow',
        title: '修复白屏 bug', detail: 'KnowledgeScanner 容错 ENOENT', tags: ['fix'], stage: 'review',
        diff: 'diff --git a/x',
      });
      await service.record({
        versionId: v2.versionId, project: 'other-proj',
        title: 'LOGIN refactor', detail: '重构登录', tags: ['refactor'], stage: 'dev',
      });
    });

    it('should filter by versionId / version name / project', async () => {
      const byVersion = await service.query({ versionId: v1.versionId });
      expect(byVersion).toHaveLength(2);
      expect(byVersion.every((e) => e.versionName === 'V1')).toBe(true);

      const byVersionName = await service.query({ version: 'V1' });
      expect(byVersionName).toHaveLength(2);

      const byProject = await service.query({ project: 'ai-task-flow' });
      expect(byProject).toHaveLength(2);
      expect(byProject.every((e) => e.project === 'ai-task-flow')).toBe(true);
    });

    it('should match keyword case-insensitively across title/detail/files.path', async () => {
      const byTitle = await service.query({ keyword: 'login' });
      expect(byTitle).toHaveLength(2); // LOGIN refactor(title) + LoginForm(files.path)
      const byDetail = await service.query({ keyword: 'enoent' });
      expect(byDetail).toHaveLength(1);
    });

    it('should filter by stage and tags with any-match', async () => {
      const byStage = await service.query({ stage: 'review' });
      expect(byStage.map((e) => e.title)).toEqual(['修复白屏 bug']);

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

    it('should return files as path list and version name', async () => {
      const results = await service.query({ keyword: '记住密码' });
      expect(results[0].files).toEqual(['frontend/src/LoginForm.tsx']);
      expect(results[0].versionName).toBe('V1');
    });

    it('should query exactly by entryId and ignore other filters', async () => {
      const all = await service.query({});
      const target = all.find((e) => e.title === '修复白屏 bug');
      expect(target).toBeDefined();

      const hit = await service.query({ entryId: target!.id });
      expect(hit).toHaveLength(1);
      expect(hit[0].id).toBe(target!.id);

      // 与 target 不匹配的版本/项目/标签也不该挡住精确查询
      const ignored = await service.query({
        entryId: target!.id, versionId: v2.versionId, project: 'other-proj', tags: ['feat'],
      });
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
      const { versionId } = await seedVersion();
      const r = await service.record({
        versionId, title: '原标题', detail: '原详情',
        stage: 'dev', diff: 'diff --git', files: [{ path: 'a.ts' }],
      });
      const updated = await service.update(r.entryId, { title: '新标题' });
      expect(updated.path).toBe(`V1/${r.entryId}`);

      const [entry] = await service.query({ keyword: '新标题', includeDiff: true });
      expect(entry.title).toBe('新标题');
      expect(entry.detail).toBe('原详情');      // 未传字段保留
      expect(entry.diff).toBe('diff --git');     // diff 不丢(页面 partial 编辑场景)
      expect(entry.files).toEqual(['a.ts']);     // files 不丢
      expect(entry.stage).toBe('dev');
    });

    it('should update stage and reject invalid values', async () => {
      const { versionId } = await seedVersion();
      const r = await service.record({ versionId, title: 't', detail: 'd', stage: 'dev' });
      await service.update(r.entryId, { stage: 'review' });
      expect((await service.query({ entryId: r.entryId }))[0].stage).toBe('review');
      await expect(service.update(r.entryId, { stage: 'bad' as never })).rejects.toThrow(/stage 非法/);
    });

    it('should validate date format', async () => {
      const { versionId } = await seedVersion();
      const r = await service.record({ versionId, title: 't', detail: 'd', stage: 'dev' });
      await expect(service.update(r.entryId, { date: '2026/11/23' })).rejects.toThrow(/YYYY-MM-DD/);
      await service.update(r.entryId, { date: '2026-11-20' });
      expect((await service.query({ entryId: r.entryId }))[0].date).toBe('2026-11-20');
    });

    it('should throw readable error for unknown entryId', async () => {
      await expect(service.update('e_nonexist', { title: 'x' })).rejects.toThrow(/不存在/);
    });
  });

  // ---------------------------------------------------------------
  // delete + rename(破坏性操作 → 备份)
  // ---------------------------------------------------------------
  describe('delete & rename with backup', () => {
    let versionId: string;

    beforeEach(async () => {
      await seedProject('p');
      const seeded = await seedVersion('v1');
      versionId = seeded.versionId;
      await service.record({ versionId, title: 'a', detail: 'd', stage: 'dev' });
      await service.record({ versionId, title: 'b', detail: 'd', stage: 'dev' });
    });

    it('should backup before deleteEntry/deleteVersion/deleteProject', async () => {
      const before = (await listBackups()).length;
      const [entry] = await service.query({ keyword: 'a' });
      await service.deleteEntry(entry.id);
      expect((await listBackups()).length).toBe(before + 1);

      await service.deleteVersion(versionId);
      expect((await listBackups()).length).toBe(before + 2);
      // 删版本级联删除其条目
      expect((await service.getTree()).versions).toHaveLength(0);

      const seeded = await seedVersion('v2');
      await service.record({
        versionId: seeded.versionId,
        title: 'x', detail: 'd', stage: 'dev', project: 'p',
      });
      const beforeDeleteProject = (await listBackups()).length;
      await service.deleteProject('p');
      expect((await listBackups()).length).toBe(beforeDeleteProject + 1);
      // 删项目只移除字典项,历史条目保留(项目名称快照仍在)
      const tree = await service.getTree();
      expect(tree.projects).toHaveLength(0);
      expect(tree.versions[0].entries[0].project).toBe('p');
    });

    it('should backup before rename and keep entries', async () => {
      const before = (await listBackups()).length;
      await service.renameVersion(versionId, 'v1.0');
      expect((await listBackups()).length).toBe(before + 1);
      const version = (await service.getTree()).versions[0];
      expect(version.name).toBe('v1.0');
      expect(version.entries).toHaveLength(2); // 条目随版本保留
    });

    it('should reject rename to existing name without modifying data', async () => {
      await service.createVersion({ name: 'v2', programId: await ensureProgram() });
      await expect(service.renameVersion(versionId, 'v2')).rejects.toThrow(/已存在/);
      await expect(service.renameProject('p', 'p')).rejects.toThrow(/已存在/);
      const tree = await service.getTree();
      expect(tree.versions.map((v) => v.name)).toEqual(['v1', 'v2']);
    });

    it('should keep at most 10 rolling backups', async () => {
      for (let i = 0; i < 12; i++) {
        const r = await service.record({
          versionId, title: `t${i}`, detail: 'd', stage: 'dev',
        });
        await service.deleteEntry(r.entryId);
      }
      expect(await listBackups()).toHaveLength(10);
    });

    it('should not collide when two backups happen within same millisecond', async () => {
      // 连续两次删除,快照文件名含随机后缀,不会互覆
      const r1 = await service.record({ versionId, title: 'x1', detail: 'd', stage: 'dev' });
      const r2 = await service.record({ versionId, title: 'x2', detail: 'd', stage: 'dev' });
      const before = (await listBackups()).length;
      await Promise.all([service.deleteEntry(r1.entryId), service.deleteEntry(r2.entryId)]);
      expect((await listBackups()).length).toBe(before + 2);
    });
  });

  // ---------------------------------------------------------------
  // createProject(全新环境的第一个项目入口)
  // ---------------------------------------------------------------
  describe('createProject', () => {
    const projectPath = path.resolve('x-create-project');

    it('creates a project, exposes it via getProjectRefs and allows recording against it', async () => {
      const { id } = await service.createProject({ name: '新项目', paths: [projectPath] });
      expect(id).toMatch(/^p_/);

      const refs = await service.getProjectRefs();
      expect(refs).toContainEqual({ id, name: '新项目', paths: [projectPath] });

      // 建出的项目可直接用于 record 的显式 project(不再依赖迁移)
      const v = await service.createVersion({ name: 'V1', programId: await ensureProgram() });
      const res = await service.record({
        versionId: v.id, title: 't', detail: 'd', stage: 'dev', project: '新项目',
      });
      expect((await service.query({ entryId: res.entryId }))[0].project).toBe('新项目');
    });

    it('rejects a duplicate project name', async () => {
      await service.createProject({ name: 'A' });
      await expect(service.createProject({ name: 'A' })).rejects.toThrow(/已存在/);
    });

    it('rejects forbidden paths without creating a half project', async () => {
      await expect(service.createProject({ name: 'A', paths: [os.homedir()] }))
        .rejects.toThrow(/用户主目录/);
      await expect(service.createProject({ name: 'A', paths: [path.parse(tmpDir).root] }))
        .rejects.toThrow(/文件系统根目录/);
      expect((await service.getProjectRefs()).some((p) => p.name === 'A')).toBe(false);
    });

    it('rejects a path already occupied by another project, atomically', async () => {
      await service.createProject({ name: 'A', paths: [projectPath] });
      await expect(service.createProject({ name: 'B', paths: [projectPath] }))
        .rejects.toThrow(/已被项目/);
      expect((await service.getProjectRefs()).some((p) => p.name === 'B')).toBe(false);
    });

    it('backs up before creating (dictionary change)', async () => {
      await service.createProject({ name: 'A' });
      expect(await listBackups()).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------
  // 项目路径绑定/解绑
  // ---------------------------------------------------------------
  describe('project paths', () => {
    // 平台无关:用 path.resolve 生成当前平台绝对路径,Windows/Linux CI 都能跑
    const pathA1 = path.resolve('x-a');
    const pathA2 = path.resolve('x-y-a');

    it('should reject a path already bound to another project', async () => {
      await seedProject('A');
      await seedProject('B');
      await service.bindProjectPaths('A', [pathA1]);

      await expect(service.bindProjectPaths('B', [pathA1]))
        .rejects.toThrow(/已被项目/);
      // 冲突时不得改动 B 的绑定
      expect((await service.getTree()).projects.find((p) => p.name === 'B')!.paths).toBeUndefined();
    });

    it('should bind and unbind multiple paths', async () => {
      await seedProject('A');
      await service.bindProjectPaths('A', [pathA1, pathA2]);
      let tree = await service.getTree();
      expect(tree.projects.find((p) => p.name === 'A')!.paths).toEqual([pathA1, pathA2]);

      await service.unbindProjectPath('A', pathA1);
      tree = await service.getTree();
      expect(tree.projects.find((p) => p.name === 'A')!.paths).toEqual([pathA2]);
    });

    it('should reject relative paths and dedupe repeated ones', async () => {
      await seedProject('A');
      await expect(service.bindProjectPaths('A', ['relative/dir']))
        .rejects.toThrow(/绝对路径/);

      await service.bindProjectPaths('A', [pathA1, ` ${pathA1} `, pathA2]);
      const tree = await service.getTree();
      expect(tree.projects.find((p) => p.name === 'A')!.paths).toEqual([pathA1, pathA2]);
    });

    it('should reject home dir, filesystem root and tmpdir themselves but allow subdirectories', async () => {
      await seedProject('A');
      await expect(service.bindProjectPaths('A', [os.homedir()])).rejects.toThrow(/用户主目录/);
      await expect(service.bindProjectPaths('A', [path.parse(tmpDir).root])).rejects.toThrow(/文件系统根目录/);
      await expect(service.bindProjectPaths('A', [os.tmpdir()])).rejects.toThrow(/系统临时目录/);
      // 拒绝后不得留下半截绑定
      expect((await service.getTree()).projects.find((p) => p.name === 'A')!.paths).toBeUndefined();

      // 其子目录放行(真正的工作区)
      const homeSub = path.join(os.homedir(), 'worklog-bind-subdir');
      const tmpSub = path.join(os.tmpdir(), 'worklog-bind-subdir');
      await service.bindProjectPaths('A', [homeSub, tmpSub]);
      expect((await service.getTree()).projects.find((p) => p.name === 'A')!.paths).toEqual([homeSub, tmpSub]);
    });

    it('should reject Windows system directories themselves but allow subdirectories', async () => {
      if (process.platform !== 'win32') return; // 仅 Windows 存在这些目录
      await seedProject('A');
      await expect(service.bindProjectPaths('A', ['C:\\Windows'])).rejects.toThrow(/Windows 系统目录/);
      await expect(service.bindProjectPaths('A', ['C:\\Program Files'])).rejects.toThrow(/Windows 系统目录/);
      await expect(service.bindProjectPaths('A', ['C:\\Program Files (x86)'])).rejects.toThrow(/Windows 系统目录/);
      await service.bindProjectPaths('A', ['C:\\Windows\\System32']);
      expect((await service.getTree()).projects.find((p) => p.name === 'A')!.paths).toEqual(['C:\\Windows\\System32']);
    });

    it('should unbind by normalized comparison', async () => {
      await seedProject('A');
      await service.bindProjectPaths('A', [pathA1]);
      // 带尾分隔符的形式归一化后应命中同一条绑定
      await service.unbindProjectPath('A', `${pathA1}${path.sep}`);
      expect((await service.getTree()).projects.find((p) => p.name === 'A')!.paths).toEqual([]);
    });

    it('should mark missing paths in getTree without persisting them', async () => {
      const { nanoid } = await import('nanoid');
      const missing = path.join(os.tmpdir(), `no-such-dir-${nanoid()}`);
      await seedProject('A');
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

    it('getProjectRefs should mirror getTree project refs without probing paths', async () => {
      const { nanoid } = await import('nanoid');
      const missing = path.join(os.tmpdir(), `no-such-dir-${nanoid()}`);
      await seedProject('A');
      await service.bindProjectPaths('A', [pathA1, missing]);

      const refs = await service.getProjectRefs();
      const tree = await service.getTree();
      expect(refs.map(({ id, name }) => ({ id, name })))
        .toEqual(tree.projects.map(({ id, name }) => ({ id, name })));
      // 只透传字段:失效路径也原样返回,但不做 access、不产生 missingPaths
      expect(refs[0].paths).toEqual([pathA1, missing]);
      expect('missingPaths' in refs[0]).toBe(false);
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
      await seedProject('资源加工平台');
      await seedProject('搜题平台');
      await service.bindProjectPaths('资源加工平台', [parentPath]);
      await service.bindProjectPaths('搜题平台', [childPath]);
      const { versionId } = await seedVersion('V1');

      const sourcePath = path.join(childPath, '前端', 'x');
      // 显式传入的既有项目名在路径命中时被忽略(归属项目优先)
      const r = await service.record({
        versionId, title: 't', detail: 'd', stage: 'dev',
        project: '资源加工平台', sourcePath,
      });

      expect(r.projectId).toBeDefined();
      const tree = await service.getTree();
      const owner = tree.projects.find((p) => p.id === r.projectId)!;
      expect(owner.name).toBe('搜题平台'); // 长前缀优先于父项目
      const entry = tree.versions[0].entries.find((e) => e.id === r.entryId)!;
      expect(entry.project).toBe('搜题平台');
      expect(entry.sourcePath).toBe(sourcePath); // 保留用户原始写法
      expect(entry.pathUnmatched).toBeUndefined();
    });

    it('should fall back to given project name when path matches nothing', async () => {
      await seedProject('Demo');
      const { versionId } = await seedVersion('V1');
      const unmatchedPath = path.join(base, 'nowhere', 'x');
      const r = await service.record({
        versionId, title: 't', detail: 'd', stage: 'dev',
        project: 'Demo', sourcePath: unmatchedPath,
      });

      const tree = await service.getTree();
      const entry = tree.versions[0].entries[0];
      expect(entry.pathUnmatched).toBe(true);
      expect(entry.sourcePath).toBe(unmatchedPath); // 未命中也要留痕,便于后续重新归属
      expect(entry.project).toBe('Demo');
      expect(r.projectId).toBe(tree.projects.find((p) => p.name === 'Demo')!.id);
      // 全部项目都没绑定路径 → 未命中是常态(还没配置),不告警
      expect(r.warnings).toBeUndefined();
    });

    it('should warn when some project has bound paths but the cwd matches none', async () => {
      await seedProject('A');
      await seedProject('B');
      await service.bindProjectPaths('A', [parentPath]);
      const { versionId } = await seedVersion('V1');

      const r = await service.record({
        versionId, title: 't', detail: 'd', stage: 'dev',
        project: 'B', sourcePath: path.join(base, 'nowhere', 'x'),
      });
      // 有绑定却落在绑定范围外 = 配置异常信号,必须告警
      expect(r.warnings?.some((w) => w.includes('未归属'))).toBe(true);
    });

    it('should stay quiet when the cwd matches a bound project', async () => {
      await seedProject('A');
      await seedProject('B');
      await service.bindProjectPaths('A', [parentPath]);
      const { versionId } = await seedVersion('V1');

      const r = await service.record({
        versionId, title: 't', detail: 'd', stage: 'dev',
        project: 'B', sourcePath: path.join(parentPath, 'backend'),
      });
      expect(r.warnings).toBeUndefined();
      const tree = await service.getTree();
      expect(tree.projects.find((p) => p.id === r.projectId)!.name).toBe('A');
    });

    it('should ignore projects without id for ownership and related refs', async () => {
      // 直接写仓储模拟迁移前旧数据:项目可能存在但缺稳定 id
      await seedProject('无id项目', { id: null, paths: [parentPath] });
      await repo.mutate((data) => {
        data.projects.push({ id: 'p_with_id', name: '有id项目', createdAt: 1 });
      });
      await seedProject('新项目');
      const { versionId } = await seedVersion('V1');

      const r = await service.record({
        versionId, title: 't', detail: 'd', stage: 'dev',
        project: '新项目',
        sourcePath: path.join(parentPath, 'src'),
        relatedProjects: ['无id项目', '有id项目'],
      });

      const tree = await service.getTree();
      const entry = tree.versions[0].entries[0];
      // 路径命中的项目无 id → 不归属(不得把 undefined 当 projectId),退回传入项目名
      expect(entry.project).toBe('新项目');
      expect(entry.projectId).toBe(tree.projects.find((p) => p.name === '新项目')!.id);
      expect(entry.pathUnmatched).toBe(true);
      // 无 id 的关联项目被跳过,只有有 id 的写入引用
      expect(entry.relatedProjectIds).toEqual(['p_with_id']);
      expect(entry.relatedProjects).toEqual(['有id项目']);
      expect(r.projectId).toBe(entry.projectId);
    });

    it('should keep legacy behavior when sourcePath is absent', async () => {
      const { versionId } = await seedVersion('V1');
      const r = await service.record({ versionId, title: 't', detail: 'd', stage: 'dev' });
      expect(r.warnings).toBeUndefined();
      const tree = await service.getTree();
      const entry = tree.versions[0].entries[0];
      expect(entry.sourcePath).toBeUndefined();
      expect(entry.pathUnmatched).toBeUndefined();
      expect(entry.project).toBeUndefined();
      expect(r.projectId).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------
  // 关联项目(名称解析 → id + 名称快照;改名同步)
  // ---------------------------------------------------------------
  describe('related projects', () => {
    it('should resolve related projects and ignore unknown names with warning', async () => {
      await seedProject('A');
      await seedProject('B');
      const { versionId } = await seedVersion('V1');

      const r = await service.record({
        versionId, title: '跨项目', detail: 'd', stage: 'dev',
        project: 'A', relatedProjects: ['B', '拼错的'],
      });
      expect(r.warnings?.some((w) => w.includes('拼错的'))).toBe(true);

      const tree = await service.getTree();
      const entry = tree.versions[0].entries.find((e) => e.title === '跨项目')!;
      expect(entry.relatedProjects).toEqual(['B']);
      expect(entry.relatedProjectIds).toEqual([
        tree.projects.find((p) => p.name === 'B')!.id,
      ]);
    });

    it('should not write related fields when no name resolves', async () => {
      await seedProject('A');
      const { versionId } = await seedVersion('V1');
      const r = await service.record({
        versionId, title: 'x', detail: 'd', stage: 'dev',
        project: 'A', relatedProjects: ['  ', '不存在'],
      });
      expect(r.warnings?.some((w) => w.includes('不存在'))).toBe(true);
      const tree = await service.getTree();
      const entry = tree.versions[0].entries.find((e) => e.title === 'x')!;
      expect(entry.relatedProjects).toBeUndefined();
      expect(entry.relatedProjectIds).toBeUndefined();
    });

    it('should sync related project name snapshot on rename', async () => {
      await seedProject('A');
      await seedProject('B');
      const { versionId } = await seedVersion('V1');
      await service.record({
        versionId, title: 'x', detail: 'd', stage: 'dev',
        project: 'A', relatedProjects: ['B'],
      });

      await service.renameProject('B', 'B2');
      const tree = await service.getTree();
      const entry = tree.versions[0].entries.find((e) => e.title === 'x')!;
      expect(entry.relatedProjects).toEqual(['B2']);
      // id 引用不随改名变化
      expect(entry.relatedProjectIds).toEqual([
        tree.projects.find((p) => p.name === 'B2')!.id,
      ]);
    });

    it('should set/keep/clear related projects via update', async () => {
      await seedProject('B');
      await seedProject('C');
      await seedProject('A');
      const { versionId } = await seedVersion('V1');
      const r = await service.record({ versionId, title: 't', detail: 'd', stage: 'dev' });

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
      const entry = tree.versions[0].entries.find((e) => e.id === r.entryId)!;
      expect(entry.relatedProjectIds).toBeUndefined();
    });

    it('should filter by related project name, entryId still ignores filters', async () => {
      await seedProject('A');
      await seedProject('B');
      await seedProject('C');
      const { versionId } = await seedVersion('V1');
      const r = await service.record({
        versionId, title: 't', detail: 'd', stage: 'dev',
        project: 'A', relatedProjects: ['B'],
      });

      const hit = await service.query({ relatedProject: 'B' });
      expect(hit.map((e) => e.id)).toEqual([r.entryId]);
      expect(await service.query({ relatedProject: 'C' })).toHaveLength(0);
      // entryId 精确查询保持「忽略其他过滤」语义
      expect(await service.query({ entryId: r.entryId, relatedProject: 'C' })).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------
  // 项目改名:条目名称快照同步
  // ---------------------------------------------------------------
  describe('rename project snapshots', () => {
    it('should sync entry.project snapshot on rename', async () => {
      await seedProject('A');
      const { versionId } = await seedVersion('V1');
      const r = await service.record({
        versionId, title: 't', detail: 'd', stage: 'dev', project: 'A',
      });
      // 迁移前无 id 的旧条目快照:按旧名兜底同步
      await repo.mutate((data) => {
        data.versions[0].entries.push({
          id: 'e_legacy', title: 'legacy', detail: 'd', date: '2026-01-01',
          createdAt: 1, updatedAt: 1, project: 'A',
        });
      });

      await service.renameProject('A', 'A2');

      const tree = await service.getTree();
      const entries = tree.versions[0].entries;
      expect(tree.projects.map((p) => p.name)).toEqual(['A2']);
      expect(entries.find((e) => e.id === r.entryId)!.project).toBe('A2');
      expect(entries.find((e) => e.id === 'e_legacy')!.project).toBe('A2');
      // 按新名过滤能查到旧条目
      expect((await service.query({ project: 'A2' })).map((e) => e.id)).toContain(r.entryId);
    });
  });

  // ---------------------------------------------------------------
  // 文件锁:首次事务失败后必须释放(回归)
  // ---------------------------------------------------------------
  it('should release the file lock after a failed first transaction', async () => {
    // 新库文件尚不存在:首次事务(未知 id)失败后,后续写入不得被残留锁阻塞
    await expect(service.record({
      versionId: 'v_nope', title: 't', detail: 'd', stage: 'dev',
    })).rejects.toThrow(/不存在/);

    const v = await service.createVersion({ name: 'V1', programId: await ensureProgram() });
    await expect(service.record({
      versionId: v.id, title: 't', detail: 'd', stage: 'dev',
    })).resolves.toHaveProperty('entryId');
  });

  // ---------------------------------------------------------------
  // 双实例(模拟 HTTP 进程与 MCP 进程)并发
  // ---------------------------------------------------------------
  it('should not lose updates across two repository instances', async () => {
    const serviceB = new WorklogService(new JsonWorklogRepository(filePath, backupsDir));
    const { versionId } = await seedVersion('V1');
    // 同版本并发写 20 条,两实例各 10
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        (i % 2 === 0 ? service : serviceB).record({
          versionId, title: `entry-${i}`, detail: 'd', stage: 'dev',
        }),
      ),
    );
    const results = await serviceB.query({ versionId, limit: 100 });
    expect(results).toHaveLength(20);
  });
});
