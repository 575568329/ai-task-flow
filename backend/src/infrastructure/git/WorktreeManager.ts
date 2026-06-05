// backend/src/infrastructure/git/WorktreeManager.ts
import simpleGit, { SimpleGit } from 'simple-git';
import { WorktreeRef } from '../../domain/workflow/value-objects/WorktreeRef.js';
import fs from 'fs/promises';
import path from 'path';

export class WorktreeManager {
  async create(projectPath: string, taskId: string, baseBranch?: string): Promise<WorktreeRef> {
    const git: SimpleGit = simpleGit(projectPath);

    // 获取当前分支名（如果未指定）
    if (!baseBranch) {
      const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
      baseBranch = currentBranch.trim();
    }

    // 获取当前 HEAD commit
    const baseCommit = await git.revparse(['HEAD']);

    // 创建 worktree 引用
    const ref = WorktreeRef.create(projectPath, taskId, baseCommit.trim());

    // 确保 .ai-workspaces 目录存在
    const workspacesDir = path.join(projectPath, '.ai-workspaces');
    await fs.mkdir(workspacesDir, { recursive: true });

    // 创建 worktree（会自动创建新分支）
    await git.raw(['worktree', 'add', '-b', ref.branch, ref.path, baseBranch]);

    // 写入 meta.json
    const meta = {
      taskId,
      createdAt: ref.createdAt.toISOString(),
      baseCommit: ref.baseCommit,
      projectPath,
    };
    await fs.writeFile(
      path.join(ref.path, '.ai-meta.json'),
      JSON.stringify(meta, null, 2)
    );

    return ref;
  }

  async destroy(ref: WorktreeRef): Promise<void> {
    const git: SimpleGit = simpleGit(path.dirname(ref.path));

    // 删除 worktree
    await git.raw(['worktree', 'remove', ref.path, '--force']);

    // 删除分支
    await git.deleteLocalBranch(ref.branch, true);
  }

  async getDiff(ref: WorktreeRef, baseBranch: string = 'main'): Promise<string> {
    const git: SimpleGit = simpleGit(ref.path);
    const diff = await git.diff([`${baseBranch}...${ref.branch}`]);
    return diff;
  }

  async listAll(projectPath: string): Promise<WorktreeRef[]> {
    const git: SimpleGit = simpleGit(projectPath);
    const result = await git.raw(['worktree', 'list', '--porcelain']);

    // 解析 worktree list 输出
    const worktrees: WorktreeRef[] = [];
    const lines = result.split('\n');
    let currentPath = '';
    let currentBranch = '';

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        currentPath = line.substring(9);
      } else if (line.startsWith('branch ')) {
        currentBranch = line.substring(7);
        if (currentBranch.startsWith('refs/heads/ai-task/')) {
          // 读取 meta.json 获取完整信息
          try {
            const metaPath = path.join(currentPath, '.ai-meta.json');
            const metaContent = await fs.readFile(metaPath, 'utf-8');
            const meta = JSON.parse(metaContent);
            worktrees.push(new WorktreeRef(
              currentPath,
              currentBranch.replace('refs/heads/', ''),
              meta.baseCommit,
              new Date(meta.createdAt)
            ));
          } catch {
            // meta.json 不存在，跳过
          }
        }
      }
    }

    return worktrees;
  }
}
