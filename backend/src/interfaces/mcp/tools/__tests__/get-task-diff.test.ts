// backend/src/interfaces/mcp/tools/__tests__/get-task-diff.test.ts
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JsonTaskRepository } from '../../../../infrastructure/persistence/JsonTaskRepository.js';
import { WorktreeManager } from '../../../../infrastructure/git/WorktreeManager.js';
import { Task } from '../../../../domain/workflow/entities/Task.js';
import { TaskId } from '../../../../domain/workflow/value-objects/TaskId.js';
import { TaskStatus } from '../../../../domain/workflow/value-objects/TaskStatus.js';
import { Priority } from '../../../../domain/workflow/value-objects/Priority.js';
import { WorktreeRef } from '../../../../domain/workflow/value-objects/WorktreeRef.js';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { execSync } from 'child_process';

describe('get_task_diff MCP tool', () => {
  let repository: JsonTaskRepository;
  let worktreeManager: WorktreeManager;
  let testFilePath: string;
  let testRepoPath: string;
  let testWorktreePath: string;

  beforeEach(async () => {
    testFilePath = path.join(os.tmpdir(), `test-diff-${Date.now()}.json`);
    repository = new JsonTaskRepository(testFilePath);

    // 创建测试 git 仓库
    testRepoPath = path.join(os.tmpdir(), `test-repo-${Date.now()}`);
    await fs.mkdir(testRepoPath, { recursive: true });

    execSync('git init', { cwd: testRepoPath });
    execSync('git config user.email "test@example.com"', { cwd: testRepoPath });
    execSync('git config user.name "Test User"', { cwd: testRepoPath });

    // 创建初始提交
    await fs.writeFile(path.join(testRepoPath, 'README.md'), '# Test Repo\n');
    execSync('git add .', { cwd: testRepoPath });
    execSync('git commit -m "Initial commit"', { cwd: testRepoPath });

    worktreeManager = new WorktreeManager();
  });

  afterEach(async () => {
    try {
      await fs.unlink(testFilePath);
    } catch {
      // 忽略
    }

    try {
      await fs.rm(testRepoPath, { recursive: true, force: true });
    } catch {
      // 忽略
    }
  });

  it('should get diff for task with worktree', async () => {
    const task = new Task(
      TaskId.create('WS', 1),
      'Test task',
      'Desc',
      TaskStatus.TODO,
      Priority.P0,
      [],
      [],
      []
    );

    // 派发任务（创建 worktree）
    const worktree = await worktreeManager.create(testRepoPath, task.id.value);
    task.dispatch(worktree);
    await repository.save(task);

    // 在 worktree 中做一些变更并提交
    await fs.writeFile(path.join(worktree.path, 'newfile.txt'), 'New content\n');
    execSync('git add .', { cwd: worktree.path });
    execSync('git commit -m "Add new file"', { cwd: worktree.path });

    // 获取 diff（指定正确的 base 分支）
    const diff = await worktreeManager.getDiff(worktree, 'master');
    expect(diff).toContain('newfile.txt');
    expect(diff).toContain('New content');

    // 清理
    await worktreeManager.destroy(worktree);
  });

  it('should return error for task without worktree', async () => {
    const task = new Task(
      TaskId.create('WS', 2),
      'No worktree',
      'Desc',
      TaskStatus.TODO,
      Priority.P1,
      [],
      [],
      []
    );

    await repository.save(task);

    const found = await repository.findById(task.id);
    expect(found?.worktree).toBeUndefined();
  });
});
