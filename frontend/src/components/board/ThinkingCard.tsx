// frontend/src/components/board/ThinkingCard.tsx
// Claude thinking block 的折叠卡片:默认收起,点开看全文。
import { useState } from 'react';
import { Brain, ChevronDown } from 'lucide-react';
import { Collapse } from '@/components/ui/collapse';
import { cn } from '@/lib/utils';

interface ThinkingCardProps {
  thinking: string;
}

export function ThinkingCard({ thinking }: ThinkingCardProps) {
  const [open, setOpen] = useState(false);
  const hasContent = thinking.trim().length > 0;
  return (
    <div className="border-border bg-muted/30 rounded-md border" style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 28px', contain: 'layout style paint' }}>
      <button
        type="button"
        onClick={() => hasContent && setOpen((v) => !v)}
        disabled={!hasContent}
        className="hover:bg-muted/50 flex w-full items-center gap-1 px-2 py-0.5 text-left text-[11px] text-muted-foreground disabled:cursor-default"
      >
        <Brain className="size-3" />
        <span>思考</span>
        {hasContent && (
          <ChevronDown
            className={cn('ml-auto size-3 transition-transform', open && 'rotate-180')}
          />
        )}
      </button>
      {hasContent && (
        <Collapse open={open}>
          {/* 仅展开时才 mount:避免 19+ 张卡片同时挂载大段思考文本 */}
          {open && (
            <div className="text-muted-foreground border-t px-2 py-1 text-[11px] whitespace-pre-wrap">
              {thinking}
            </div>
          )}
        </Collapse>
      )}
    </div>
  );
}
