// backend/src/interfaces/mcp/tools/worklog/__tests__/worklog-tools.test.ts
// worklog MCP 工具测试:真实 Service+临时目录;catalog 一致性断言(单一来源守护)。
// 新模型:版本/需求由用户在页面创建(测试里用 service.createVersion/createRequirement 播种),
// 项目是字典(createProject 播种),AI 只传 id。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WorklogService } from '../../../../../application/worklog/WorklogService.js';
import { JsonWorklogRepository } from '../../../../../infrastructure/persistence/JsonWorklogRepository.js';
import { ALL_TOOLS, HANDLERS } from '../../index.js';
import { WORKLOG_TOOL_CATALOG } from '@ai-task-flow/shared';
import type { ToolDeps } from '../../types.js';

describe('worklog MCP tools', () => {
  let tmpDir: string;
  let deps: ToolDeps;
  let programId: string;
  const PROGRAM_NAME = '澳门底层数据建设';

  /** 建「版本 + 需求」组合(record 的前置条件) */
  async function seedVersionRequirement(versionName = 'V1', requirementTitle = 'R') {
    const version = await deps.worklogService.createVersion({ name: versionName, programId });
    const requirement = await deps.worklogService.createRequirement({
      versionId: version.id,
      title: requirementTitle,
    });
    return { versionId: version.id, requirementId: requirement.id };
  }

  beforeEach(async () => {
    const { nanoid } = await import('nanoid');
    tmpDir = path.join(os.tmpdir(), `worklog-mcp-${nanoid()}`);
    deps = {
      knowledgeService: {} as ToolDeps['knowledgeService'],
      worklogService: new WorklogService(
        new JsonWorklogRepository(path.join(tmpDir, 'worklog.json'), path.join(tmpDir, 'backups')),
      ),
      conclusionService: {} as ToolDeps['conclusionService'],
      mcpSource: { tool: 'manual' },
    };
    // 版本必须归属已存在的主题:每个用例先播种一个,供 createVersion 使用
    programId = (await deps.worklogService.createProgram({ name: PROGRAM_NAME })).id;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('registered tools should match catalog names/descriptions (single source of truth)', () => {
    const registered = new Map(ALL_TOOLS.map((t) => [t.name, t.description]));
    expect(registered.size).toBe(15); // 12 worklog + 2 conclusion + save_to_knowledge
    expect(WORKLOG_TOOL_CATALOG).toHaveLength(12);
    for (const meta of WORKLOG_TOOL_CATALOG) {
      expect(registered.has(meta.name)).toBe(true);
      expect(registered.get(meta.name)).toBe(meta.description);
      expect(HANDLERS[meta.name]).toBeDefined();
    }
  });

  it('record_work should reject unknown version id with actionable message', async () => {
    const result = await HANDLERS.record_work(
      { versionId: 'v_nope', requirementId: 'r_nope', title: 't', detail: 'd', stage: 'dev' }, deps,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('请让用户在页面创建并复制 id');
  });

  it('record_work should require versionId/requirementId/stage', async () => {
    const missingIds = await HANDLERS.record_work({ title: 't', detail: 'd', stage: 'dev' }, deps);
    expect(missingIds.isError).toBe(true);
    expect(missingIds.content[0].text).toContain('versionId 与 requirementId 必填');

    const { versionId, requirementId } = await seedVersionRequirement();
    const missingStage = await HANDLERS.record_work(
      { versionId, requirementId, title: 't', detail: 'd' }, deps,
    );
    expect(missingStage.isError).toBe(true);
    expect(missingStage.content[0].text).toContain('stage 必填');
  });

  it('record_work should record into given ids and echo version/requirement', async () => {
    const { versionId, requirementId } = await seedVersionRequirement('V1', 'R');
    const result = await HANDLERS.record_work(
      { versionId, requirementId, title: 't', detail: 'd', stage: 'dev' }, deps,
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('✅ 已记录');
    expect(result.content[0].text).toContain('V1');
    expect(result.content[0].text).toContain('R');
    expect(result.content[0].text).toMatch(/e_[0-9a-f]{8}/);

    const tree = await deps.worklogService.getTree();
    expect(tree.versions).toHaveLength(1);
    expect(tree.versions[0].requirements[0].entries).toHaveLength(1);
  });

  it('query_work should honor includeDiff switch and render version/requirement', async () => {
    const { versionId, requirementId } = await seedVersionRequirement('V8.0.8', '澳门底层数据建设');
    await HANDLERS.record_work({
      versionId, requirementId, title: '修复白屏', detail: 'ENOENT 容错', diff: 'diff --git a/x', stage: 'dev',
    }, deps);

    const plain = await HANDLERS.query_work({ keyword: '白屏' }, deps);
    expect(plain.content[0].text).not.toContain('diff --git');
    expect(plain.content[0].text).toContain('V8.0.8');
    expect(plain.content[0].text).toContain('澳门底层数据建设');
    expect(plain.content[0].text).toContain(`主题:${PROGRAM_NAME}`);

    const withDiff = await HANDLERS.query_work({ keyword: '白屏', includeDiff: true }, deps);
    expect(withDiff.content[0].text).toContain('diff --git a/x');
  });

  it('query_work should still return entries without theme when program map fails', async () => {
    const { versionId, requirementId } = await seedVersionRequirement('V8.0.8', 'R');
    await deps.worklogService.record({
      versionId, requirementId, title: '降级查询', detail: 'd', stage: 'dev',
    });

    const treeSpy = vi.spyOn(deps.worklogService, 'getTree').mockRejectedValueOnce(new Error('树读取失败'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await HANDLERS.query_work({ keyword: '降级查询' }, deps);
      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;
      expect(text).toContain('降级查询'); // 条目照常返回
      expect(text).not.toContain('主题:'); // 主题名降级省略
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('query_work 构建版本主题映射失败'));
    } finally {
      treeSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('query_work should filter by versionId and requirementId', async () => {
    const a = await seedVersionRequirement('V1', 'R1');
    const b = await seedVersionRequirement('V2', 'R2');
    await deps.worklogService.record({ ...a, title: '甲', detail: 'd', stage: 'dev' });
    await deps.worklogService.record({ ...b, title: '乙', detail: 'd', stage: 'dev' });

    const byVersion = await HANDLERS.query_work({ versionId: b.versionId }, deps);
    expect(byVersion.content[0].text).toContain('乙');
    expect(byVersion.content[0].text).not.toContain('甲');

    const byRequirement = await HANDLERS.query_work({ requirementId: a.requirementId }, deps);
    expect(byRequirement.content[0].text).toContain('甲');
    expect(byRequirement.content[0].text).not.toContain('乙');
  });

  it('delete_work should snapshot before deletion', async () => {
    await deps.worklogService.createProject({ name: 'p' });
    const { versionId, requirementId } = await seedVersionRequirement();
    const rec = await deps.worklogService.record({
      versionId, requirementId, project: 'p', title: 't', detail: 'd', stage: 'dev',
    });
    const countBackups = async () =>
      (await fs.readdir(path.join(tmpDir, 'backups'))).filter((n) => n.startsWith('backup-')).length;
    const before = await countBackups(); // createProject 也会备份,只断言删除新增一份
    const result = await HANDLERS.delete_work({ entryId: rec.entryId }, deps);
    expect(result.content[0].text).toContain('✅');
    expect(await countBackups()).toBe(before + 1);
  });

  it('rename_version conflict should fail with isError and not modify', async () => {
    // 新签名按 versionId 操作:两个版本建好后,把 v1 改成已存在的 v2 名应冲突
    await deps.worklogService.createVersion({ name: 'V1', programId });
    const v1 = (await deps.worklogService.getTree()).versions.find((v) => v.name === 'V1')!;
    await deps.worklogService.createVersion({ name: 'V2', programId });
    const result = await HANDLERS.rename_version({ versionId: v1.id, newName: 'V2' }, deps);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('已存在');
  });

  it('delete_version should delete by versionId', async () => {
    const { versionId } = await seedVersionRequirement('V-del', 'R');
    const result = await HANDLERS.delete_version({ versionId }, deps);
    expect(result.content[0].text).toContain('✅');
    expect((await deps.worklogService.getTree()).versions).toHaveLength(0);
  });

  it('list_projects should render project dict with id and entry count', async () => {
    await deps.worklogService.createProject({ name: 'p' });
    const { versionId, requirementId } = await seedVersionRequirement();
    await deps.worklogService.record({
      versionId, requirementId, project: 'p', title: 'a', detail: 'd', stage: 'dev',
    });
    const result = await HANDLERS.list_projects({}, deps);
    const text = result.content[0].text;
    expect(text).toContain('p');
    expect(text).toContain('条目 1');
    expect(text).toContain('list_versions');
  });

  it('record_work should auto-fill cwd as sourcePath and surface warnings', async () => {
    // 先让某个项目绑定路径(且 cwd 落在范围外):此时未命中才是配置异常,service 才会告警
    await deps.worklogService.createProject({ name: 'A', paths: [path.resolve('x-other-project')] });
    const { versionId, requirementId } = await seedVersionRequirement();

    const spy = vi.spyOn(deps.worklogService, 'record');
    const result = await HANDLERS.record_work(
      { versionId, requirementId, project: 'A', title: 't', detail: 'd', stage: 'dev' }, deps,
    );
    expect(result.isError).toBeUndefined();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ sourcePath: process.cwd() }));
    // 有绑定却未命中 → service 返回「路径未归属」告警,应回传给 AI
    expect(result.content[0].text).toContain('⚠');
    expect(result.content[0].text).toContain('路径未归属');
    spy.mockRestore();
  });

  it('record_work should pass relatedProjects and warn on unknown names', async () => {
    await deps.worklogService.createProject({ name: 'A' });
    await deps.worklogService.createProject({ name: 'B' });
    const { versionId, requirementId } = await seedVersionRequirement();
    const result = await HANDLERS.record_work({
      versionId, requirementId, project: 'A', title: 't', detail: 'd',
      relatedProjects: ['B', '拼错的'], stage: 'dev',
    }, deps);
    expect(result.content[0].text).toContain('拼错的');
    const tree = await deps.worklogService.getTree();
    const entry = tree.versions[0].requirements[0].entries[0];
    expect(entry.relatedProjects).toEqual(['B']);
  });

  it('query_work should filter by relatedProject and render 关联 meta', async () => {
    await deps.worklogService.createProject({ name: 'A' });
    await deps.worklogService.createProject({ name: 'B' });
    const { versionId, requirementId } = await seedVersionRequirement();
    await deps.worklogService.record({
      versionId, requirementId, project: 'A', title: '跨项目', detail: 'd', relatedProjects: ['B'], stage: 'dev',
    });
    await deps.worklogService.record({
      versionId, requirementId, project: 'A', title: '普通改动', detail: 'd', stage: 'dev',
    });
    const result = await HANDLERS.query_work({ relatedProject: 'B' }, deps);
    expect(result.content[0].text).toContain('共 1 条');
    expect(result.content[0].text).toContain('关联:B');
    expect(result.content[0].text).not.toContain('普通改动');
  });

  it('query_work should mark entries recorded from an unmatched path', async () => {
    const { versionId, requirementId } = await seedVersionRequirement();
    await HANDLERS.record_work({ versionId, requirementId, title: '路径记录', detail: 'd', stage: 'dev' }, deps);
    const result = await HANDLERS.query_work({ keyword: '路径记录' }, deps);
    expect(result.content[0].text).toContain('路径未归属');
  });

  it('list_projects should show id and path tail, never the full absolute path', async () => {
    await deps.worklogService.createProject({ name: 'A' });
    await deps.worklogService.createProject({ name: 'B' });
    const idA = (await deps.worklogService.getTree()).projects.find((p) => p.name === 'A')!.id;
    const deepPath = path.join(tmpDir, 'deep', 'repo');
    await deps.worklogService.bindProjectPaths('A', [deepPath]);

    const result = await HANDLERS.list_projects({}, deps);
    const text = result.content[0].text;
    expect(text).toContain(idA);
    expect(text).toContain('…deep\\repo'); // 尾段(两级,反斜杠分隔)
    expect(text).not.toContain(deepPath);  // 隐私红线:不出完整绝对路径
    expect(text).not.toContain(tmpDir);    // 防部分泄漏:连临时目录前缀也不得出现
    expect(text).toContain('未绑定路径');   // B 未绑定
  });

  it('list_projects should mask two-segment bindings down to the last segment', async () => {
    await deps.worklogService.createProject({ name: 'A' });
    const root = path.parse(process.cwd()).root; // Windows "D:\",POSIX "/"
    const twoSegment = path.join(root, 'Study'); // Windows "D:\Study",POSIX "/Study"
    await deps.worklogService.bindProjectPaths('A', [twoSegment]);

    const text = (await HANDLERS.list_projects({}, deps)).content[0].text;
    if (path.sep === '\\') {
      expect(text).toContain('…\\Study');
      expect(text).not.toContain(twoSegment); // 两段也不得原样输出完整绝对路径
    } else {
      // POSIX 下 /Study 本身就是完整路径,只能掩到 …/Study
      expect(text).toContain('…/Study');
    }
  });

  it('list_versions should list versions with ids and counts', async () => {
    const version = await deps.worklogService.createVersion({ name: 'V8.0.8', programId });
    const requirement = await deps.worklogService.createRequirement({
      versionId: version.id, title: 'R',
    });
    await deps.worklogService.record({
      versionId: version.id, requirementId: requirement.id, title: 't', detail: 'd', stage: 'dev',
    });

    const result = await HANDLERS.list_versions({}, deps);
    const text = result.content[0].text;
    expect(text).toContain('V8.0.8');
    expect(text).toContain(version.id);
    expect(text).toContain(PROGRAM_NAME); // 每行带所属主题名
    expect(text).toContain('需求 1');
    expect(text).toContain('条目 1');
  });

  it('list_programs should list programs with ids and counts', async () => {
    const other = await deps.worklogService.createProgram({ name: '大陆建设' });
    const version = await deps.worklogService.createVersion({ name: 'V8.0.8', programId });
    const requirement = await deps.worklogService.createRequirement({
      versionId: version.id, title: 'R',
    });
    await deps.worklogService.record({
      versionId: version.id, requirementId: requirement.id, title: 'a', detail: 'd', stage: 'dev',
    });
    await deps.worklogService.record({
      versionId: version.id, requirementId: requirement.id, title: 'b', detail: 'd', stage: 'dev',
    });

    const text = (await HANDLERS.list_programs({}, deps)).content[0].text;
    expect(text).toContain(PROGRAM_NAME);
    expect(text).toContain(programId);
    expect(text).toContain('版本 1');
    expect(text).toContain('条目 2');
    expect(text).toContain(other.id);
    expect(text).toContain('版本 0');
  });

  it('list_programs should hint to create a program when none exists', async () => {
    const emptyDeps: ToolDeps = {
      ...deps,
      worklogService: new WorklogService(
        new JsonWorklogRepository(path.join(tmpDir, 'empty', 'worklog.json'), path.join(tmpDir, 'empty', 'backups')),
      ),
    };
    const text = (await HANDLERS.list_programs({}, emptyDeps)).content[0].text;
    expect(text).toContain('暂无建设主题');
    expect(text).toContain('请在页面新建');
  });

  it('list_versions should filter by programId and show program name', async () => {
    const other = await deps.worklogService.createProgram({ name: '大陆建设' });
    await deps.worklogService.createVersion({ name: 'V8.0.8', programId });
    await deps.worklogService.createVersion({ name: 'V1.0.0', programId: other.id });

    const text = (await HANDLERS.list_versions({ programId }, deps)).content[0].text;
    expect(text).toContain('V8.0.8');
    expect(text).toContain(PROGRAM_NAME);
    expect(text).toContain('共 1 个');
    expect(text).not.toContain('V1.0.0');
  });

  it('list_versions should reject unknown programId with candidates', async () => {
    const result = await HANDLERS.list_versions({ programId: 'g_nope' }, deps);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(PROGRAM_NAME);
    expect(result.content[0].text).toContain('请让用户在页面新建主题并复制 id');
  });

  it('list_requirements should list requirements for a version', async () => {
    const version = await deps.worklogService.createVersion({ name: 'V8.0.8', programId });
    const requirement = await deps.worklogService.createRequirement({
      versionId: version.id, title: '澳门底层数据建设',
    });

    const text = (await HANDLERS.list_requirements({ versionId: version.id }, deps)).content[0].text;
    expect(text).toContain('澳门底层数据建设');
    expect(text).toContain(requirement.id);
    expect(text).toContain(version.id);
    expect(text).toContain('关联: 无');
    expect(text).toContain('条目 0');
  });

  it('list_requirements should reject unknown version id with candidates', async () => {
    await deps.worklogService.createVersion({ name: 'V8.0.8', programId });
    const result = await HANDLERS.list_requirements({ versionId: 'v_nope' }, deps);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('V8.0.8');
    expect(result.content[0].text).toContain('请让用户在页面创建并复制 id');
  });

  it('record_work should ignore non-array tags/relatedProjects/files with a notice', async () => {
    const { versionId, requirementId } = await seedVersionRequirement();
    const result = await HANDLERS.record_work({
      versionId, requirementId, title: 't', detail: 'd', stage: 'dev',
      tags: 'feat', relatedProjects: 'A', files: 'x',
    }, deps);
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain('tags 不是字符串数组,已忽略');
    expect(text).toContain('relatedProjects 不是字符串数组,已忽略');
    expect(text).toContain('files 不是数组,已忽略');

    const entry = (await deps.worklogService.getTree()).versions[0].requirements[0].entries[0];
    expect(entry.tags).toBeUndefined();
    expect(entry.relatedProjects).toBeUndefined();
    expect(entry.files).toBeUndefined();
  });

  it('record_work should drop non-string array items but keep valid ones', async () => {
    await deps.worklogService.createProject({ name: 'A' });
    const { versionId, requirementId } = await seedVersionRequirement();
    const result = await HANDLERS.record_work({
      versionId, requirementId, title: 't', detail: 'd', stage: 'dev',
      tags: ['feat', 1], relatedProjects: ['A', 2],
    }, deps);
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('tags 中有 1 个非字符串项,已忽略');
    expect(result.content[0].text).toContain('relatedProjects 中有 1 个非字符串项,已忽略');

    const entry = (await deps.worklogService.getTree()).versions[0].requirements[0].entries[0];
    expect(entry.tags).toEqual(['feat']);
    expect(entry.relatedProjects).toEqual(['A']);
  });

  it('update_work should ignore non-array tags/relatedProjects/files with a notice', async () => {
    const { versionId, requirementId } = await seedVersionRequirement();
    const rec = await deps.worklogService.record({
      versionId, requirementId, title: 't', detail: 'd', stage: 'dev',
    });
    const result = await HANDLERS.update_work({
      entryId: rec.entryId, tags: 'fix', relatedProjects: 'A', files: 'x',
    }, deps);
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain('tags 不是字符串数组,已忽略');
    expect(text).toContain('relatedProjects 不是字符串数组,已忽略');
    expect(text).toContain('files 不是数组,已忽略');
  });

  it('delete_project should only remove the dictionary entry and say entries are kept', async () => {
    await deps.worklogService.createProject({ name: 'A' });
    const { versionId, requirementId } = await seedVersionRequirement();
    await deps.worklogService.record({
      versionId, requirementId, project: 'A', title: 't', detail: 'd', stage: 'dev',
    });

    const result = await HANDLERS.delete_project({ project: 'A' }, deps);
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain('已从项目字典移除「A」');
    expect(text).toContain('历史条目不删除');
    expect(text).not.toContain('全部版本与条目');

    // 实现与文案一致:字典清空,历史条目与项目名快照仍在
    const tree = await deps.worklogService.getTree();
    expect(tree.projects).toHaveLength(0);
    expect(tree.versions[0].requirements[0].entries[0].project).toBe('A');
  });

  it('record_work should list existing projects when explicit project is unknown', async () => {
    await deps.worklogService.createProject({ name: '资源加工平台' });
    const { versionId, requirementId } = await seedVersionRequirement();
    const result = await HANDLERS.record_work({
      versionId, requirementId, project: '拼错的', title: 't', detail: 'd', stage: 'dev',
    }, deps);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('现有项目');
    expect(result.content[0].text).toContain('资源加工平台(');
  });
});
