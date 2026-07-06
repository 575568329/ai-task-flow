// frontend/src/components/chat/SourceList.tsx
// assistant 消息的引用来源列表(消息正文 [n] 标记对应此处编号)。
import type { Source, SourceType } from '@ai-task-flow/shared';

interface SourceListProps {
  sources: Source[];
}

const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  arxiv: '论文',
  web: '网页',
};

export function SourceList({ sources }: SourceListProps) {
  if (sources.length === 0) return null;

  return (
    <div className="mt-3 flex flex-col gap-1 border-t pt-2">
      <div className="text-muted-foreground text-xs font-medium">来源</div>
      {sources.map((source) => (
        <a
          key={source.index}
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:bg-muted flex gap-2 rounded p-1 transition-colors"
        >
          <span className="bg-primary/10 text-primary size-4 shrink-0 rounded text-center text-[10px] leading-4">
            {source.index}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <span className="truncate text-xs font-medium">{source.title}</span>
              <span className="text-muted-foreground shrink-0 text-[10px]">
                {SOURCE_TYPE_LABEL[source.sourceType]}
              </span>
            </div>
            <div className="text-muted-foreground truncate text-[10px]">{source.url}</div>
          </div>
        </a>
      ))}
    </div>
  );
}
