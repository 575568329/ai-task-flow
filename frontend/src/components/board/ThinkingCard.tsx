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
  return (
    <div className="border-border bg-muted/30 rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hover:bg-muted/50 flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs text-muted-foreground"
      >
        <Brain className="size-3.5" />
        <span>思考</span>
        <ChevronDown
          className={cn('ml-auto size-3.5 transition-transform', open && 'rotate-180')}
        />
      </button>
      <Collapse open={open}>
        <div className="text-muted-foreground border-t px-2 py-2 text-xs whitespace-pre-wrap">
          {thinking}
        </div>
      </Collapse>
    </div>
  );
}
