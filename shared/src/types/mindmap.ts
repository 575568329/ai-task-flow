// shared/src/types/mindmap.ts
// 思维导图模块前后端共享类型（前端 / 后端 / 扩展三方共用）
//
// 【关键约束】本文件零第三方依赖，**不 import @xyflow/react**。
// nodes/edges 用「结构同构 interface」描述，前端 React Flow 的 Node<MindmapNodeData>
// 靠 TS 结构类型天然兼容（RF 的 Node 字段是这里的结构子集），从而 shared 不被前端画布库污染，
// backend/cli/extension 的类型编译链也不被拖入 React 生态。

/** 分支配色键（8 色，前端按一级分支取色，超出按 index % 8 循环） */
export type BranchKey =
  | 'blue'
  | 'teal'
  | 'emerald'
  | 'amber'
  | 'orange'
  | 'rose'
  | 'violet'
  | 'indigo';

/** 画布视口（缩放/平移），随文档持久化以恢复上次位置 */
export interface MindmapViewport {
  x: number;
  y: number;
  zoom: number;
}

/** 文档形态：树形思维导图 / 自由画布。创建时确定并持久化（消除模式漂移）。 */
export type MindmapDocMode = 'tree' | 'canvas';

/**
 * 节点业务数据（存于 React Flow node.data，随 toObject() 序列化）。
 * index signature 满足 React Flow 的 Node<T> 约束（T extends Record<string, unknown>），
 * 后端当不透明 blob 存取不受影响。
 *
 * 节点种类由 node.type 判别（'mindmap'=text / 'image' / 'link' / 'group'），
 * 不用 data.kind 双轨判别（KISS，node.type 是 RF 渲染分流主键）。
 */
export interface MindmapNodeData {
  label: string; // 节点文本（text）/ 链接标题（link）/ 组名（group）
  note?: string; // 节点备注（纯文本，hover/点击展开）
  expanded?: boolean; // 是否展开子节点（默认 true，树形模式用）
  branch?: BranchKey; // 所属分支色（决定节点/连线配色，树形模式用；自由画布用 style.fill）
  level?: number; // 层级深度，0=根（用于字号/字重/线宽递减，树形模式用）
  imageUrl?: string; // image 节点：/api/uploads/xxx.png（相对路径）
  images?: string[]; // 文字节点内嵌图片（编辑态粘贴追加，label 下方缩略图展示）
  href?: string; // link 节点：外链 URL
  width?: number; // 可调尺寸节点（image/link/group）的自然宽
  height?: number; // 可调尺寸节点的自然高
  style?: CanvasNodeStyle; // 样式（语义 key，见 CanvasNodeStyle）
  [key: string]: unknown;
}

/** 节点标记色——shadcn 语义 key（强调）或 chart 分类 key（中性分类），非 hex */
export type CanvasFill =
  | 'default' // 缺省：纯 card 原样
  | 'primary' // 重点
  | 'secondary' // 次要
  | 'destructive' // 警示
  | 'muted' // 弱化
  | 'chart-1'
  | 'chart-2'
  | 'chart-3'
  | 'chart-4'
  | 'chart-5'; // 中性分类色（技术/产品/运营等无语义负担的分类）

/** 节点样式（语义 key，渲染时映射为 shadcn token tint，主题自动跟随） */
export interface CanvasNodeStyle {
  fill?: CanvasFill;
  borderStyle?: 'solid' | 'dashed';
  borderWidth?: 'thin' | 'thick';
  rounded?: boolean;
  fontSize?: 'sm' | 'md' | 'lg';
}

/**
 * 结构同构于 @xyflow/react 的 Node<MindmapNodeData>。
 * 仅声明思维导图用到的字段；index signature 允许前端 toObject() 透传的渲染态字段
 *（measured / handleBounds 等），后端当不透明 blob 存取、不解析。
 */
export interface MindmapFlowNode {
  id: string;
  type?: string | null;
  position: { x: number; y: number };
  data: MindmapNodeData;
  width?: number;
  height?: number;
  selected?: boolean;
  hidden?: boolean;
  dragging?: boolean;
  [key: string]: unknown;
}

/** 结构同构于 @xyflow/react 的 Edge */
export interface MindmapFlowEdge {
  id: string;
  source: string;
  target: string;
  type?: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  data?: { branch?: BranchKey; label?: string }; // label：连线标签（可选）
  animated?: boolean;
  hidden?: boolean;
  [key: string]: unknown;
}

/** 一张完整的思维导图/画布文档 */
export interface MindmapDocDTO {
  id: string;
  title: string;
  docMode?: MindmapDocMode; // 文档形态（旧文档缺省由前端启发式推断）
  version: number; // 乐观锁版本号，每次 PATCH 自增
  nodeCount: number; // 冗余字段，列表接口直接读取、不解析 nodes
  nodes: MindmapFlowNode[];
  edges: MindmapFlowEdge[];
  viewport?: MindmapViewport;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

/** 列表页用的精简版（不含 nodes/edges 大字段） */
export interface MindmapMetaDTO {
  id: string;
  title: string;
  docMode?: MindmapDocMode;
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 新建文档入参（title 可选，缺省走默认标题） */
export interface MindmapCreateDTO {
  title?: string;
  docMode?: MindmapDocMode; // 缺省 'tree'（API 兼容）；前端新建画布时显式传 'canvas'
}

/**
 * 更新文档入参（对应 PATCH，部分更新）。
 * nodes/edges 任一提供即触发整图校验（聚合根守 id 唯一 + edge 引用完整）。
 * expectedVersion 用于乐观锁：提供时必须与当前 version 一致，否则 409。
 */
export interface MindmapUpdateDTO {
  title?: string;
  docMode?: MindmapDocMode; // 模式切换（右键菜单切换，随下次保存提交）
  nodes?: MindmapFlowNode[];
  edges?: MindmapFlowEdge[];
  viewport?: MindmapViewport;
  expectedVersion?: number;
}

/** 列表响应 */
export interface MindmapListResponse {
  items: MindmapMetaDTO[];
  total: number;
}

/** 上限常量（提取魔法值，前后端共享校验基准） */
export const MINDMAP_LIMITS = {
  MAX_TITLE_LENGTH: 100,
  MAX_NODES_PER_DOC: 2000, // 超 React Flow 放心区（<200），防御性上限
  MAX_DOCS: 500,
  MAX_DOC_BYTES: 2 * 1024 * 1024,
} as const;
