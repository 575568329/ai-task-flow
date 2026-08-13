// frontend/src/components/board/ToolUseCard.tsx
// tool_use + 关联 tool_result 的折叠卡片。
// 收起态显示「🔧 {工具名} {关键入参摘要}」;展开看完整 input + 结果(is_error 标红)。
// 性能:content-visibility:auto 跳过屏幕外卡片布局;折叠时不 mount 展开内容(避免 JSON.stringify 开销)。
import { memo, useState } from 'react';
import { Wrench, ChevronDown, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Collapse } from '@/components/ui/collapse';
import { cn } from '@/lib/utils';

interface ToolUseCardProps {
  id: string;
  name: string;
  input: unknown;
  result?: { content: string; isError: boolean };
}

/** 从 input 里挑一个最关键的字段做摘要(文件路径 / 命令 / pattern),没有则 JSON 截断 */
function summarize(name: string, input: unknown): string {
  if (input == null || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;
  // 常见工具的优先字段
  const preferByKey: Record<string, string[]> = {
    Read: ['file_path'],
    Edit: ['file_path'],
    Write: ['file_path'],
    Bash: ['command'],
    Grep: ['pattern'],
    Glob: ['pattern'],
    Task: ['description'],
  };
  const keys = preferByKey[name] ?? ['file_path', 'command', 'pattern', 'path', 'query'];
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v) return v;
  }
  // 兜底:取第一个字符串字段
  for (const v of Object.values(obj)) {
    if (typeof v === 'string' && v) return v.length > 60 ? v.slice(0, 60) + '…' : v;
  }
  return '';
}

// 仅展开时才 mount:JSON.stringify 对超大 input/result 开销显著,折叠时不需要
const ExpandedBody = memo(function ExpandedBody({
  input,
  result,
}: {
  input: unknown;
  result?: { content: string; isError: boolean };
}) {
  return (
    <div className="border-border space-y-1 border-t px-2 py-1 text-[10px]">
      {input != null && (
        <div>
          <div className="text-muted-foreground mb-0.5">入参</div>
          <pre className="bg-background overflow-x-auto rounded p-1 font-mono">
            {JSON.stringify(input, null, 2)}
          </pre>
        </div>
      )}
      {result && (
        <div>
          <div
            className={cn(
              'mb-0.5',
              result.isError ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {result.isError ? '结果(出错)' : '结果'}
          </div>
          <pre
            className={cn(
              'bg-background overflow-x-auto rounded p-1 font-mono',
              result.isError && 'border-destructive/50 border',
            )}
          >
            {result.content || '(空)'}
          </pre>
        </div>
      )}
    </div>
  );
});

export function ToolUseCard({ name, input, result }: ToolUseCardProps) {
  const [open, setOpen] = useState(false);
  const summary = summarize(name, input);
  const done = !!result;

  return (
    <div className="border-border bg-muted/20 rounded-md border" style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 28px', contain: 'layout style paint' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hover:bg-muted/40 flex w-full items-center gap-1 px-2 py-0.5 text-left text-[11px]"
      >
        <Wrench className="size-3 shrink-0 text-muted-foreground" />
        <span className="font-medium">{name}</span>
        {summary && (
          <span className="text-muted-foreground truncate font-mono text-[10px]">{summary}</span>
        )}
        {done ? (
          result?.isError ? (
            <XCircle className="ml-auto size-3 shrink-0 text-destructive" />
          ) : (
            <CheckCircle2 className="ml-auto size-3 shrink-0 text-emerald-500" />
          )
        ) : (
          <Loader2 className="ml-auto size-3 shrink-0 animate-spin text-muted-foreground" />
        )}
        <ChevronDown
          className={cn('size-3 shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>
      <Collapse open={open}>
        {/* 仅展开时才 mount 展开内容:避免 19+ 张折叠卡片同时做 JSON.stringify */}
        {open && <ExpandedBody input={input} result={result} />}
      </Collapse>
    </div>
  );
}
