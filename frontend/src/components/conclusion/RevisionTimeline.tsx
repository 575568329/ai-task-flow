import type { ConclusionRevision } from '@ai-task-flow/shared';

interface Props {
  revisions: ConclusionRevision[];
}

export function RevisionTimeline({ revisions }: Props) {
  const newestFirst = [...revisions].sort((a, b) => b.rev - a.rev);

  return (
    <ol className="mt-3 space-y-3 border-l pl-4">
      {newestFirst.map((revision) => {
        const conversationLabel = revision.source.conversationName
          ?? (revision.source.tool === 'manual' ? '手工创建' : '未命名对话');
        const shortConversationId = revision.source.conversationId?.slice(0, 8);

        return (
        <li key={revision.rev} className="relative">
          <span className="bg-background absolute top-1.5 -left-[1.28rem] size-2 rounded-full border" />
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
            <span className="text-foreground font-medium">rev {revision.rev}</span>
            <span>{revision.date}</span>
            <span>{revision.source.tool}</span>
            <span>· {conversationLabel}</span>
            {shortConversationId && (
              <span title={revision.source.conversationId}>· ID {shortConversationId}…</span>
            )}
          </div>
          {revision.changeNote && (
            <p className="mt-1 text-xs">变更：{revision.changeNote}</p>
          )}
          <details className="mt-1">
            <summary className="text-muted-foreground cursor-pointer text-xs">查看本版全文</summary>
            <div className="mt-2 space-y-2 text-sm">
              <section>
                <h4 className="text-xs font-semibold">结论/决策</h4>
                <p className="whitespace-pre-wrap">{revision.decision}</p>
              </section>
              {revision.data && (
                <section>
                  <h4 className="text-xs font-semibold">关键数据</h4>
                  <p className="whitespace-pre-wrap">{revision.data}</p>
                </section>
              )}
              {revision.openItems && (
                <section>
                  <h4 className="text-xs font-semibold">待办/未决</h4>
                  <p className="whitespace-pre-wrap">{revision.openItems}</p>
                </section>
              )}
              {revision.codeRefs?.length ? (
                <section>
                  <h4 className="text-xs font-semibold">代码/文件位置</h4>
                  <ul className="font-mono text-xs">
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
