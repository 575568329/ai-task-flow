import type { Conclusion, ConclusionSummary } from '@ai-task-flow/shared';
import { ChevronDown, ChevronRight, Copy, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toaster';
import { MessageContent } from '@/components/common/MessageContent';
import { conversationDisplay } from './conversationSource';
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
  const conversationId = summary.source.conversationId?.trim();
  const conversation = conversationDisplay(summary.source);

  const copyConversationId = async () => {
    if (!conversationId) return;
    if (!navigator.clipboard) {
      toast.error('当前环境不支持复制');
      return;
    }
    try {
      await navigator.clipboard.writeText(conversationId);
      toast.success('对话 ID 已复制');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`复制失败：${message}`);
    }
  };

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
            {summary.tags?.map((tag) => <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>)}
          </div>
          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span>对话：{conversation.label}</span>
            {conversationId && conversation.shortId && (
              <button
                type="button"
                className="hover:text-foreground inline-flex items-center gap-1 font-mono"
                title={conversationId}
                onClick={() => void copyConversationId()}
              >
                ID {conversation.shortId}
                <Copy className="size-3" />
              </button>
            )}
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
            <div className="mt-1"><MessageContent allowHtml={false} content={latest.decision} /></div>
          </section>
          {latest.data && (
            <details className="rounded border px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold">关键数据</summary>
              <div className="mt-2"><MessageContent allowHtml={false} content={latest.data} /></div>
            </details>
          )}
          {latest.openItems && (
            <details className="rounded border px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold">待办/未决</summary>
              <div className="mt-2"><MessageContent allowHtml={false} content={latest.openItems} /></div>
            </details>
          )}
          {latest.codeRefs?.length ? (
            <details className="rounded border px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold">代码/文件位置</summary>
              <ul className="mt-2 font-mono text-xs">
                {latest.codeRefs.map((ref, index) => (
                  <li key={`${ref.path}:${ref.startLine ?? ''}:${index}`}>
                    {ref.path}
                    {ref.startLine ? `:${ref.startLine}${ref.endLine ? `-${ref.endLine}` : ''}` : ''}
                    {ref.note ? ` — ${ref.note}` : ''}
                  </li>
                ))}
              </ul>
            </details>
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
