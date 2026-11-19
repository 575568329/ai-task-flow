import { useState } from 'react';
import type { ConclusionRevision } from '@ai-task-flow/shared';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { MessageContent } from '@/components/common/MessageContent';
import { WorkStageBadge } from '@/components/common/WorkStageBadge';
import { cn } from '@/lib/utils';
import { conversationDisplay } from './conversationSource';
import { CONCLUSION_MARKDOWN_CLASS, normalizeLegacyMarkdown } from './contentFormat';

interface Props {
  revisions: ConclusionRevision[];
  compact?: boolean;
}

export function RevisionTimeline({ revisions, compact = false }: Props) {
  const [active, setActive] = useState<ConclusionRevision | null>(null);
  const newestFirst = [...revisions].sort((a, b) => b.rev - a.rev);

  return (
    <>
      <ol className={cn('mt-3 space-y-3 border-l pl-4', compact && 'mt-0 space-y-2 pl-3')}>
        {newestFirst.map((revision) => {
          const conversation = conversationDisplay(revision.source);

          return (
            <li key={revision.rev} className="relative">
              <span className="bg-background absolute top-1.5 -left-[1.28rem] size-2 rounded-full border" />
              <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="text-foreground font-medium">rev {revision.rev}</span>
                <span>{revision.date}</span>
                <WorkStageBadge stage={revision.stage} />
                <span>{revision.source.tool}</span>
                <span>· {conversation.label}</span>
                {conversation.shortId && (
                  <span title={revision.source.conversationId}>· ID {conversation.shortId}</span>
                )}
              </div>
              {revision.changeNote && (
                <p className={cn('mt-1 text-xs', compact && 'text-[11px] leading-5')}>
                  变更：{revision.changeNote}
                </p>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground mt-1 h-6 px-2 text-xs"
                onClick={() => setActive(revision)}
              >
                <ChevronRight className="size-3" />
                查看本版全文
              </Button>
            </li>
          );
        })}
      </ol>

      <Sheet open={active !== null} onOpenChange={(open) => { if (!open) setActive(null); }}>
        <SheetContent side="right" className="w-full overflow-y-auto p-6 sm:max-w-2xl">
          {active && (
            <>
              <SheetHeader>
                <SheetTitle>rev {active.rev} 全文</SheetTitle>
                <SheetDescription>
                  {active.date} · {conversationDisplay(active.source).label}
                  {conversationDisplay(active.source).shortId
                    ? ` · ID ${conversationDisplay(active.source).shortId}`
                    : ''}
                  {active.changeNote ? ` · 变更：${active.changeNote}` : ''}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-5 space-y-5">
                <WorkStageBadge stage={active.stage} />
                <section>
                  <h4 className="text-sm font-semibold">结论/决策</h4>
                  <MessageContent
                    allowHtml={false}
                    content={normalizeLegacyMarkdown(active.decision)}
                    className={CONCLUSION_MARKDOWN_CLASS}
                  />
                </section>
                {active.data && (
                  <section>
                    <h4 className="text-sm font-semibold">关键数据</h4>
                    <MessageContent
                      allowHtml={false}
                      content={normalizeLegacyMarkdown(active.data)}
                      className={CONCLUSION_MARKDOWN_CLASS}
                    />
                  </section>
                )}
                {active.openItems && (
                  <section>
                    <h4 className="text-sm font-semibold">待办/未决</h4>
                    <MessageContent
                      allowHtml={false}
                      content={normalizeLegacyMarkdown(active.openItems)}
                      className={CONCLUSION_MARKDOWN_CLASS}
                    />
                  </section>
                )}
                {active.codeRefs?.length ? (
                  <section>
                    <h4 className="text-sm font-semibold">代码/文件位置</h4>
                    <ul className="mt-2 divide-y rounded-md border text-xs">
                      {active.codeRefs.map((ref, index) => (
                        <li key={`${ref.path}:${ref.startLine ?? ''}:${index}`} className="px-3 py-2">
                          <code className="break-all font-mono">
                            {ref.path}
                            {ref.startLine ? `:${ref.startLine}${ref.endLine ? `-${ref.endLine}` : ''}` : ''}
                          </code>
                          {ref.note && <p className="text-muted-foreground mt-1 text-xs">{ref.note}</p>}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
