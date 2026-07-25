// backend/src/interfaces/http/routes/__tests__/projectChatHelpers.test.ts
// projectChatHelpers 纯函数单测:锁住「项目聚合去重」行为。
// 本次 code review 指出:回归根因(项目翻倍)正是 key 归一化/取错路径,缺测试保护,
// 重构易回退。这里覆盖 normalizeRepoKey / repoRootFromWorktree / collectKnownRepos。
import { describe, expect, it } from 'vitest';
import {
  collectKnownRepos,
  normalizeRepoKey,
  repoRootFromWorktree,
  type RepoSource,
} from '../projectChatHelpers.js';

describe('normalizeRepoKey', () => {
  it('反斜杠统一为正斜杠并小写', () => {
    expect(normalizeRepoKey('D:\\Study\\ai-task-flow')).toBe('d:/study/ai-task-flow');
  });

  it('去掉尾部斜杠(单个与多个)', () => {
    expect(normalizeRepoKey('D:/foo/')).toBe('d:/foo');
    expect(normalizeRepoKey('D:/foo//')).toBe('d:/foo');
  });

  it('同盘不同写法归一为同一 key(回归核心:项目不再翻倍)', () => {
    const keys = [
      normalizeRepoKey('D:\\Study\\ai-task-flow'),
      normalizeRepoKey('D:/Study/ai-task-flow/'),
      normalizeRepoKey('d:\\study\\ai-task-flow'),
    ];
    expect(new Set(keys).size).toBe(1);
  });
});

describe('repoRootFromWorktree', () => {
  it('从 .ai-workspaces 子目录反推项目根(正斜杠)', () => {
    expect(repoRootFromWorktree('D:/Study/proj/.ai-workspaces/TASK-001')).toBe('D:/Study/proj');
  });

  it('反斜杠 worktree 反推并去尾分隔符', () => {
    expect(repoRootFromWorktree('D:\\Study\\proj\\.ai-workspaces\\TASK-001')).toBe('D:\\Study\\proj');
  });

  it('无 .ai-workspaces 段返回 undefined', () => {
    expect(repoRootFromWorktree('D:/Study/proj')).toBeUndefined();
  });

  it('.ai-workspaces 在最前(idx<=0)返回 undefined', () => {
    expect(repoRootFromWorktree('.ai-workspaces/x')).toBeUndefined();
  });
});

describe('collectKnownRepos', () => {
  it('同盘不同写法的多个任务合并为单个项目', () => {
    const dtos: RepoSource[] = [
      { repoPath: 'D:/Study/proj' },
      { repoPath: 'D:\\Study\\proj\\' },
    ];
    expect(collectKnownRepos(dtos)).toHaveLength(1);
  });

  it('worktree-only 任务反推根,与 repoPath 任务合并(回归:不再因 worktree.path 拆项目)', () => {
    const dtos: RepoSource[] = [
      { repoPath: 'D:/Study/proj' },
      { repoPath: undefined, worktree: { path: 'D:/Study/proj/.ai-workspaces/T2' } },
    ];
    const repos = collectKnownRepos(dtos);
    expect(repos).toHaveLength(1);
    expect(normalizeRepoKey(repos[0].repoPath)).toBe(normalizeRepoKey('D:/Study/proj'));
  });

  it('无 repoPath 且无可反推 worktree 的任务被跳过', () => {
    const dtos: RepoSource[] = [
      { repoPath: undefined, worktree: undefined },
      { repoPath: undefined, worktree: { path: 'D:/no-workspaces-marker/T3' } },
    ];
    expect(collectKnownRepos(dtos)).toHaveLength(0);
  });

  it('projectName 缺省时取 repoPath 末段', () => {
    const dtos: RepoSource[] = [{ repoPath: 'D:/Study/my-proj', projectName: '' }];
    expect(collectKnownRepos(dtos)[0].projectName).toBe('my-proj');
  });

  it('保留用户填写的 projectName', () => {
    const dtos: RepoSource[] = [{ repoPath: 'D:/p', projectName: '自定义名' }];
    expect(collectKnownRepos(dtos)[0].projectName).toBe('自定义名');
  });
});
