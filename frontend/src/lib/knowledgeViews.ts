// frontend/src/lib/knowledgeViews.ts
// 知识库多视图纯函数:视图枚举、worklog id→名称索引、按视图分组、关联统计。
// 不依赖 React/store,便于单测;未关联文档统一收口到「未关联」分组。
import {
  WORK_STAGE_LABELS,
  isWorkStage,
  type KnowledgeFileNode,
  type WorklogData,
} from '@ai-task-flow/shared';

/** 四种视图:分类(目录树)/版本/项目/阶段 */
export type KnowledgeViewMode = 'category' | 'version' | 'project' | 'stage';

export const KNOWLEDGE_VIEWS: ReadonlyArray<{ id: KnowledgeViewMode; label: string }> = [
  { id: 'category', label: '分类' },
  { id: 'version', label: '版本' },
  { id: 'project', label: '项目' },
  { id: 'stage', label: '阶段' },
];

/** 未关联任何关联字段的文档分组名 */
export const UNLINKED_GROUP_NAME = '未关联';

/** 分组(version/project/stage 视图下均为单层:分组 → 文档) */
export interface DocGroup {
  key: string;
  name: string;
  docs: KnowledgeFileNode[];
}

/** worklog 树的 id → 名称映射 + 下拉选项(前端只读,失败时保持空索引) */
export interface WorklogIndex {
  versionNames: Map<string, string>;
  projectNames: Map<string, string>;
  versions: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
}

export function emptyWorklogIndex(): WorklogIndex {
  return {
    versionNames: new Map(),
    projectNames: new Map(),
    versions: [],
    projects: [],
  };
}

/** 由 worklog 全树构建索引(项目字典 + 版本);需求层已移除 */
export function buildWorklogIndex(tree: WorklogData): WorklogIndex {
  const index = emptyWorklogIndex();

  for (const version of tree.versions) {
    index.versionNames.set(version.id, version.name);
    index.versions.push({ id: version.id, name: version.name });
  }

  for (const project of tree.projects) {
    index.projectNames.set(project.id, project.name);
    index.projects.push({ id: project.id, name: project.name });
  }

  return index;
}

/** 文档是否带任一关联字段(用于「已关联」统计与徽标);旧 requirementId 不再计入 */
export function hasAssociation(doc: KnowledgeFileNode): boolean {
  return Boolean(
    doc.frontmatter?.versionId ||
      doc.frontmatter?.projectId ||
      doc.frontmatter?.stage,
  );
}

/** 视图对应的关联字段;category 无单一字段,返回 null */
function associationFieldOf(
  view: KnowledgeViewMode,
): ((doc: KnowledgeFileNode) => string | undefined) | null {
  switch (view) {
    case 'version':
      return (doc) => doc.frontmatter?.versionId;
    case 'project':
      return (doc) => doc.frontmatter?.projectId;
    case 'stage':
      return (doc) => doc.frontmatter?.stage;
    default:
      return null;
  }
}

/** 阶段展示名:已知阶段用中文标签,历史/未知值原样展示 */
export function stageLabel(stage: string): string {
  return isWorkStage(stage) ? WORK_STAGE_LABELS[stage] : stage;
}

/**
 * 按视图把文档分组:
 * - category:单组「全部文档」(实际页面仍用目录树渲染);
 * - version:版本名 → 文档,未关联版本归「未关联」;
 * - project:项目名 → 文档;
 * - stage:阶段中文名 → 文档。
 * 分组顺序按文档首次出现顺序,「未关联」放最后;映射不到的 id 用 id 本身兜底。
 */
export function groupDocsByView(
  docs: KnowledgeFileNode[],
  view: KnowledgeViewMode,
  index: WorklogIndex = emptyWorklogIndex(),
): DocGroup[] {
  if (view === 'category') {
    return [{ key: 'all', name: '全部文档', docs: [...docs] }];
  }

  const getter = associationFieldOf(view)!;
  const nameOf = (id: string): string => {
    if (view === 'version') return index.versionNames.get(id) ?? id;
    if (view === 'project') return index.projectNames.get(id) ?? id;
    return stageLabel(id);
  };
  return groupByScalar(docs, getter, nameOf);
}

function groupByScalar(
  docs: KnowledgeFileNode[],
  getter: (doc: KnowledgeFileNode) => string | undefined,
  nameOf: (id: string) => string,
): DocGroup[] {
  const linked = new Map<string, DocGroup>();
  const unlinked: KnowledgeFileNode[] = [];

  for (const doc of docs) {
    const id = getter(doc)?.trim();
    if (!id) {
      unlinked.push(doc);
      continue;
    }
    let group = linked.get(id);
    if (!group) {
      group = { key: id, name: nameOf(id), docs: [] };
      linked.set(id, group);
    }
    group.docs.push(doc);
  }

  const groups = Array.from(linked.values());
  if (unlinked.length > 0) {
    groups.push({ key: '__unlinked__', name: UNLINKED_GROUP_NAME, docs: unlinked });
  }
  return groups;
}

/**
 * 某视图下「已关联 N / 未关联 M」统计。
 * 只按该视图对应字段判定(category 按任一关联字段)。
 */
export function countDocsByLinkState(
  docs: KnowledgeFileNode[],
  view: KnowledgeViewMode,
): { linked: number; unlinked: number } {
  const getter = associationFieldOf(view);
  const isLinked = getter ? (doc: KnowledgeFileNode) => Boolean(getter(doc)?.trim()) : hasAssociation;

  let linked = 0;
  for (const doc of docs) {
    if (isLinked(doc)) linked += 1;
  }
  return { linked, unlinked: docs.length - linked };
}
