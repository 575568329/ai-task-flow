// frontend/src/components/DiffViewer.tsx
// 轻量 diff 渲染:按行首符号着色(@@/+/-/文件头)+ 行号,monospace,零外部 CSS 依赖。
// 不用 react-diff-view(其全局 CSS 与 Tailwind 主题易冲突),自渲染足够审查场景。
import { cn } from '@/lib/utils';

interface DiffViewerProps {
  text: string;
  className?: string;
}

type LineKind = 'hunk' | 'add' | 'del' | 'context' | 'meta';

function classify(line: string): LineKind {
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+++') || line.startsWith('---')) return 'meta';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return 'context';
}

const KIND_CLASS: Record<LineKind, string> = {
  hunk: 'bg-primary/10 text-primary',
  add: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  del: 'bg-red-500/10 text-red-600 dark:text-red-400',
  meta: 'text-muted-foreground font-semibold',
  context: '',
};

export function DiffViewer({ text, className }: DiffViewerProps) {
  const lines = text.split('\n');
  if (lines.length === 0 || (lines.length === 1 && !lines[0])) {
    return (
      <div className="text-muted-foreground p-3 text-xs">(无改动)</div>
    );
  }

  return (
    <pre
      className={cn(
        'overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-5',
        className,
      )}
    >
      {lines.map((line, idx) => {
        const kind = classify(line);
        return (
          <div key={idx} className={cn('flex', KIND_CLASS[kind])}>
            <span className="text-muted-foreground/50 w-10 shrink-0 select-none pr-2 text-right tabular-nums">
              {idx + 1}
            </span>
            <span className="whitespace-pre">{line || ' '}</span>
          </div>
        );
      })}
    </pre>
  );
}
