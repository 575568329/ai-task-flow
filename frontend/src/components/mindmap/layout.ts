// frontend/src/components/mindmap/layout.ts
// 树形布局已抽到 shared（前端编辑器与后端 MCP 共用同一算法，避免两套实现行为不一致）。
// 此处重导出保持既有 import 路径兼容；算法说明见 shared/src/utils/treeLayout.ts。
export { getLayoutedElements } from '@ai-task-flow/shared';
export type { LayoutNode, LayoutEdge } from '@ai-task-flow/shared';
