// backend/src/interfaces/mcp/tools/__tests__/save-to-knowledge.test.ts
// save_to_knowledge:关联元数据写入、未知 id / 非法 stage 降级不阻断文档保存
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { KnowledgeService } from '../../../../application/knowledge/KnowledgeService.js';
import { WorklogService } from '../../../../application/worklog/WorklogService.js';
import { JsonWorklogRepository } from '../../../../infrastructure/persistence/JsonWorklogRepository.js';
import { HANDLERS } from '../index.js';
import type { ToolDeps } from '../types.js';

describe('save_to_knowledge MCP tool', () => {
  let tmpDir: string;
  let knowledgeRoot: string;
  let deps: ToolDeps;

  beforeEach(async () => {
    const { nanoid } = await import('nanoid');
    tmpDir = path.join(os.tmpdir(), `kb-mcp-${nanoid()}`);
    knowledgeRoot = path.join(tmpDir, 'knowledge-base');
    await fs.mkdir(knowledgeRoot, { recursive: true });
    deps = {
      knowledgeService: new KnowledgeService(knowledgeRoot),
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

  it('should write valid associations into frontmatter', async () => {
    const project = await deps.worklogService.createProject({ name: 'ai-task-flow' });
    const version = await deps.worklogService.createVersion({ name: 'V1' });
    const requirement = await deps.worklogService.createRequirement({
      versionId: version.id,
      title: '需求A',
    });

    const result = await HANDLERS.save_to_knowledge(
      {
        title: '设计',
        content: '# 正文',
        versionId: version.id,
        requirementId: requirement.id,
        projectId: project.id,
        stage: 'design',
      },
      deps,
    );

    const text = result.content[0].text;
    expect(text).toContain('已写入知识库');
    expect(text).toContain('**关联**');
    expect(text).not.toContain('⚠');

    const doc = await deps.knowledgeService.getDoc(readOnlyPath(text));
    expect(doc.frontmatter).toEqual({
      versionId: version.id,
      requirementId: requirement.id,
      projectId: project.id,
      stage: 'design',
    });
    expect(doc.content).toBe('# 正文');
  });

  it('should degrade unknown ids to unassociated and still save the document', async () => {
    const result = await HANDLERS.save_to_knowledge(
      {
        title: '未知关联',
        content: '正文',
        versionId: 'v_nope',
        requirementId: 'r_nope',
        projectId: 'p_nope',
      },
      deps,
    );

    const text = result.content[0].text;
    expect(text).toContain('已写入知识库');
    expect(text).toContain('版本 id "v_nope" 不存在');
    expect(text).toContain('需求 id "r_nope" 不存在');
    expect(text).toContain('项目 id "p_nope" 不存在');

    const doc = await deps.knowledgeService.getDoc(readOnlyPath(text));
    expect(doc.frontmatter).toBeUndefined();
    expect(doc.content).toBe('正文');
  });

  it('should degrade invalid stage to unassociated and still save the document', async () => {
    const result = await HANDLERS.save_to_knowledge(
      { title: '非法阶段', content: '正文', stage: 'not-a-stage' },
      deps,
    );

    const text = result.content[0].text;
    expect(text).toContain('已写入知识库');
    expect(text).toContain('不是合法阶段');

    const doc = await deps.knowledgeService.getDoc(readOnlyPath(text));
    expect(doc.frontmatter).toBeUndefined();
  });
});

/** 从成功文案中提取 `**路径**: `x`` 的文档路径 */
function readOnlyPath(text: string): string {
  const match = text.match(/\*\*路径\*\*: `([^`]+)`/);
  if (!match) throw new Error(`路径未出现在返回文案: ${text}`);
  return match[1];
}
