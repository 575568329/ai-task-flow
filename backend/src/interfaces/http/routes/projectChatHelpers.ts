// backend/src/interfaces/http/routes/projectChatHelpers.ts
// 项目对话聚合的纯函数:从任务列表归纳「已知项目」(仓库根),供
//   - GET /api/project-chat/projects 聚合 tab
//   - POST /api/project-chat 白名单校验(cwd 必须是已登记项目)
// 共用。抽到独立模块是为无副作用可单测(回归核心:项目数量翻倍就出在 key 归一化/取错路径)。
import type { TaskDTO } from '@ai-task-flow/shared';

/** collectKnownRepos 实际只读这三个字段;独立成窄类型便于测试构造,TaskDTO 结构兼容可直传 */
export interface RepoSource {
  repoPath?: string;
  projectName?: string;
  worktree?: { path: string } | null;
}

export interface KnownRepo {
  /** 仓库根(原始写法,用于 scan 与展示) */
  repoPath: string;
  projectName: string;
}

/** 从仓库路径推断项目名(取末段目录名;Windows/Unix 分隔符皆可) */
function projectNameOf(repoPath: string): string {
  const seg = repoPath.split(/[\\/]/).filter(Boolean).pop();
  return seg || repoPath;
}

/**
 * 归一化仓库路径为分组 key:统一正斜杠 + 去尾斜杠 + 小写(Windows 盘符大小写不敏感)。
 * 避免 D:\foo / D:/foo / d:\foo 被当成不同项目。key 仅用于分组去重与白名单匹配,
 * 展示与扫描仍用原始 repoPath。
 */
export function normalizeRepoKey(repoPath: string): string {
  return repoPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * 从 worktree 路径反推项目根:worktree 通常位于 <repoRoot>/.ai-workspaces/<taskId>,
 * 取 .ai-workspaces 之前的部分。返回 undefined 表示无法反推(调用方跳过该任务)。
 *
 * 为什么需要它:任务的 repoPath 字段可能为空(只派发过、未填仓库路径),若直接拿
 * worktree.path 当项目 key,会(1)每个任务拆成独立项目;(2)scan 扫不到项目根的会话。
 */
export function repoRootFromWorktree(worktreePath: string): string | undefined {
  const idx = worktreePath.toLowerCase().indexOf('.ai-workspaces');
  // idx<=0:.ai-workspaces 不存在,或在路径最前(没有上级根可取)
  if (idx <= 0) return undefined;
  return worktreePath.slice(0, idx).replace(/[\\/]+$/, '');
}

/**
 * 从任务列表归纳「已知项目」(按仓库根去重)。
 * 规则:repoPath 优先;repoPath 缺失则从 worktree.path 反推根;都没有则跳过。
 * 同一物理项目的多种路径写法(盘符大小写/正反斜杠/尾斜杠)经 normalizeRepoKey 合并。
 */
export function collectKnownRepos(dtos: RepoSource[]): KnownRepo[] {
  const byKey = new Map<string, KnownRepo>();
  for (const dto of dtos) {
    let repoPath = dto.repoPath;
    if (!repoPath && dto.worktree?.path) {
      const root = repoRootFromWorktree(dto.worktree.path);
      repoPath = root;
    }
    if (!repoPath) continue;
    const key = normalizeRepoKey(repoPath);
    if (!byKey.has(key)) {
      byKey.set(key, { repoPath, projectName: dto.projectName || projectNameOf(repoPath) });
    }
  }
  return [...byKey.values()];
}

// 仅用于类型可达性:确保 TaskDTO 满足 RepoSource(结构兼容),路由可直接传 task.toJSON()
const _typeCheck = (dto: TaskDTO): RepoSource => dto;
void _typeCheck;
