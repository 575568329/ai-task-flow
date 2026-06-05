// backend/src/infrastructure/git/__tests__/WorktreeManager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorktreeManager } from '../WorktreeManager.js';
import simpleGit from 'simple-git';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('WorktreeManager', () => {
  let testRepoPath: string;
  let manager: WorktreeManager;

  beforeEach(async () => {
    // 创建临时测试仓库
    testRepoPath = path.join(os.tmpdir(), `test-repo-${Date.now()}`);
    await fs.mkdir(testRepoPath, { recursive: true });

    const git = simpleGit(testRepoPath);
    await git.init();
    await git.addConfig('user.name', 'Test');
    await git.addConfig('user.email', 'test@test.com');

    // 创建初始 commit
    await fs.writeFile(path.join(testRepoPath, 'README.md'), '# Test');
    await git.add('.');
    await git.commit('Initial commit');

    manager = new WorktreeManager();
  });

  afterEach(async () => {
    // 清理测试仓库
    await fs.rm(testRepoPath, { recursive: true, force: true });
  });

  it('should create worktree with correct structure', async () => {
    const ref = await manager.create(testRepoPath, 'test-001');

    expect(ref.path).toContain('.ai-workspaces/test-001');
    expect(ref.branch).toBe('ai-task/test-001');

    // 验证 worktree 目录存在
    const stat = await fs.stat(ref.path);
    expect(stat.isDirectory()).toBe(true);

    // 验证 meta.json 存在
    const metaPath = path.join(ref.path, '.ai-meta.json');
    const metaContent = await fs.readFile(metaPath, 'utf-8');
    const meta = JSON.parse(metaContent);
    expect(meta.taskId).toBe('test-001');
  });

  it('should destroy worktree cleanly', async () => {
    const ref = await manager.create(testRepoPath, 'test-002');
    await manager.destroy(ref);

    // 验证 worktree 目录已删除
    await expect(fs.stat(ref.path)).rejects.toThrow();
  });

  it('should get git diff between worktree and main', async () => {
    const ref = await manager.create(testRepoPath, 'test-003');

    // 在 worktree 里修改文件
    await fs.writeFile(path.join(ref.path, 'test.txt'), 'changed');
    const git = simpleGit(ref.path);
    await git.add('.');
    await git.commit('Test change');

    // 获取基础分支名
    const mainGit = simpleGit(testRepoPath);
    const baseBranch = (await mainGit.revparse(['--abbrev-ref', 'HEAD'])).trim();

    const diff = await manager.getDiff(ref, baseBranch);
    expect(diff).toContain('test.txt');
    expect(diff).toContain('changed');
  });
});
