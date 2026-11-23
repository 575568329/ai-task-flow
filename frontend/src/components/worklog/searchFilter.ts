// frontend/src/components/worklog/searchFilter.ts
// 工作记录条目过滤纯函数:树选择 + 关键字模糊匹配(与后端 query_work 语义一致——
// title/detail/files.path 不区分大小写;keyword 非空时忽略树选择做全局搜索)。
import type { WorklogData, WorklogEntry } from '@ai-task-flow/shared';
import { matchStageFilter, type StageFilter } from '@/lib/workStage';
import type { TreeSelection } from './ProjectVersionTree';

export interface VisibleEntry {
  entry: WorklogEntry;
  project: string;
  version: string;
}

/** keyword 命中:title/detail/files.path 任一含关键字(不区分大小写) */
export function matchesKeyword(entry: WorklogEntry, keyword: string): boolean {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return true;
  const inTitle = entry.title.toLowerCase().includes(kw);
  const inDetail = entry.detail.toLowerCase().includes(kw);
  const inFiles = entry.files?.some((f) => f.path.toLowerCase().includes(kw)) ?? false;
  return inTitle || inDetail || inFiles;
}

/**
 * 计算右栏可见条目(新在前)。
 * - keyword 非空:全局搜索(忽略 selection),命中即显示——方便"想看的需求是怎么做的"直接定位;
 * - relatedProject 非空:只保留关联了该项目的条目;单独使用时视为全局视图(树节点「另有 N 条关联记录」入口);
 * - 否则:按树选择过滤(项目精确/版本精确);未选不加载全部(数据量大,避免默认渲染 60+ 条)。
 */
export function filterEntries(
  data: WorklogData,
  selection: TreeSelection,
  keyword: string,
  stage: StageFilter = [],
  relatedProject?: string,
): { entries: VisibleEntry[]; isSearching: boolean } {
  const isSearching = keyword.trim().length > 0;
  const related = relatedProject?.trim() || undefined;
  if (!isSearching && !selection.project && !related) return { entries: [], isSearching };
  const result: VisibleEntry[] = [];

  for (const project of data.projects) {
    if (!isSearching && selection.project && project.name !== selection.project) continue;
    for (const version of project.versions) {
      if (!isSearching && selection.version && version.name !== selection.version) continue;
      for (const entry of version.entries) {
        if (!matchStageFilter(entry.stage, stage)) continue;
        // 关联项目按名称快照匹配(与后端 query_work 的 relatedProject 口径一致)
        if (related && !entry.relatedProjects?.includes(related)) continue;
        if (isSearching && !matchesKeyword(entry, keyword)) continue;
        result.push({ entry, project: project.name, version: version.name });
      }
    }
  }

  entriesSortNewestFirst(result);
  return { entries: result, isSearching };
}

function entriesSortNewestFirst(entries: VisibleEntry[]): void {
  entries.sort((a, b) => b.entry.createdAt - a.entry.createdAt);
}
