// backend/src/interfaces/mcp/tools/worklog/__tests__/worklog-tools.test.ts
// worklog MCP 工具测试:真实 Service+临时目录;catalog 一致性断言(单一来源守护)。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
    };
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('registered tools should match catalog names/descriptions (single source of truth)', () => {
    const registered = new Map(ALL_TOOLS.map((t) => [t.name, t.description]));
    expect(registered.size).toBe(10); // 9 worklog + save_to_knowledge
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
});
