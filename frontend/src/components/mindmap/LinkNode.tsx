// frontend/src/components/mindmap/LinkNode.tsx
// 自由画布链接节点：卡片式外链（标题 + URL + 可选描述），点击 URL 新窗口打开。
import { memo, useState, useEffect, useRef } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Link2, ExternalLink } from 'lucide-react';
import type { MindmapNodeData } from '@ai-task-flow/shared';
import { useMindmapEditor } from './mindmapContext';

export type LinkRFNode = Node<MindmapNodeData, 'link'>;

export const LinkNode = memo(function LinkNode({ id, data }: NodeProps<LinkRFNode>) {
  const { updateNodeData, focusCanvas } = useMindmapEditor();
  const [editingLabel, setEditingLabel] = useState(false);
  const labelRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editingLabel && labelRef.current) labelRef.current.focus();
  }, [editingLabel]);

  return (
    <div
      className="mm-card nopan group w-[220px] rounded-lg border bg-card p-2.5 text-card-foreground"
      data-style={data.style?.fill || undefined}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditingLabel(true);
      }}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <Handle type="source" position={Position.Right} />
      <div className="flex items-center gap-1.5">
        <Link2 className="size-3.5 shrink-0 text-primary" />
        {editingLabel ? (
          <textarea
            ref={labelRef}
            defaultValue={data.label}
            rows={1}
            onBlur={(e) => {
              const trimmed = e.target.value.trim();
              if (trimmed !== data.label) updateNodeData(id, { label: trimmed });
              setEditingLabel(false);
              focusCanvas();
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                setEditingLabel(false);
                focusCanvas();
              }
            }}
            className="nodrag w-full resize-none bg-transparent text-[13px] font-medium outline-none"
          />
        ) : (
          <span className="truncate text-[13px] font-medium">{data.label || '未命名链接'}</span>
        )}
      </div>
      {data.href && (
        <a
          href={data.href}
          target="_blank"
          rel="noreferrer"
          className="nodrag mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={(e) => e.stopPropagation()}
          title={data.href}
        >
          <ExternalLink className="size-3 shrink-0" />
          <span className="truncate">{data.href}</span>
        </a>
      )}
      {data.note && (
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground/80">{data.note}</p>
      )}
    </div>
  );
});
