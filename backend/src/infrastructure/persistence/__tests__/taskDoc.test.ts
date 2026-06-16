// backend/src/infrastructure/persistence/__tests__/taskDoc.test.ts
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { buildTaskMarkdown } from '../taskDoc.js';
import { Task } from '../../../domain/workflow/entities/Task.js';
import { TaskId } from '../../../domain/workflow/value-objects/TaskId.js';
import { TaskStatus } from '../../../domain/workflow/value-objects/TaskStatus.js';
import { Priority } from '../../../domain/workflow/value-objects/Priority.js';

/** 构造最小可用 Task,其余字段默认 */
function makeTask(opts: {
  source?: 'web' | 'manual';
  sourceUrl?: string;
  repoPath?: string;
  projectName?: string;
} = {}): Task {
  return new Task(
    TaskId.create('TEST', 1),
    '示例任务',
    '描述内容',
    TaskStatus.TODO,
    Priority.P1,
    opts.repoPath,
    opts.projectName,
    [],
    [],
    undefined,
    undefined,
    new Date(),
    new Date(),
    opts.source ?? 'manual',
    opts.sourceUrl,
  );
}

describe('buildTaskMarkdown', () => {
  it('should output source and sourceUrl for web tasks', () => {
    const task = makeTask({ source: 'web', sourceUrl: 'https://example.com/bug/1' });
    const md = buildTaskMarkdown(task);
    expect(md).toContain('**来源**: 网页剪藏');
    expect(md).toContain('**网页地址**: https://example.com/bug/1');
  });

  it('should not output web source block for manual tasks', () => {
    const task = makeTask({ source: 'manual' });
    const md = buildTaskMarkdown(task);
    expect(md).not.toContain('网页剪藏');
    expect(md).not.toContain('**网页地址**');
  });

  it('should output both web source and project info when both present', () => {
    // web 任务同时关联了项目路径(详情放开后常见):网页地址 + 项目 + 仓库路径共存
    const task = makeTask({
      source: 'web',
      sourceUrl: 'https://example.com/bug/1',
      projectName: 'rmp',
      repoPath: 'D:/xunfei/rmp',
    });
    const md = buildTaskMarkdown(task);
    expect(md).toContain('**网页地址**: https://example.com/bug/1');
    expect(md).toContain('**项目**: rmp');
    expect(md).toContain('**仓库路径**: `D:/xunfei/rmp`');
  });

  it('should not output empty web address line when sourceUrl missing', () => {
    // web 来源但没抓到地址:标来源,但不输出空的「网页地址」行
    const task = makeTask({ source: 'web' });
    const md = buildTaskMarkdown(task);
    expect(md).toContain('**来源**: 网页剪藏');
    expect(md).not.toContain('**网页地址**');
  });
});
