// frontend/src/components/ui/multi-select.tsx
// 轻量可搜索多选下拉(项目无 cmdk,自建避免重依赖)。
// 触发器显示已选数;下拉内 input 过滤 + checkbox 列表;点击外部关闭。
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface MultiSelectProps {
  options: string[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  /** 选项展示文案(默认原值),搜索也按展示文案匹配 */
  formatOption?: (option: string) => string;
  /** 「已选 N 个 X」里的单位名词,默认「标签」 */
  noun?: string;
  ariaLabel?: string;
  className?: string;
}

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = '选择…',
  formatOption = (option) => option,
  noun = '标签',
  ariaLabel,
  className,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // 点击外部关闭下拉
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const needle = query.trim().toLowerCase();
  const filtered = options.filter((o) => formatOption(o).toLowerCase().includes(needle));
  const toggle = (opt: string) => {
    onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);
  };

  return (
    <div ref={ref} className={cn('relative', className)}>
      <Button
        type="button"
        variant="outline"
        className="h-8 w-full justify-between font-normal"
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={cn('truncate', value.length === 0 && 'text-muted-foreground')}>
          {value.length === 0 ? placeholder : `已选 ${value.length} 个${noun}`}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {value.length > 0 && (
            <X
              className="text-muted-foreground hover:text-foreground size-3.5"
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
              }}
            />
          )}
          <ChevronDown
            className={cn('text-muted-foreground size-3.5 transition-transform duration-200', open && 'rotate-180')}
          />
        </span>
      </Button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="bg-popover text-popover-foreground absolute z-50 mt-1 flex w-full flex-col gap-1 rounded-md border p-1 shadow-md"
          >
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`搜索${noun}…`}
              className="h-7"
              autoFocus
            />
            <ScrollArea className="max-h-48">
              {filtered.length === 0 ? (
                <div className="text-muted-foreground p-2 text-xs">无匹配项</div>
              ) : (
                <div className="flex flex-col">
                  {filtered.map((opt) => {
                    const checked = value.includes(opt);
                    return (
                      <button
                        type="button"
                        key={opt}
                        className="hover:bg-accent flex items-center gap-2 rounded px-2 py-1 text-left text-sm"
                        onClick={() => toggle(opt)}
                      >
                        <span
                          className={cn(
                            'flex size-4 shrink-0 items-center justify-center rounded-[3px] border',
                            checked
                              ? 'bg-primary border-primary text-primary-foreground'
                              : 'border-input',
                          )}
                        >
                          {checked && <Check className="size-3" />}
                        </span>
                        <span className="truncate">{formatOption(opt)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
