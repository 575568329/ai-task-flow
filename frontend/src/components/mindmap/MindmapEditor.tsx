// frontend/src/components/mindmap/MindmapEditor.tsx
// 受控 React Flow 画布 + dirty 桥 + 自动保存（debounce 2s）+ 乐观锁。
//
// 【架构】nodes/edges 用本地 useState（高频编辑态不进项目 store，避免拖动每像素触发全局
// re-render）。store 只管文档级（current/version/isDirty/saveStatus），通过回调双向同步。
// nodeTypes/edgeTypes 定义在组件外（性能红线：否则每次渲染新引用 → 全部节点重渲染）。
//
// 【自由画布】（P0a）：
// - 浮边（BranchEdge + FloatingConnectionLine）：任意方向连线，忽略 handle 位置
// - ConnectionMode.Loose：任意 handle 互连；onConnect 拦截自环/重复边
// - 双击空白建节点（autoEditQueue 自动进入编辑，失焦空内容则删除）
// - 对齐辅助线（useAlignmentSnap，8px/zoom 阈值，本地 state 不进 store）
// - 操作按文档形态分流：isTreeDocument → 树形语义（Tab/Enter/删子树），否则画布语义（删选中）
//
// 【keep-alive】键盘绑画布容器（tabIndex），不绑 window，切到其他视图不误触。
// 导出 PNG 前需确保画布可见（hidden 下 bounds 脏）。
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ConnectionMode,
  useReactFlow,
  getNodesBounds,
  getViewportForBounds,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type OnMove,
  type Edge,
} from '@xyflow/react';
import type { MindmapFlowEdge, MindmapFlowNode, MindmapViewport } from '@ai-task-flow/shared';
import { mindmapApi } from '@/api/mindmap';
import { toPng } from 'html-to-image';
import { useMindmapStore } from '@/stores/mindmapStore';
import { MindmapNode, type MindmapRFNode } from './MindmapNode';
import { BranchEdge, type MindmapRFEdge } from './BranchEdge';
import { FloatingConnectionLine } from './FloatingConnectionLine';
import { MindmapEditorContext, type MindmapEditorContextValue } from './mindmapContext';
import { getLayoutedElements } from './layout';
import { useMindmapActions } from './useMindmapActions';
import { useCanvasActions, isTreeDocument } from './useCanvasActions';
import { useAlignmentSnap } from './useAlignmentSnap';
import { HelperLines } from './HelperLines';
import { useUndoRedo } from './useUndoRedo';
import { OutlinePanel } from './OutlinePanel';
import { ContextMenuHost } from '@/components/context-menu/ContextMenuHost';
import { buildCanvasItems, type MindmapCanvasCtx } from './canvasContextMenu';

// 必须在组件外（否则每次渲染新引用 → RF 重注册所有类型 → 全部节点重渲染）
const nodeTypes = { mindmap: MindmapNode };
const edgeTypes = { mindmap: BranchEdge };
const defaultEdgeOptions = { type: 'mindmap' };

const AUTOSAVE_DELAY = 2000;
/** 对齐吸附阈值（屏幕像素恒定，画布单位 = 8 / zoom；Excalidraw/tldraw 同值） */
const SNAP_THRESHOLD_PX = 8;

function EditorCanvas() {
  // selector 精确订阅，避免不相关 store 变化触发 re-render
  const current = useMindmapStore((s) => s.current);
  const markDirty = useMindmapStore((s) => s.markDirty);
  const setSaveStatus = useMindmapStore((s) => s.setSaveStatus);
  const onSaved = useMindmapStore((s) => s.onSaved);

  // 受控 nodes/edges（本地 state）。父组件用 key={current.id} 强制文档切换时重新挂载，
  // 故 lazy initializer 只在挂载时从 current 读一次。
  const [nodes, setNodes] = useState<MindmapRFNode[]>(() =>
    (current?.nodes ?? []) as MindmapRFNode[],
  );
  const [edges, setEdges] = useState<MindmapRFEdge[]>(() =>
    (current?.edges ?? []) as MindmapRFEdge[],
  );
  const [viewport, setViewport] = useState<MindmapViewport>(
    () => current?.viewport ?? { x: 0, y: 0, zoom: 1 },
  );
  // 网格显示开关（右键菜单切换；对齐 snapGrid 的视觉参照）
  const [showGrid, setShowGrid] = useState(true);

  // 最新编辑态的 ref（供 debounce 保存的闭包读取，避免捕获过期 state）
  const latestRef = useRef({ nodes, edges, viewport });
  latestRef.current = { nodes, edges, viewport };

  // 文档形态：树形（单根、无多父）用树形操作语义，否则自由画布语义。
  // 每次变更重算（O(n+e) 纯坐标计算，成本可忽略）。
  const isTree = useMemo(() => isTreeDocument(nodes, edges), [nodes, edges]);

  // 撤销/重做（事务粒度快照，上限 50 步）。所有变更操作前调 takeSnapshot。
  const undoApi = useUndoRedo({
    getLatest: () => latestRef.current,
    setNodes,
    setEdges,
    markDirty,
  });
  const { takeSnapshot, undo: undoAction, redo: redoAction } = undoApi;

  // 保存：doSave 核心 + triggerSave（debounce 自动）+ saveNow（Ctrl+S 立即）
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const doSave = useCallback(async () => {
    if (!current) return;
    setSaveStatus('saving');
    try {
      const { nodes: n, edges: e, viewport: vp } = latestRef.current;
      const updated = await mindmapApi.update(current.id, {
        nodes: n as MindmapFlowNode[],
        edges: e as MindmapFlowEdge[],
        viewport: vp,
        expectedVersion: current.version, // 乐观锁基准
      });
      onSaved(updated.version);
    } catch {
      setSaveStatus('error');
      // http 拦截器已 toast（含 409 冲突提示）
    }
  }, [current, setSaveStatus, onSaved]);

  // 自动保存：debounce 2s。每次 nodes/edges 变化重设 timer，停止编辑 2s 后落库。
  const triggerSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void doSave(), AUTOSAVE_DELAY);
  }, [doSave]);

  // 立即保存：Ctrl+S 手动触发，清 debounce 直接落库。
  const saveNow = useCallback(() => {
    clearTimeout(saveTimer.current);
    void doSave();
  }, [doSave]);

  // 卸载时清 timer，避免对已卸载组件 setState
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // 对齐吸附：拦截拖动位置变更注入修正（helperLines 本地 state）
  const { getViewport, screenToFlowPosition, fitView } = useReactFlow();
  const { enhanceChanges, helperLines, clearLines } = useAlignmentSnap({
    getNodes: () => latestRef.current.nodes,
    getThreshold: () => SNAP_THRESHOLD_PX / getViewport().zoom,
  });

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const enhanced = enhanceChanges(changes);
      setNodes((nds) => applyNodeChanges(enhanced, nds) as MindmapRFNode[]);
      markDirty();
      triggerSave();
    },
    [enhanceChanges, markDirty, triggerSave],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((eds) => applyEdgeChanges(changes, eds) as MindmapRFEdge[]);
      markDirty();
      triggerSave();
    },
    [markDirty, triggerSave],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      // 自环/重复边拦截（自由画布 Loose 模式下允许任意连线，但无意义边不建）
      if (conn.source === conn.target) return;
      const dup = latestRef.current.edges.some(
        (e) =>
          (e.source === conn.source && e.target === conn.target) ||
          (e.source === conn.target && e.target === conn.source),
      );
      if (dup) return;
      takeSnapshot();
      setEdges((eds) => addEdge({ ...conn, type: 'mindmap' }, eds) as MindmapRFEdge[]);
      markDirty();
      triggerSave();
    },
    [takeSnapshot, markDirty, triggerSave],
  );

  const onMove: OnMove = useCallback((_evt, vp) => setViewport(vp), []);

  // 拖拽事务：开始时拍快照（撤销回到拖前），结束时清辅助线。
  // （修正：快照须在变更前拍——原先在 dragStop 拍的是拖后状态，该撤销步无效）
  const onNodeDragStart = useCallback(() => takeSnapshot(), [takeSnapshot]);
  const onNodeDragStop = useCallback(() => clearLines(), [clearLines]);

  // 自动布局：Toolbar 触发信号（autoLayoutTick）→ effect 执行 DFS 重排
  const autoLayoutTick = useMindmapStore((s) => s.autoLayoutTick);
  const lastLayoutTick = useRef(0);
  useEffect(() => {
    if (autoLayoutTick === lastLayoutTick.current || autoLayoutTick === 0) return;
    lastLayoutTick.current = autoLayoutTick;
    takeSnapshot();
    const { nodes: layouted } = getLayoutedElements(latestRef.current.nodes, latestRef.current.edges);
    setNodes(layouted as MindmapRFNode[]);
    markDirty();
    triggerSave();
  }, [autoLayoutTick, takeSnapshot, markDirty, triggerSave]);

  // 节点 data 更新（MindmapNode 经 Context 调用，保证 data 引用稳定不破 memo）
  const updateNodeData = useCallback((id: string, patch: Partial<MindmapRFNode['data']>) => {
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
    markDirty();
    triggerSave();
  }, [markDirty, triggerSave]);

  // 自由画布操作（双击建节点 / 删选中）
  const canvasActions = useCanvasActions({
    setNodes,
    setEdges,
    getLatest: () => latestRef.current,
    markDirty,
    triggerSave,
    takeSnapshot,
  });

  // 双击空白建节点：仅自由画布模式（树形保留双击放大）；节点双击已 stopPropagation
  const onCanvasDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (isTree) return;
      // 只响应画布空白（pane）的双击，排除节点/边/控件冒泡
      const cls = (e.target as HTMLElement)?.classList;
      if (!cls?.contains('react-flow__pane')) return;
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      canvasActions.createTextAt(pos);
    },
    [isTree, screenToFlowPosition, canvasActions],
  );

  // 连线标签编辑：双击边 → 浮层输入框 → Enter/失焦提交（data.label，空则清除）
  const [editingEdge, setEditingEdge] = useState<{ id: string; x: number; y: number; value: string } | null>(null);
  const onEdgeDoubleClick = useCallback((e: React.MouseEvent, edge: Edge) => {
    setEditingEdge({ id: edge.id, x: e.clientX, y: e.clientY, value: (edge.data as { label?: string })?.label ?? '' });
  }, []);
  const commitEdgeLabel = useCallback(() => {
    if (!editingEdge) return;
    const { id, value } = editingEdge;
    const trimmed = value.trim();
    takeSnapshot();
    setEdges((eds) =>
      eds.map((ed) =>
        ed.id === id ? { ...ed, data: { ...ed.data, label: trimmed || undefined } } : ed,
      ),
    );
    markDirty();
    triggerSave();
    setEditingEdge(null);
  }, [editingEdge, takeSnapshot, markDirty, triggerSave]);

  // 画布右键菜单上下文（自动布局 + 适应视图 + 网格开关 + 导出 PNG）
  const triggerAutoLayout = useMindmapStore((s) => s.triggerAutoLayout);

  // 导出整张图为 PNG（白底，过滤 minimap/controls，按节点 bounds 计算导出范围）
  const exportPng = useCallback(() => {
    const allNodes = latestRef.current.nodes as Node[];
    if (allNodes.length === 0) return;
    const bounds = getNodesBounds(allNodes);
    const padding = 100;
    const width = bounds.width + padding * 2;
    const height = bounds.height + padding * 2;
    const { x, y, zoom } = getViewportForBounds(bounds, width, height, 0.5, 2, padding);
    const viewportEl = document.querySelector('.react-flow__viewport');
    if (!viewportEl) return;
    toPng(viewportEl as HTMLElement, {
      backgroundColor: '#ffffff',
      width,
      height,
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${x}px, ${y}px) scale(${zoom})`,
      },
      filter: (node) => {
        const cls = (node as HTMLElement)?.classList;
        return !(cls?.contains('react-flow__minimap') || cls?.contains('react-flow__controls'));
      },
    })
      .then((dataUrl) => {
        const a = document.createElement('a');
        a.download = `${current?.title ?? 'mindmap'}.png`;
        a.href = dataUrl;
        a.click();
      })
      .catch((err) => console.error('[mindmap] 导出 PNG 失败', err));
  }, [current]);

  const canvasCtx: MindmapCanvasCtx = {
    autoLayout: triggerAutoLayout,
    fitView: () => fitView({ padding: 0.3 }),
    exportPng,
    showGrid,
    toggleGrid: () => setShowGrid((v) => !v),
  };

  // 节点操作（加子/加同级/删子树/折叠展开）
  const actions = useMindmapActions({
    setNodes,
    setEdges,
    getLatest: () => latestRef.current,
    markDirty,
    triggerSave,
  });
  const selectedNode = nodes.find((n) => n.selected);

  // 键盘：Ctrl+S/Ctrl+Z 全局；Tab/Enter/Delete 按文档形态分流（编辑态 input 内不拦截）
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Ctrl+S / Cmd+S 立即保存（无需选中节点，拦截浏览器默认保存）
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        saveNow();
        return;
      }
      // Ctrl+Z 撤销 / Ctrl+Shift+Z 或 Ctrl+Y 重做
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redoAction();
        else undoAction();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redoAction();
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return; // 文本编辑中不触发

      // Delete/Backspace：树形=删选中子树（根不可删）；自由画布=删选中节点+选中边
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (isTree) {
          if (!selectedNode) return;
          if ((selectedNode.data.level ?? 1) === 0) return; // 根节点不可删
          e.preventDefault();
          takeSnapshot();
          actions.deleteNode(selectedNode.id);
        } else {
          e.preventDefault();
          canvasActions.deleteSelection();
        }
        return;
      }

      // Tab=加子 / Enter=加同级：树形语义，自由画布不响应（建节点用双击）
      if (!isTree || !selectedNode) return;
      if (e.key === 'Tab') {
        e.preventDefault();
        takeSnapshot();
        actions.addChildNode(selectedNode.id);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        takeSnapshot();
        actions.addSiblingNode(selectedNode.id);
      }
    },
    [selectedNode, isTree, actions, canvasActions, saveNow, takeSnapshot, undoAction, redoAction],
  );

  const hasChildren = useCallback(
    (id: string) => latestRef.current.edges.some((e) => e.source === id),
    [],
  );
  const ctxValue = useMemo<MindmapEditorContextValue>(
    () => ({
      // 每个变更前 takeSnapshot，支持右键菜单操作的撤销
      updateNodeData: (id, patch) => {
        takeSnapshot();
        updateNodeData(id, patch);
      },
      addChildNode: (id) => {
        takeSnapshot();
        actions.addChildNode(id);
      },
      addSiblingNode: (id) => {
        takeSnapshot();
        actions.addSiblingNode(id);
      },
      deleteNode: (id) => {
        takeSnapshot();
        actions.deleteNode(id);
      },
      toggleExpand: (id) => {
        takeSnapshot();
        actions.toggleExpand(id);
      },
      promoteNode: (id) => {
        takeSnapshot();
        actions.promoteNode(id);
      },
      demoteNode: (id) => {
        takeSnapshot();
        actions.demoteNode(id);
      },
      moveSibling: (id, direction) => {
        takeSnapshot();
        actions.moveSibling(id, direction);
      },
      hasChildren,
    }),
    [updateNodeData, actions, hasChildren, takeSnapshot],
  );

  if (!current) return null;

  return (
    <MindmapEditorContext.Provider value={ctxValue}>
      <ContextMenuHost items={buildCanvasItems} target={null} ctx={canvasCtx}>
        <div
          className="relative h-full w-full outline-none"
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onDoubleClick={onCanvasDoubleClick}
        >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          connectionLineComponent={FloatingConnectionLine}
          connectionMode={ConnectionMode.Loose}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          onEdgeDoubleClick={onEdgeDoubleClick}
          onMove={onMove}
          deleteKeyCode={null}
          zoomOnDoubleClick={isTree}
          selectionOnDrag={!isTree}
          panOnDrag={isTree ? true : [1]}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          className="bg-background"
        >
          {showGrid && <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />}
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable className="bg-card" />
          <OutlinePanel />
          <HelperLines lines={helperLines} />
        </ReactFlow>
        {editingEdge && (
          <input
            autoFocus
            defaultValue={editingEdge.value}
            onChange={(e) => setEditingEdge({ ...editingEdge, value: e.target.value })}
            onBlur={commitEdgeLabel}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitEdgeLabel();
              } else if (e.key === 'Escape') {
                setEditingEdge(null);
              }
            }}
            className="fixed z-50 w-40 rounded-md border bg-card px-2 py-1 text-xs shadow-lg outline-none"
            style={{ left: editingEdge.x + 8, top: editingEdge.y - 10 }}
            placeholder="连线标签…"
          />
        )}
        </div>
      </ContextMenuHost>
    </MindmapEditorContext.Provider>
  );
}

export function MindmapEditor() {
  // 父组件用 <MindmapEditor key={current.id} /> 控制文档切换时整体重新挂载，
  // 使受控 nodes/edges 的 lazy initializer 从新 current 重新读取。
  return (
    <ReactFlowProvider>
      <EditorCanvas />
    </ReactFlowProvider>
  );
}
