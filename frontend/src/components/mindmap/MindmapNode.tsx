// frontend/src/components/mindmap/MindmapNode.tsx
// 自定义思维导图节点：三层级样式（根/一级/叶子）+ 分支色 + 双击编辑 + note 图标 + 右键菜单。
// React.memo 包裹 + data 稳定引用 + 回调走 Context → 拖拽时只重渲染被拖节点。
// 右键菜单用通用 ContextMenuHost，菜单项工厂在 nodeContextMenu.ts。
import { memo, useState, useRef, useEffect, useCallback } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { FileText, ChevronRight, ChevronDown } from 'lucide-react';
import type { MindmapNodeData } from '@ai-task-flow/shared';
import { useMindmapEditor } from './mindmapContext';
import { ContextMenuHost } from '@/components/context-menu/ContextMenuHost';
import { buildMindmapNodeItems, type MindmapMenuCtx } from './nodeContextMenu';
import { cn } from '@/lib/utils';

export type MindmapRFNode = Node<MindmapNodeData, 'mindmap'>;

/** 按 data.branch 取分支色 CSS 变量 */
function branchStyle(branch?: string): React.CSSProperties | undefined {
  if (!branch) return undefined;
  return {
    '--branch-line': `var(--branch-${branch}-line)`,
    '--branch-bg': `var(--branch-${branch}-bg)`,
    '--branch-fg': `var(--branch-${branch}-fg)`,
  } as React.CSSProperties;
}

export const MindmapNode = memo(function MindmapNode({ id, data }: NodeProps<MindmapRFNode>) {
  const {
    updateNodeData,
    addChildNode,
    addSiblingNode,
    deleteNode,
    toggleExpand,
    promoteNode,
    demoteNode,
    hasChildren,
  } = useMindmapEditor();
  const [editing, setEditing] = useState(false);
  // 入场动画：mount 时 opacity 0 + scale 0.88，下一帧过渡到正常（新增节点淡入）
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const inputRef = useRef<HTMLInputElement>(null);
  const level = data.level ?? 1;
  const isRoot = level === 0;
  const isBranch = level === 1;

  // 进入编辑态：focus + 光标定位到末尾（新建节点后自动进入编辑的关键体验）
  useEffect(() => {
    if (editing && inputRef.current) {
      const el = inputRef.current;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, [editing]);

  const commitLabel = useCallback(() => {
    const val = inputRef.current?.value ?? '';
    const trimmed = val.trim();
    if (trimmed && trimmed !== data.label) {
      updateNodeData(id, { label: trimmed });
    }
    setEditing(false);
  }, [id, data.label, updateNodeData]);

  const startEdit = useCallback(() => setEditing(true), []);

  // 右键菜单上下文（edit 复用本地 setEditing，其余复用 editor actions，改色用 updateNodeData）
  const menuCtx: MindmapMenuCtx = {
    edit: startEdit,
    addChild: addChildNode,
    addSibling: addSiblingNode,
    deleteNode,
    toggleExpand,
    promoteNode,
    demoteNode,
    setBranch: (nid, branch) => updateNodeData(nid, { branch }),
    hasChildren,
  };

  const vars = branchStyle(data.branch);

  // 层级样式（贴合 shadcn：rounded-md/border/shadow-sm 语汇）
  const cardClass = isRoot
    ? 'rounded-xl px-5 py-3 bg-primary text-primary-foreground shadow-lg ring-1 ring-primary/20'
    : isBranch
      ? 'rounded-lg px-4 py-2.5 border shadow-sm'
      : 'rounded-md px-3 py-1.5 border bg-card text-card-foreground';

  // 一级分支用分支色背景 + 深色字
  const branchBgStyle =
    isBranch && data.branch
      ? {
          background: 'var(--branch-bg)',
          color: 'var(--branch-fg)',
          borderColor: 'var(--branch-line)',
          ...vars,
        }
      : vars;

  const textClass = isRoot
    ? 'text-lg font-bold'
    : isBranch
      ? 'text-sm font-semibold'
      : 'text-[13px] font-medium';

  return (
    <ContextMenuHost items={buildMindmapNodeItems} target={{ id, data }} ctx={menuCtx}>
      <div
        className={cn('mm-card group flex items-center gap-1.5', cardClass, !entered && 'mm-entering')}
        style={branchBgStyle}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        onContextMenu={(e) => e.stopPropagation()}
      >
        <Handle type="target" position={Position.Left} />
        {editing ? (
          <input
            ref={inputRef}
            defaultValue={data.label}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitLabel();
              } else if (e.key === 'Escape') {
                setEditing(false);
              }
            }}
            className={cn('nodrag nopan bg-transparent outline-none min-w-[40px]', textClass)}
            // 粗略自适应宽度（ch 估算）；RF 内置 ResizeObserver 会重测节点尺寸更新 handle
            style={{ width: `${Math.max(data.label.length + 1, 4)}ch` }}
          />
        ) : (
          <span className={cn('select-none whitespace-nowrap', textClass)}>{data.label}</span>
        )}
        {data.note && <FileText className="size-3 shrink-0 opacity-50" />}
        {hasChildren(id) && (
          <button
            className="nodrag ml-0.5 flex size-4 shrink-0 items-center justify-center rounded opacity-40 hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              toggleExpand(id);
            }}
            title={data.expanded === false ? '展开子节点' : '折叠子节点'}
          >
            {data.expanded === false ? (
              <ChevronRight className="size-3" />
            ) : (
              <ChevronDown className="size-3" />
            )}
          </button>
        )}
        <Handle type="source" position={Position.Right} />
      </div>
    </ContextMenuHost>
  );
});
