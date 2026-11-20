// 统一搜索框:左图标 + 可清空,Esc 清空。工作记录与结论共用。
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel?: string;
  className?: string;
}

export function SearchInput({ value, onChange, placeholder, ariaLabel, className }: Props) {
  return (
    <div className={cn('relative', className)}>
      <Search className="text-muted-foreground pointer-events-none absolute top-2 left-2.5 size-4" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') onChange(''); }}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-md border pr-8 pl-8 text-sm outline-none focus-visible:ring-[3px]"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          title="清空搜索"
          className="text-muted-foreground hover:text-foreground absolute top-1.5 right-2"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
