// frontend/src/components/views/UsageView.tsx
// Token 用量面板:扫本机 Claude Code 会话 jsonl 的 token 消耗。
// 顶部汇总卡(成本/Token/请求/缓存)+ 五维度切换(模型/任务/项目/天/会话)+ 纯 CSS 横向柱状图。
// 会话维度行挂 WSL/Win 来源小标签。
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { usageApi } from '@/api/usage';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { UsageSummary } from '@ai-task-flow/shared';
import { cn } from '@/lib/utils';

type Dimension = 'model' | 'task' | 'project' | 'day' | 'session';

const DIMENSIONS: { key: Dimension; label: string }[] = [
  { key: 'model', label: '按模型' },
  { key: 'task', label: '按任务' },
  { key: 'project', label: '按项目' },
  { key: 'day', label: '按天' },
  { key: 'session', label: '按会话' },
];

type TokenFields = {
  inputTokens: number;
  outputTokens: number;
  cacheCreation5mTokens: number;
  cacheCreation1hTokens: number;
  cacheReadTokens: number;
};

function rowTokens(t: TokenFields): number {
  return t.inputTokens + t.outputTokens + t.cacheCreation5mTokens + t.cacheCreation1hTokens + t.cacheReadTokens;
}

function fmtTokens(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function fmtCost(c: number): string {
  return '$' + c.toFixed(4);
}

interface BarRowData {
  label: string;
  sublabel?: string;
  tokens: number;
  cost: number;
  extra?: string;
  trailing?: ReactNode;
}

function BarRow({ label, sublabel, tokens, max, cost, extra, trailing }: BarRowData & { max: number }) {
  const pct = max > 0 ? Math.max(2, (tokens / max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="truncate font-medium" title={label}>
          {label}
          {trailing}
        </span>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {fmtTokens(tokens)} · {fmtCost(cost)}
          {extra ? ` · ${extra}` : ''}
        </span>
      </div>
      <div className="bg-muted h-2 overflow-hidden rounded-full">
        <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      {sublabel && (
        <div className="text-xs text-muted-foreground truncate">{sublabel}</div>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function SourceBadge({ source }: { source: 'wsl' | 'windows' }) {
  return (
    <Badge variant={source === 'wsl' ? 'secondary' : 'outline'} className="ml-1.5 text-[10px]">
      {source === 'wsl' ? 'WSL' : 'Win'}
    </Badge>
  );
}

function DimensionData({ dim, summary }: { dim: Dimension; summary: UsageSummary }) {
  let rows: BarRowData[] = [];

  if (dim === 'model') {
    rows = summary.byModel.map(r => ({
      label: r.model, tokens: rowTokens(r), cost: r.cost, extra: `${r.requestCount} 次`,
    }));
  } else if (dim === 'task') {
    rows = summary.byTask.map(r => ({
      label: r.taskId, tokens: rowTokens(r), cost: r.cost, extra: `${r.sessionCount} 会话`,
    }));
  } else if (dim === 'project') {
    rows = summary.byProject.map(r => ({
      label: r.project.split(/[\\/]/).pop() || r.project,
      sublabel: r.project,
      tokens: rowTokens(r), cost: r.cost, extra: `${r.sessionCount} 会话`,
    }));
  } else if (dim === 'day') {
    rows = summary.byDay.map(r => ({
      label: r.date, tokens: rowTokens(r), cost: r.cost, extra: `${r.requestCount} 次`,
    }));
  } else {
    rows = summary.bySession.map(r => {
      const src = r.source === 'wsl' ? 'WSL' : r.source === 'windows' ? 'Win' : '';
      return {
        label: r.title || r.sessionId.slice(0, 8),
        sublabel: [r.taskId, r.sessionId].filter(Boolean).join(' · '),
        tokens: rowTokens(r), cost: r.cost,
        extra: [`${r.requestCount} 次`, src].filter(Boolean).join(' · '),
        trailing: r.source ? <SourceBadge source={r.source} /> : undefined,
      };
    });
  }

  const max = Math.max(1, ...rows.map(r => r.tokens));
  if (rows.length === 0) {
    return <div className="py-12 text-center text-sm text-muted-foreground">无数据</div>;
  }
  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <BarRow key={i} {...r} max={max} />
      ))}
    </div>
  );
}

export function UsageView() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [dim, setDim] = useState<Dimension>('model');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    usageApi
      .summary({})
      .then(s => {
        if (!cancelled) setSummary(s);
      })
      .catch(() => {
        // http 拦截器已 toast
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <div className="text-muted-foreground p-6">加载用量数据…</div>;
  }
  if (!summary) {
    return <div className="text-muted-foreground p-6">暂无用量数据</div>;
  }

  const totalTokens =
    summary.totalInputTokens +
    summary.totalOutputTokens +
    summary.totalCacheCreationTokens +
    summary.totalCacheReadTokens;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-6 py-4">
        <h1 className="text-lg font-semibold">Token 用量</h1>
        <p className="text-xs text-muted-foreground">
          本机所有 Claude Code 会话的 token 消耗(扫 ~/.claude/projects 的 jsonl 日志)
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-6 p-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="总成本" value={fmtCost(summary.totalCost)} />
            <Stat label="总 Token" value={fmtTokens(totalTokens)} />
            <Stat label="请求数" value={String(summary.totalRequests)} />
            <Stat
              label="缓存命中"
              value={fmtTokens(summary.totalCacheReadTokens)}
              hint={`写入 ${fmtTokens(summary.totalCacheCreationTokens)}`}
            />
          </div>

          <div className="inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1">
            {DIMENSIONS.map(d => (
              <button
                key={d.key}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm transition-colors',
                  dim === d.key
                    ? 'bg-background font-medium shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setDim(d.key)}
              >
                {d.label}
              </button>
            ))}
          </div>

          <DimensionData dim={dim} summary={summary} />
        </div>
      </ScrollArea>
    </div>
  );
}
