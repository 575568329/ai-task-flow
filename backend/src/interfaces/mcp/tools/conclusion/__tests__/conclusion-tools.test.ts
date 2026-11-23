import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ConclusionService } from '../../../../../application/conclusion/ConclusionService.js';
import { JsonConclusionRepository } from '../../../../../infrastructure/persistence/JsonConclusionRepository.js';
import { WorklogService } from '../../../../../application/worklog/WorklogService.js';
import { JsonWorklogRepository } from '../../../../../infrastructure/persistence/JsonWorklogRepository.js';
import { handle as record } from '../record-conclusion.js';
import { handle as query, toolDef as queryToolDef } from '../query-conclusions.js';
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
    const worklogService = new WorklogService(
      new JsonWorklogRepository(
        path.join(tmpDir, 'worklog.json'),
        path.join(tmpDir, 'worklog-backups'),
      ),
    );
    deps = {
      knowledgeService: undefined as never,
      worklogService,
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

  it('should auto-append same conversation without cardId', async () => {
    const first = await record({
      scope: 'project', project: 'p', title: 't', decision: 'd1',
    }, deps);
    const firstText = first.content[0].text;
    const id = (firstText.match(/c_[a-z0-9]+/) ?? [])[0];
    expect(firstText).toContain('已创建结论卡');

    const second = await record({ data: 'd2', changeNote: '同会话补充' }, deps);
    expect(second.isError).toBeFalsy();
    expect(second.content[0].text).toContain('已续写同一会话结论卡');
    expect(second.content[0].text).toContain('rev 2');

    const other = await record({
      scope: 'project', project: 'p', title: 't', decision: 'd1',
    }, { ...deps, mcpSource: { ...deps.mcpSource, conversationId: 'sess-2' } });
    expect(other.isError).toBeFalsy();
    expect(other.content[0].text).toContain('已创建结论卡');
    expect(other.content[0].text).not.toContain(id);
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

  it('should reject cross-conversation append by default and allow with flag', async () => {
    const created = await record({
      scope: 'project', project: 'p', title: 't', decision: 'd',
    }, deps);
    const id = (created.content[0].text.match(/c_[a-z0-9]+/) ?? [])[0];
    const otherDeps: ToolDeps = {
      ...deps,
      mcpSource: { ...deps.mcpSource, conversationId: 'sess-2' },
    };

    const rejected = await record({ cardId: id, data: 'x', changeNote: '跨对话' }, otherDeps);
    expect(rejected.isError).toBe(true);
    expect(rejected.content[0].text).toContain('默认一对话一卡');

    const allowed = await record({
      cardId: id, data: 'x', changeNote: '跨对话', allowCrossConversation: true,
    }, otherDeps);
    expect(allowed.isError).toBeFalsy();
    expect(allowed.content[0].text).toContain('rev 2');
  });

  it('should resolve project id and warn on unknown related projects', async () => {
    await deps.worklogService.record({ project: '题库', version: 'v1', title: 't', detail: 'd' });
    const projectId = (await deps.worklogService.getTree()).projects[0].id;

    const created = await record({
      scope: 'project', project: '题库', title: '联调', decision: 'd',
      relatedProjects: ['不存在', '题库'],
    }, deps);
    expect(created.isError).toBeFalsy();
    expect(created.content[0].text).toContain('不存在');
    const id = (created.content[0].text.match(/c_[a-z0-9]+/) ?? [])[0];
    expect(id).toBeTruthy();

    const detail = await query({ cardId: id! }, deps);
    expect(detail.isError).toBeFalsy();
    // 存储层字段可直接从 service 读回验证
    const card = await deps.conclusionService.get(id!);
    expect(card.projectId).toBe(projectId);
    expect(card.relatedProjects).toEqual(['题库']);
    expect(card.relatedProjectIds).toEqual([projectId]);
  });

  it('should expose and pass through relatedProject filter', async () => {
    expect(queryToolDef.inputSchema.properties).toHaveProperty('relatedProject');
    await deps.worklogService.record({ project: '题库', version: 'v1', title: 't', detail: 'd' });
    await record({
      scope: 'project', project: '题库', title: '跨项目卡', decision: 'd',
      relatedProjects: ['题库'],
    }, deps);
    await record({
      scope: 'personal', title: '个人卡', decision: 'd2',
    }, { ...deps, mcpSource: { ...deps.mcpSource, conversationId: 'sess-2' } });

    const hit = await query({ relatedProject: '题库' }, deps);
    expect(hit.isError).toBeFalsy();
    expect(hit.content[0].text).toContain('跨项目卡');
    expect(hit.content[0].text).not.toContain('个人卡');

    const miss = await query({ relatedProject: '未关联' }, deps);
    expect(miss.content[0].text).toContain('未找到');
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
