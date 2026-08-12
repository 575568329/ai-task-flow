// backend/src/domain/mindmap/entities/MindmapDoc.ts
import { MINDMAP_LIMITS } from '@ai-task-flow/shared';
import type {
  MindmapDocDTO,
  MindmapFlowEdge,
  MindmapFlowNode,
  MindmapUpdateDTO,
  MindmapViewport,
} from '@ai-task-flow/shared';

const DEFAULT_TITLE = '未命名思维导图';
const ROOT_NODE_LABEL = '中心主题';

/**
 * 思维导图聚合根。
 *
 * 守「与渲染框架无关的存储不变量」：node.id 非空唯一、edge 引用完整、标题非空、节点数上限。
 * 不校验布局/坐标/handle 合法性（那是前端 React Flow 的职责）——后端只对持久化数据完整性兜底。
 *
 * 图结构以 React Flow 原生 nodes/edges 结构存储（经 shared 的结构同构 interface 传递），
 * 聚合根对其按整体 blob 校验引用完整性，不关心单个节点的渲染态字段。
 */
export class MindmapDoc {
  constructor(
    public readonly id: string,
    public title: string,
    public version: number,
    public nodeCount: number,
    public nodes: MindmapFlowNode[],
    public edges: MindmapFlowEdge[],
    public viewport: MindmapViewport | null,
    public readonly createdAt: Date,
    public updatedAt: Date,
  ) {}

  /** 工厂：新建一张图，含一个默认根节点（level 0）。 */
  static create(title?: string): MindmapDoc {
    const now = new Date();
    const resolvedTitle = MindmapDoc.normalizeTitle(title);
    const root: MindmapFlowNode = {
      id: crypto.randomUUID(),
      type: 'mindmap',
      position: { x: 0, y: 0 },
      data: {
        label: resolvedTitle === DEFAULT_TITLE ? ROOT_NODE_LABEL : resolvedTitle,
        level: 0,
        expanded: true,
      },
    };
    return new MindmapDoc(
      crypto.randomUUID(),
      resolvedTitle,
      0, // version
      1, // nodeCount
      [root],
      [],
      null, // viewport（首次创建未保存视口）
      now,
      now,
    );
  }

  /** 标题规范化：trim + 空则默认 + 超长截断。 */
  private static normalizeTitle(raw?: string): string {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) return DEFAULT_TITLE;
    return trimmed.length > MINDMAP_LIMITS.MAX_TITLE_LENGTH
      ? trimmed.slice(0, MINDMAP_LIMITS.MAX_TITLE_LENGTH)
      : trimmed;
  }

  /** 重命名（规范化 + 校验内聚）。 */
  rename(title: string): void {
    this.title = MindmapDoc.normalizeTitle(title);
    this.updatedAt = new Date();
  }

  /**
   * 应用部分更新（对应 PATCH）。守不变量后 version++。
   * nodes/edges 任一提供即触发整图校验；viewport 提供即覆盖。
   */
  applyUpdate(dto: MindmapUpdateDTO): void {
    if (dto.title !== undefined) this.rename(dto.title);
    if (dto.nodes !== undefined || dto.edges !== undefined) {
      // 整图替换：任一缺省则沿用当前值，保证校验时 nodes/edges 引用一致
      this.updateGraph(dto.nodes ?? this.nodes, dto.edges ?? this.edges);
    }
    if (dto.viewport !== undefined) this.viewport = dto.viewport;
    this.version += 1;
    this.updatedAt = new Date();
  }

  /**
   * 整图替换 + 存储不变量校验。抛 Error 表示校验失败（由 Service 转 ValidationError）。
   * 校验项：node.id 非空且唯一 / edge.source-target 引用必须存在 / nodes 数量上限。
   * 注意：不校验 position/measured 等渲染态字段（前端职责）。
   */
  private updateGraph(nodes: MindmapFlowNode[], edges: MindmapFlowEdge[]): void {
    if (nodes.length > MINDMAP_LIMITS.MAX_NODES_PER_DOC) {
      throw new Error(`节点数超过上限 ${MINDMAP_LIMITS.MAX_NODES_PER_DOC}`);
    }
    const ids = new Set<string>();
    for (const n of nodes) {
      if (!n.id) throw new Error('存在 id 为空的节点');
      if (ids.has(n.id)) throw new Error(`节点 id 重复：${n.id}`);
      ids.add(n.id);
    }
    for (const e of edges) {
      if (!ids.has(e.source)) throw new Error(`边 ${e.id} 的 source 引用了不存在的节点：${e.source}`);
      if (!ids.has(e.target)) throw new Error(`边 ${e.id} 的 target 引用了不存在的节点：${e.target}`);
    }
    this.nodes = nodes;
    this.edges = edges;
    this.nodeCount = nodes.length;
  }

  toJSON(): MindmapDocDTO {
    return {
      id: this.id,
      title: this.title,
      version: this.version,
      nodeCount: this.nodeCount,
      nodes: this.nodes,
      edges: this.edges,
      viewport: this.viewport ?? undefined,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }

  static fromJSON(dto: MindmapDocDTO): MindmapDoc {
    return new MindmapDoc(
      dto.id,
      dto.title,
      dto.version,
      dto.nodeCount,
      dto.nodes,
      dto.edges,
      dto.viewport ?? null,
      new Date(dto.createdAt),
      new Date(dto.updatedAt),
    );
  }
}
