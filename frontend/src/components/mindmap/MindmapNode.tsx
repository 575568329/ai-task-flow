// frontend/src/components/mindmap/MindmapNode.tsx
// 自定义思维导图节点：三层级样式（根/一级/叶子）+ 分支色 + 双击编辑 + note 图标 + 右键菜单。
// React.memo 包裹 + data 稳定引用 + 回调走 Context → 拖拽时只重渲染被拖节点。
// 右键菜单用通用 ContextMenuHost，菜单项工厂在 nodeContextMenu.ts。
//
// 自由画布改造：
// - 单 source handle + ConnectionMode.Loose（任意方向连线，浮边忽略 handle 位置）
// - 文本自动换行（whitespace-normal + max-w，修复单行无限宽）
// - data-style 透传（shadcn 语义 tint 着色，见 index.css）
// - 双击空白创建的节点 mount 时自动进入编辑（autoEditQueue），失焦仍为空则删除
import { memo, useState, useRef, useEffect, useCallback } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { FileText, ChevronRight, ChevronDown } from 'lucide-react';
import type { MindmapNodeData } from '@ai-task-flow/shared';
import { useMindmapEditor } from './mindmapContext';
import { consumeAutoEdit } from './autoEditQueue';
import { ContextMenuHost } from '@/components/context-menu/ContextMenuHost';
import { buildMindmapNodeItems, type MindmapMenuCtx } from './nodeContextMenu';
import { cn } from '@/lib/utils';

// 类型参数含全部画布节点种类：状态容器里混合存放（组件各自按 NodeProps<XxxRFNode> 收窄）
export type MindmapRFNode = Node<MindmapNodeData, 'mindmap' | 'image' | 'link' | 'group'>;

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
    moveSibling,
    hasChildren,
    focusCanvas,
  } = useMindmapEditor();
  // 双击空白创建的节点自动进入编辑（模块队列，一次性消费）
  const [autoCreated] = useState(() => consumeAutoEdit(id));
  const [editing, setEditing] = useState(autoCreated);
  // 入场动画：mount 时 opacity 0 + scale 0.88，下一帧过渡到正常（新增节点淡入）
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const level = data.level ?? 1;
  const isRoot = level === 0;
  const isBranch = level === 1;

  // 进入编辑态：focus + 光标定位到末尾 + 高度自适应（新建节点后自动进入编辑的关键体验）
  useEffect(() => {
    if (editing && inputRef.current) {
      const el = inputRef.current;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [editing]);

  const commitLabel = useCallback(() => {
    const val = inputRef.current?.value ?? '';
    const trimmed = val.trim();
    // 双击空白创建的节点未输入内容 → 删除（避免留空白卡片）
    if (!trimmed && autoCreated) {
      deleteNode(id);
      setEditing(false);
      focusCanvas();
      return;
    }
    if (trimmed && trimmed !== data.label) {
      updateNodeData(id, { label: trimmed });
    }
    setEditing(false);
    focusCanvas(); // 焦点回画布容器，Delete/Tab 等快捷键立即可用（Q1）
  }, [id, data.label, updateNodeData, autoCreated, deleteNode, focusCanvas]);

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
    moveSibling,
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
        className={cn('mm-card nopan group flex items-center gap-1.5', cardClass, !entered && 'mm-entering')}
        style={branchBgStyle}
        data-style={data.style?.fill || undefined}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        onContextMenu={(e) => e.stopPropagation()}
      >
        {editing ? (
          <textarea
            ref={inputRef}
            defaultValue={data.label}
            rows={1}
            onBlur={commitLabel}
            onInput={(e) => {
              // 高度自适应（回车换行时撑开）
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
            }}
            onKeyDown={(e) => {
              // IME 组合输入中不响应快捷键（中文拼音按 Enter 选词不触发提交）
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commitLabel();
              } else if (e.key === 'Escape') {
                // R3：Escape 不触发 onBlur，自动创建的空节点需显式删除（防永久空壳）
                if (autoCreated && !inputRef.current?.value.trim()) {
                  deleteNode(id);
                }
                setEditing(false);
                focusCanvas();
              }
            }}
            className={cn(
              'nodrag nopan bg-transparent outline-none resize-none whitespace-pre-wrap break-words',
              'min-w-[60px] max-w-[280px]',
              textClass,
            )}
            // 初宽按内容估算；RF ResizeObserver 会重测节点尺寸更新浮边
            style={{ width: `${Math.min(Math.max(data.label.length + 1, 8), 36)}ch` }}
          />
        ) : (
          <span className={cn('select-none whitespace-normal break-words max-w-[280px]', textClass)}>
            {data.label}
          </span>
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
        {/* 浮边 + Loose 模式：单 source handle 即可任意方向连出/连入 */}
        <Handle type="source" position={Position.Right} />
      </div>
    </ContextMenuHost>
  );
});
