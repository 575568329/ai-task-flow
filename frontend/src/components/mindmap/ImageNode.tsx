// frontend/src/components/mindmap/ImageNode.tsx
// 自由画布图片节点：img（object-contain 不变形）+ 可选标题 + NodeResizer（锁定宽高比）。
// 无图时显示上传占位（点击选文件）；尺寸从自然尺寸播种（见 uploadImage.ts）。
import { memo, useRef, useState, useEffect, useCallback } from 'react';
import { Handle, Position, NodeResizer, type NodeProps, type Node } from '@xyflow/react';
import { ImagePlus, Loader2 } from 'lucide-react';
import type { MindmapNodeData } from '@ai-task-flow/shared';
import { useMindmapEditor } from './mindmapContext';
import { uploadImageFile } from './uploadImage';
import { cn } from '@/lib/utils';

export type ImageRFNode = Node<MindmapNodeData, 'image'>;

export const ImageNode = memo(function ImageNode({ id, data, selected }: NodeProps<ImageRFNode>) {
  const { updateNodeData, focusCanvas } = useMindmapEditor();
  const [uploading, setUploading] = useState(false);
  const [editingLabel, setEditingLabel] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const labelRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editingLabel && labelRef.current) labelRef.current.focus();
  }, [editingLabel]);

  const upload = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const up = await uploadImageFile(file);
        if (up) {
          updateNodeData(id, { imageUrl: up.url, width: up.width, height: up.height, label: data.label || file.name.replace(/\.[^.]+$/, '') });
        }
      } finally {
        setUploading(false);
      }
    },
    [id, data.label, updateNodeData],
  );

  return (
    <div
      className="mm-card nopan group flex flex-col gap-1 rounded-lg border bg-card p-1.5 text-card-foreground"
      data-style={data.style?.fill || undefined}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditingLabel(true);
      }}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <NodeResizer keepAspectRatio minWidth={60} minHeight={40} isVisible={selected} />
      {/* 四向连接点：浮边渲染忽略具体 handle，连线从包围盒交点出发 */}
      <Handle type="source" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Left} id="left" />
      {data.imageUrl ? (
        <img
          src={data.imageUrl}
          alt={data.label || '画布图片'}
          draggable={false}
          style={{ width: data.width ?? 240, height: data.height ?? 160 }}
          // 不加 nodrag：图片占节点主体，禁拖会导致整节点拖不动；原生拖拽由 draggable=false 防
          className="rounded-md object-contain"
        />
      ) : uploading ? (
        <div className="flex h-[120px] w-[200px] items-center justify-center rounded-md border border-dashed">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <button
          className="nodrag flex h-[120px] w-[200px] flex-col items-center justify-center gap-1.5 rounded-md border border-dashed text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            fileRef.current?.click();
          }}
        >
          <ImagePlus className="size-5" />
          <span className="text-xs">点击上传图片</span>
        </button>
      )}
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
          className="nodrag w-full resize-none bg-transparent text-center text-xs outline-none"
        />
      ) : data.label ? (
        <span className={cn('max-w-[280px] self-center truncate text-xs text-muted-foreground')}>
          {data.label}
        </span>
      ) : null}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = ''; // 允许重复选择同一文件
        }}
      />
    </div>
  );
});
