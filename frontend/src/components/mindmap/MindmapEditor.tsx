// frontend/src/components/mindmap/MindmapEditor.tsx
// 受控 React Flow 画布 + dirty 桥 + 自动保存（debounce 2s）+ 乐观锁。
//
// 【架构】nodes/edges 用本地 useState（高频编辑态不进项目 store，避免拖动每像素触发全局
// re-render）。store 只管文档级（current/version/isDirty/saveStatus），通过回调双向同步。
// nodeTypes/edgeTypes 定义在组件外（性能红线：否则每次渲染新引用 → 全部节点重渲染）。
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
} from '@xyflow/react';
import type { MindmapFlowEdge, MindmapFlowNode, MindmapViewport } from '@ai-task-flow/shared';
import { mindmapApi } from '@/api/mindmap';
import { toPng } from 'html-to-image';
import { useMindmapStore } from '@/stores/mindmapStore';
import { MindmapNode, type MindmapRFNode } from './MindmapNode';
import { BranchEdge, type MindmapRFEdge } from './BranchEdge';
import { MindmapEditorContext, type MindmapEditorContextValue } from './mindmapContext';
import { getLayoutedElements } from './layout';
import { useMindmapActions } from './useMindmapActions';
import { useUndoRedo } from './useUndoRedo';
import { OutlinePanel } from './OutlinePanel';
import { ContextMenuHost } from '@/components/context-menu/ContextMenuHost';
import { buildCanvasItems, type MindmapCanvasCtx } from './canvasContextMenu';

// 必须在组件外（否则每次渲染新引用 → RF 重注册所有类型 → 全部节点重渲染）
const nodeTypes = { mindmap: MindmapNode };
const edgeTypes = { mindmap: BranchEdge };
const defaultEdgeOptions = { type: 'mindmap' };

const AUTOSAVE_DELAY = 2000;

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

  // 最新编辑态的 ref（供 debounce 保存的闭包读取，避免捕获过期 state）
  const latestRef = useRef({ nodes, edges, viewport });
  latestRef.current = { nodes, edges, viewport };

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

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds) as MindmapRFNode[]);
      markDirty();
      triggerSave();
    },
    [markDirty, triggerSave],
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
      takeSnapshot();
      setEdges((eds) => addEdge({ ...conn, type: 'mindmap' }, eds) as MindmapRFEdge[]);
      markDirty();
      triggerSave();
    },
    [takeSnapshot, markDirty, triggerSave],
  );

  const onMove: OnMove = useCallback((_evt, vp) => setViewport(vp), []);

  // 拖拽结束记录一次快照（拖拽过程每帧不记录，只松手时记一次）
  const onNodeDragStop = useCallback(() => takeSnapshot(), [takeSnapshot]);

  // 自动布局：Toolbar 触发信号（autoLayoutTick）→ effect 执行 dagre 重排
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

  // 画布右键菜单上下文（自动布局 + 适应视图 + 导出 PNG）
  const triggerAutoLayout = useMindmapStore((s) => s.triggerAutoLayout);
  const { fitView } = useReactFlow();

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

  // 键盘：Tab=加子 / Enter=加同级 / Delete=删子树（编辑态 input 内不拦截）
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
      if (!selectedNode) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return; // 文本编辑中不触发
      if (e.key === 'Tab') {
        e.preventDefault();
        takeSnapshot();
        actions.addChildNode(selectedNode.id);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        takeSnapshot();
        actions.addSiblingNode(selectedNode.id);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if ((selectedNode.data.level ?? 1) === 0) return; // 根节点不可删
        e.preventDefault();
        takeSnapshot();
        actions.deleteNode(selectedNode.id);
      }
    },
    [selectedNode, actions, saveNow, takeSnapshot, undoAction, redoAction],
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
      hasChildren,
    }),
    [updateNodeData, actions, hasChildren, takeSnapshot],
  );

  if (!current) return null;

  return (
    <MindmapEditorContext.Provider value={ctxValue}>
      <ContextMenuHost items={buildCanvasItems} target={null} ctx={canvasCtx}>
        <div className="h-full w-full outline-none" tabIndex={0} onKeyDown={handleKeyDown}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStop={onNodeDragStop}
          onMove={onMove}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          className="bg-background"
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1.5} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable className="bg-card" />
          <OutlinePanel />
        </ReactFlow>
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
