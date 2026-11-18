import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ConclusionService } from '../../../../../application/conclusion/ConclusionService.js';
import { JsonConclusionRepository } from '../../../../../infrastructure/persistence/JsonConclusionRepository.js';
import { handle as record } from '../record-conclusion.js';
import { handle as query } from '../query-conclusions.js';
import type { ToolDeps } from '../../types.js';

describe('conclusion MCP tools', () => {
  let tmpDir: string;
  let deps: ToolDeps;

  beforeEach(async () => {
    const { nanoid } = await import('nanoid');
    tmpDir = path.join(os.tmpdir(), `conclusion-mcp-${nanoid()}`);
    const service = new ConclusionService(
      new JsonConclusionRepository(path.join(tmpDir, 'conclusions.json'), path.join(tmpDir, 'backups')),
    );
    deps = {
      knowledgeService: undefined as never,
      worklogService: undefined as never,
      conclusionService: service,
      mcpSource: {
        tool: 'claude-code',
        conversationId: 'sess-1',
        cwd: '/repo',
      },
    };
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should create then read full latest through query cardId mode', async () => {
    const created = await record({
      scope: 'project', project: 'ai-task-flow', title: '全局搜索',
      decision: '旧结论', data: '旧数据', conversationName: '话题A',
    }, deps);
    expect(created.isError).toBeFalsy();
    const id = (created.content[0].text.match(/c_[a-z0-9]+/) ?? [])[0];
    expect(id).toBeTruthy();

    const detail = await query({ cardId: id }, deps);
    expect(detail.isError).toBeFalsy();
    expect(detail.content[0].text).toContain('旧结论');
    expect(detail.content[0].text).toContain('旧数据');
    expect(detail.content[0].text).toContain('话题A');
  });

  it('should append with inherited fields and reject missing changeNote', async () => {
    const created = await record({
      scope: 'project', project: 'p', title: 't', decision: 'd', data: 'd1',
    }, deps);
    const id = (created.content[0].text.match(/c_[a-z0-9]+/) ?? [])[0];

    const appended = await record({
      cardId: id, expectedRev: 1, data: 'd2', changeNote: '补数据',
    }, deps);
    expect(appended.isError).toBeFalsy();
    expect(appended.content[0].text).toContain('rev 2');

    const bad = await record({ cardId: id, data: 'd3' }, deps);
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain('变更说明');
  });

  it('should search and return matchedRev for history hits', async () => {
    const created = await record({
      scope: 'project', project: 'p', title: 't', decision: '旧结论：前端',
    }, deps);
    const id = (created.content[0].text.match(/c_[a-z0-9]+/) ?? [])[0];
    await record({ cardId: id, decision: '新结论：服务端', changeNote: '改方案' }, deps);

    const res = await query({ keyword: '前端' }, deps);
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain('命中 rev 1');
  });
});
