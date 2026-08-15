// frontend/src/components/mindmap/NodeStylePanel.tsx
// 选中节点的浮动样式面板：标记色（5 语义 + 5 chart 分类）+ 边框样式 + 圆角 + 字号。
// shadcn 语义 key（data-style），渲染走 index.css 的 color-mix tint，主题自动跟随。
import { memo } from 'react';
import { Panel, useStore } from '@xyflow/react';
import { Ban, Minus, Square, SquareDashed, Type } from 'lucide-react';
import type { CanvasFill, CanvasNodeStyle, MindmapNodeData } from '@ai-task-flow/shared';
import { useMindmapEditor } from './mindmapContext';
import { cn } from '@/lib/utils';

/** 色板：语义强调色 + chart 中性分类色 */
const FILLS: Array<{ key: CanvasFill; title: string; swatch: string }> = [
  { key: 'default', title: '默认', swatch: 'transparent' },
  { key: 'primary', title: '重点', swatch: 'var(--primary)' },
  { key: 'secondary', title: '次要', swatch: 'var(--secondary-foreground)' },
  { key: 'destructive', title: '警示', swatch: 'var(--destructive)' },
  { key: 'muted', title: '弱化', swatch: 'var(--muted-foreground)' },
  { key: 'chart-1', title: '分类 1', swatch: 'var(--chart-1)' },
  { key: 'chart-2', title: '分类 2', swatch: 'var(--chart-2)' },
  { key: 'chart-3', title: '分类 3', swatch: 'var(--chart-3)' },
  { key: 'chart-4', title: '分类 4', swatch: 'var(--chart-4)' },
  { key: 'chart-5', title: '分类 5', swatch: 'var(--chart-5)' },
];

const FONT_SIZES: Array<{ key: NonNullable<CanvasNodeStyle['fontSize']>; label: string }> = [
  { key: 'sm', label: '小' },
  { key: 'md', label: '中' },
  { key: 'lg', label: '大' },
];

export const NodeStylePanel = memo(function NodeStylePanel() {
  const selected = useStore((s) => s.nodes.find((n) => n.selected));
  const { updateNodeData } = useMindmapEditor();

  // 未选中（或多选）不显示
  if (!selected) return null;
  const data = selected.data as MindmapNodeData;
  const style: CanvasNodeStyle = data.style ?? {};
  const set = (patch: Partial<CanvasNodeStyle>) =>
    updateNodeData(selected.id, { style: { ...style, ...patch } });
  const toggle = <K extends 'borderStyle' | 'rounded'>(key: K, value: CanvasNodeStyle[K]) =>
    set({ [key]: style[key] === value ? undefined : value } as Partial<CanvasNodeStyle>);

  return (
    <Panel position="bottom-center" className="!mb-3">
      <div className="bg-popover/85 flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5 shadow-lg backdrop-blur-md">
        {/* 标记色板 */}
        <div className="flex items-center gap-1">
          {FILLS.map((f) => (
            <button
              key={f.key}
              title={f.title}
              onClick={() => set({ fill: f.key === 'default' ? undefined : f.key })}
              className={cn(
                'flex size-5 items-center justify-center rounded-full border transition-transform hover:scale-110',
                style.fill === f.key || (!style.fill && f.key === 'default')
                  ? 'ring-2 ring-ring ring-offset-1 ring-offset-popover'
                  : '',
              )}
              style={{ background: f.swatch }}
            >
              {f.key === 'default' && <Ban className="size-3 text-muted-foreground" />}
            </button>
          ))}
        </div>
        <span className="bg-border h-4 w-px" />
        {/* 边框样式 */}
        <button
          title={style.borderStyle === 'dashed' ? '实线边框' : '虚线边框'}
          onClick={() => toggle('borderStyle', 'dashed')}
          className={cn(
            'text-muted-foreground hover:text-foreground transition-colors',
            style.borderStyle === 'dashed' && 'text-foreground',
          )}
        >
          {style.borderStyle === 'dashed' ? (
            <SquareDashed className="size-4" />
          ) : (
            <Square className="size-4" />
          )}
        </button>
        {/* 圆角 */}
        <button
          title={style.rounded === false ? '圆角开' : '直角'}
          onClick={() => set({ rounded: style.rounded === false ? undefined : false })}
          className={cn(
            'text-muted-foreground hover:text-foreground transition-colors',
            style.rounded === false && 'text-foreground',
          )}
        >
          <Minus className="size-4" />
        </button>
        <span className="bg-border h-4 w-px" />
        {/* 字号 */}
        <div className="flex items-center gap-0.5">
          <Type className="text-muted-foreground mr-0.5 size-3.5" />
          {FONT_SIZES.map((f) => (
            <button
              key={f.key}
              onClick={() => set({ fontSize: f.key === 'md' ? undefined : f.key })}
              className={cn(
                'rounded px-1.5 py-0.5 text-xs transition-colors',
                (style.fontSize ?? 'md') === f.key
                  ? 'bg-accent text-accent-foreground font-semibold'
                  : 'text-muted-foreground hover:text-foreground',
                f.key === 'lg' && 'text-sm',
                f.key === 'sm' && 'text-[10px]',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
    </Panel>
  );
});
