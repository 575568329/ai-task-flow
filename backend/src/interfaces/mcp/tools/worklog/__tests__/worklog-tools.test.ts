// backend/src/interfaces/mcp/tools/worklog/__tests__/worklog-tools.test.ts
// worklog MCP 工具测试:真实 Service+临时目录;catalog 一致性断言(单一来源守护)。
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
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('registered tools should match catalog names/descriptions (single source of truth)', () => {
    const registered = new Map(ALL_TOOLS.map((t) => [t.name, t.description]));
    expect(registered.size).toBe(12); // 9 worklog + 2 conclusion + save_to_knowledge
    for (const meta of WORKLOG_TOOL_CATALOG) {
      expect(registered.has(meta.name)).toBe(true);
      expect(registered.get(meta.name)).toBe(meta.description);
      expect(HANDLERS[meta.name]).toBeDefined();
    }
  });

  it('record_work should return entryId, path and creation notes', async () => {
    const result = await HANDLERS.record_work(
      { project: 'p', version: 'v1', title: 't', detail: 'd' }, deps,
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('✅ 已记录');
    expect(result.content[0].text).toContain('已新建版本');
    expect(result.content[0].text).toMatch(/e_[0-9a-f]{8}/);

    const tree = await deps.worklogService.getTree();
    expect(tree.projects[0].versions[0].entries).toHaveLength(1);
  });

  it('record_work should return isError with readable message on invalid input', async () => {
    const result = await HANDLERS.record_work({ project: 'a/b', version: 'v', title: 't', detail: 'd' }, deps);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('❌');
    expect(result.content[0].text).toContain('项目名');
  });

  it('query_work should honor includeDiff switch', async () => {
    await HANDLERS.record_work(
      { project: 'p', version: 'v1', title: '修复白屏', detail: 'ENOENT 容错', diff: 'diff --git a/x' }, deps,
    );
    const plain = await HANDLERS.query_work({ keyword: '白屏' }, deps);
    expect(plain.content[0].text).not.toContain('diff --git');
    const withDiff = await HANDLERS.query_work({ keyword: '白屏', includeDiff: true }, deps);
    expect(withDiff.content[0].text).toContain('diff --git');
  });

  it('delete_work should snapshot before deletion', async () => {
    const rec = await deps.worklogService.record({ project: 'p', version: 'v', title: 't', detail: 'd' });
    const result = await HANDLERS.delete_work({ entryId: rec.entryId }, deps);
    expect(result.content[0].text).toContain('✅');
    const backups = await fs.readdir(path.join(tmpDir, 'backups'));
    expect(backups.filter((n) => n.startsWith('backup-'))).toHaveLength(1);
  });

  it('rename_version conflict should fail with isError and not modify', async () => {
    await deps.worklogService.record({ project: 'p', version: 'v1', title: 'a', detail: 'd' });
    await deps.worklogService.record({ project: 'p', version: 'v2', title: 'b', detail: 'd' });
    const result = await HANDLERS.rename_version({ project: 'p', version: 'v1', newName: 'v2' }, deps);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('已存在');
  });

  it('list_projects should render tree summary', async () => {
    await deps.worklogService.record({ project: 'p', version: 'v1', title: 'a', detail: 'd' });
    const result = await HANDLERS.list_projects({}, deps);
    expect(result.content[0].text).toContain('p');
    expect(result.content[0].text).toContain('v1(1 条');
  });

  it('record_work should auto-fill cwd as sourcePath and surface warnings', async () => {
    const spy = vi.spyOn(deps.worklogService, 'record');
    const result = await HANDLERS.record_work(
      { project: 'A', version: 'V1', title: 't', detail: 'd' }, deps,
    );
    expect(result.isError).toBeUndefined();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ sourcePath: process.cwd() }));
    // 测试环境 cwd 未绑定任何项目 → service 返回「路径未归属」告警,应回传给 AI
    expect(result.content[0].text).toContain('⚠');
    expect(result.content[0].text).toContain('路径未归属');
    spy.mockRestore();
  });

  it('record_work should pass relatedProjects and warn on unknown names', async () => {
    await deps.worklogService.record({ project: 'B', version: 'V1', title: 'b', detail: 'd' });
    const result = await HANDLERS.record_work({
      project: 'A', version: 'V1', title: 't', detail: 'd', relatedProjects: ['B', '拼错的'],
    }, deps);
    expect(result.content[0].text).toContain('拼错的');
    const tree = await deps.worklogService.getTree();
    const entry = tree.projects.find((p) => p.name === 'A')!.versions[0].entries[0];
    expect(entry.relatedProjects).toEqual(['B']);
  });

  it('query_work should filter by relatedProject and render 关联 meta', async () => {
    await deps.worklogService.record({ project: 'B', version: 'V1', title: 'b', detail: 'd' });
    await deps.worklogService.record({
      project: 'A', version: 'V1', title: '跨项目', detail: 'd', relatedProjects: ['B'],
    });
    await deps.worklogService.record({ project: 'A', version: 'V1', title: '普通改动', detail: 'd' });
    const result = await HANDLERS.query_work({ relatedProject: 'B' }, deps);
    expect(result.content[0].text).toContain('共 1 条');
    expect(result.content[0].text).toContain('关联:B');
    expect(result.content[0].text).not.toContain('普通改动');
  });

  it('query_work should mark entries recorded from an unmatched path', async () => {
    await HANDLERS.record_work({ project: 'A', version: 'V1', title: '路径记录', detail: 'd' }, deps);
    const result = await HANDLERS.query_work({ keyword: '路径记录' }, deps);
    expect(result.content[0].text).toContain('路径未归属');
  });

  it('list_projects should show id and path tail, never the full absolute path', async () => {
    await deps.worklogService.record({ project: 'A', version: 'V1', title: 'a', detail: 'd' });
    await deps.worklogService.record({ project: 'B', version: 'V1', title: 'b', detail: 'd' });
    const idA = (await deps.worklogService.getTree()).projects.find((p) => p.name === 'A')!.id;
    const deepPath = path.join(tmpDir, 'deep', 'repo');
    await deps.worklogService.bindProjectPaths('A', [deepPath]);

    const result = await HANDLERS.list_projects({}, deps);
    const text = result.content[0].text;
    expect(text).toContain(idA);
    expect(text).toContain('…deep\\repo'); // 尾段(两级,反斜杠分隔)
    expect(text).not.toContain(deepPath);  // 隐私红线:不出完整绝对路径
    expect(text).toContain('未绑定路径');   // B 未绑定
  });
});
