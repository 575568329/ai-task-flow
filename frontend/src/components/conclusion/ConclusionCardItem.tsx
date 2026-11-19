import { useState } from 'react';
import type { Conclusion, ConclusionSummary } from '@ai-task-flow/shared';
import {
  ChevronDown, ChevronRight, Code2, Copy, Database, ListTodo, Pencil, Target, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toaster';
import { MessageContent } from '@/components/common/MessageContent';
import { conversationDisplay } from './conversationSource';
import { CONCLUSION_MARKDOWN_CLASS, plainTextExcerpt, stripSectionHeading } from './contentFormat';
import { RevisionTimeline } from './RevisionTimeline';

/** 超过这个长度的结论默认折叠，避免一屏被长文占满 */
const LONG_TEXT_THRESHOLD = 1200;

interface Props {
  summary: ConclusionSummary;
  expanded: boolean;
  detail?: Conclusion;
  onToggle: () => void;
  onEdit: () => void;
  onPatch: () => void;
  onDelete: () => void;
}

function LongMarkdown({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  const text = stripSectionHeading(content);

  if (text.length <= LONG_TEXT_THRESHOLD) {
    return <MessageContent allowHtml={false} content={text} className={CONCLUSION_MARKDOWN_CLASS} />;
  }

  return (
    <div>
      <div className={open ? '' : 'relative max-h-72 overflow-hidden'}>
        <MessageContent allowHtml={false} content={text} className={CONCLUSION_MARKDOWN_CLASS} />
        {!open && (
          <div className="from-card pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t to-transparent" />
        )}
      </div>
      <Button variant="ghost" size="sm" className="mt-1" onClick={() => setOpen((value) => !value)}>
        {open ? '收起' : '展开全文'}
      </Button>
    </div>
  );
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
          {!expanded && (
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
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onToggle} title="展开/收起">
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          <span className="ml-1 text-xs">演进 ({summary.rev})</span>
        </Button>
      </div>

      {!expanded && (
        <p className="text-muted-foreground mt-3 line-clamp-3 text-sm">
          {plainTextExcerpt(summary.latestDecisionExcerpt)}
        </p>
      )}

      {expanded && latest && (
        <div className="mt-4 grid gap-6 @4xl:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="min-w-0 space-y-5">
            <section>
              <h4 className="flex items-center gap-2 border-b pb-1 text-sm font-semibold">
                <Target className="size-4" />结论/决策
              </h4>
              <div className="mt-2"><LongMarkdown content={latest.decision} /></div>
            </section>

            {latest.data && (
              <details className="bg-muted/20 rounded-lg border">
                <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-semibold">
                  <Database className="size-4" />关键数据
                </summary>
                <div className="px-3 pb-3">
                  <MessageContent
                    allowHtml={false}
                    content={stripSectionHeading(latest.data)}
                    className={CONCLUSION_MARKDOWN_CLASS}
                  />
                </div>
              </details>
            )}

            {latest.openItems && (
              <details className="bg-muted/20 rounded-lg border">
                <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-semibold">
                  <ListTodo className="size-4" />待办/未决
                </summary>
                <div className="px-3 pb-3">
                  <MessageContent
                    allowHtml={false}
                    content={stripSectionHeading(latest.openItems)}
                    className={CONCLUSION_MARKDOWN_CLASS}
                  />
                </div>
              </details>
            )}

            {latest.codeRefs?.length ? (
              <details className="bg-muted/20 rounded-lg border">
                <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-semibold">
                  <Code2 className="size-4" />代码/文件位置
                </summary>
                <ul className="px-3 pb-3 font-mono text-xs leading-6">
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
          </div>

          <aside className="space-y-4 border-t pt-4 @4xl:border-t-0 @4xl:border-l @4xl:pl-5 @4xl:pt-0">
            <div className="rounded-lg border p-3">
              <h4 className="text-xs font-semibold">来源</h4>
              <dl className="text-muted-foreground mt-2 space-y-1 text-xs">
                <div className="flex justify-between gap-2">
                  <dt>工具</dt>
                  <dd>{summary.source.tool}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>对话</dt>
                  <dd className="truncate text-right" title={conversation.label}>{conversation.label}</dd>
                </div>
                {conversationId && conversation.shortId && (
                  <div className="flex justify-between gap-2">
                    <dt>ID</dt>
                    <dd>
                      <button
                        type="button"
                        className="hover:text-foreground inline-flex items-center gap-1 font-mono"
                        title={conversationId}
                        onClick={() => void copyConversationId()}
                      >
                        {conversation.shortId}
                        <Copy className="size-3" />
                      </button>
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <dt>日期</dt>
                  <dd>{summary.latestDate}</dd>
                </div>
              </dl>
            </div>

            <div>
              <h4 className="mb-2 text-xs font-semibold">演进 ({summary.rev})</h4>
              <RevisionTimeline revisions={detail.revisions} compact />
            </div>

            <div className="flex flex-col gap-2">
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
          </aside>
        </div>
      )}
    </article>
  );
}
