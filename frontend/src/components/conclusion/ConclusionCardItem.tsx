import type { Conclusion, ConclusionSummary } from '@ai-task-flow/shared';
import { ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RevisionTimeline } from './RevisionTimeline';

interface Props {
  summary: ConclusionSummary;
  expanded: boolean;
  detail?: Conclusion;
  onToggle: () => void;
  onEdit: () => void;
  onPatch: () => void;
  onDelete: () => void;
}

export function ConclusionCardItem({ summary, expanded, detail, onToggle, onEdit, onPatch, onDelete }: Props) {
  const latest = detail?.revisions[detail.revisions.length - 1];

  return (
    <article className="bg-card rounded-lg border p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{summary.title}</h3>
            <span className="text-muted-foreground text-xs">rev {summary.rev}</span>
            {summary.matchedRev && (
              <Badge variant="secondary" className="text-[10px]">命中 rev {summary.matchedRev}</Badge>
            )}
          </div>
          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span>{summary.project ?? '个人'}</span>
            {summary.version && <span>{summary.version}</span>}
            <span>{summary.latestDate}</span>
            <span>{summary.source.tool}</span>
            {summary.source.conversationName && <span>· {summary.source.conversationName}</span>}
            {summary.tags?.map((tag) => <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>)}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onToggle} title="展开/收起">
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          <span className="ml-1 text-xs">演进 ({summary.rev})</span>
        </Button>
      </div>

      {!expanded && (
        <p className="text-muted-foreground mt-3 line-clamp-3 text-sm whitespace-pre-wrap">
          {summary.latestDecisionExcerpt}
        </p>
      )}

      {expanded && latest && (
        <div className="mt-4 space-y-3 text-sm">
          <section>
            <h4 className="text-xs font-semibold">结论/决策</h4>
            <p className="mt-1 whitespace-pre-wrap">{latest.decision}</p>
          </section>
          {latest.data && (
            <section>
              <h4 className="text-xs font-semibold">关键数据</h4>
              <p className="mt-1 whitespace-pre-wrap">{latest.data}</p>
            </section>
          )}
          {latest.openItems && (
            <section>
              <h4 className="text-xs font-semibold">待办/未决</h4>
              <p className="mt-1 whitespace-pre-wrap">{latest.openItems}</p>
            </section>
          )}
          {latest.codeRefs?.length ? (
            <section>
              <h4 className="text-xs font-semibold">代码/文件位置</h4>
              <ul className="mt-1 font-mono text-xs">
                {latest.codeRefs.map((ref, index) => (
                  <li key={`${ref.path}:${ref.startLine ?? ''}:${index}`}>
                    {ref.path}
                    {ref.startLine ? `:${ref.startLine}${ref.endLine ? `-${ref.endLine}` : ''}` : ''}
                    {ref.note ? ` — ${ref.note}` : ''}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <RevisionTimeline revisions={detail.revisions} />
          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="mr-1 size-3.5" />编辑（追加新版）
            </Button>
            <Button variant="outline" size="sm" onClick={onPatch}>
              改信息
            </Button>
            <Button variant="ghost" size="sm" onClick={onDelete}>
              <Trash2 className="mr-1 size-3.5" />删除
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}
