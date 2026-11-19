import type { ConclusionRevision } from '@ai-task-flow/shared';
import { MessageContent } from '@/components/common/MessageContent';
import { cn } from '@/lib/utils';
import { conversationDisplay } from './conversationSource';
import { CONCLUSION_MARKDOWN_CLASS, stripSectionHeading } from './contentFormat';

interface Props {
  revisions: ConclusionRevision[];
  compact?: boolean;
}

export function RevisionTimeline({ revisions, compact = false }: Props) {
  const newestFirst = [...revisions].sort((a, b) => b.rev - a.rev);

  return (
    <ol className={cn('mt-3 space-y-3 border-l pl-4', compact && 'mt-0 space-y-2 pl-3')}>
      {newestFirst.map((revision) => {
        const conversation = conversationDisplay(revision.source);

        return (
        <li key={revision.rev} className="relative">
          <span className="bg-background absolute top-1.5 -left-[1.28rem] size-2 rounded-full border" />
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
            <span className="text-foreground font-medium">rev {revision.rev}</span>
            <span>{revision.date}</span>
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
          <details className="mt-1">
            <summary className="text-muted-foreground cursor-pointer text-xs">查看本版全文</summary>
            <div className="mt-2 space-y-3 text-sm">
              <section>
                <h4 className="text-xs font-semibold">结论/决策</h4>
                <MessageContent
                  allowHtml={false}
                  content={stripSectionHeading(revision.decision)}
                  className={CONCLUSION_MARKDOWN_CLASS}
                />
              </section>
              {revision.data && (
                <section>
                  <h4 className="text-xs font-semibold">关键数据</h4>
                  <MessageContent
                    allowHtml={false}
                    content={stripSectionHeading(revision.data)}
                    className={CONCLUSION_MARKDOWN_CLASS}
                  />
                </section>
              )}
              {revision.openItems && (
                <section>
                  <h4 className="text-xs font-semibold">待办/未决</h4>
                  <MessageContent
                    allowHtml={false}
                    content={stripSectionHeading(revision.openItems)}
                    className={CONCLUSION_MARKDOWN_CLASS}
                  />
                </section>
              )}
              {revision.codeRefs?.length ? (
                <section>
                  <h4 className="text-xs font-semibold">代码/文件位置</h4>
                  <ul className="font-mono text-xs leading-6">
                    {revision.codeRefs.map((ref, index) => (
                      <li key={`${ref.path}:${ref.startLine ?? ''}:${index}`}>
                        {ref.path}
                        {ref.startLine ? `:${ref.startLine}${ref.endLine ? `-${ref.endLine}` : ''}` : ''}
                        {ref.note ? ` — ${ref.note}` : ''}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          </details>
        </li>
        );
      })}
    </ol>
  );
}
