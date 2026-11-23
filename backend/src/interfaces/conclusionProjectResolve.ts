// 结论卡项目解析:接口层(MCP/HTTP)在写入前查 worklog 项目引用,把名称解析为稳定 id。
// 结论卡锚点是会话,路径不参与归属;这里只做「名称 → id」映射,不做 cwd 反查。
// 入参只要求 {id,name} 列表(WorklogService.getProjectRefs()),不触发路径探测。

/** 解析所需的最小项目引用(WorklogService.getProjectRefs() 的返回形状) */
export interface ConclusionProjectRef {
  id: string;
  name: string;
}

export interface ResolvedConclusionProjects {
  /** 主项目 id;主项目名称未命中任何项目时为空串(表示清除旧引用) */
  projectId?: string;
  /** 关联项目名称快照(仅当调用方显式传了 relatedProjects 时出现) */
  relatedProjects?: string[];
  /** 关联项目稳定 id(与名称快照一一对应) */
  relatedProjectIds?: string[];
  /** 未命中的关联项目名称(丢弃并提示,不阻塞写入) */
  ignored: string[];
  /** 主项目名称有传但 worklog 中没有该项目 */
  projectMissing: boolean;
}

export interface ConclusionProjectInput {
  project?: string;
  relatedProjects?: string[];
}

/**
 * 解析主项目与关联项目。
 * - 主项目未命中:不报错,projectId 留空,保留名称快照(结论卡常早于工程记录出现)。
 * - 关联项目未命中:丢弃并收集到 ignored,由调用方在返回文案/响应中提示。
 */
export function resolveConclusionProjects(
  projects: readonly ConclusionProjectRef[],
  input: ConclusionProjectInput,
): ResolvedConclusionProjects {
  const projectName = input.project?.trim();
  const owner = projectName ? projects.find((p) => p.name === projectName) : undefined;

  const ids: string[] = [];
  const labels: string[] = [];
  const ignored: string[] = [];
  for (const raw of input.relatedProjects ?? []) {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name) continue;
    const found = projects.find((p) => p.name === name);
    if (!found) {
      if (!ignored.includes(name)) ignored.push(name);
      continue;
    }
    // 同名重复只保留一次(按 id 去重,避免 id/name 两数组错位)
    if (!ids.includes(found.id)) {
      ids.push(found.id);
      labels.push(found.name);
    }
  }

  return {
    // project 显式传入才输出:append 省略 project 时不能误清既有 projectId
    ...(input.project !== undefined ? { projectId: owner?.id ?? '' } : {}),
    ...(input.relatedProjects !== undefined
      ? { relatedProjects: labels, relatedProjectIds: ids }
      : {}),
    ignored,
    projectMissing: projectName !== undefined && projectName !== '' && !owner,
  };
}
