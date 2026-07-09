// frontend/src/components/views/VocabView.tsx
// 翻译生词本:左栏划词翻译(输入→译文→存生词本),右栏生词本列表(搜索/筛选/朗读/CRUD)。
// 宽屏(md+)左右分栏(左栏 w-96 录入,右栏列表占满);窄屏回退上下,移动端可用。
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Loader2, Search, Volume2, Star, CheckCircle2, Circle, Trash2, Save,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useConfirm } from '@/components/ui/confirm';
import { useVocabStore } from '@/stores/vocabStore';
import { speak, isSpeechSupported } from '@/lib/speech';
import { cn } from '@/lib/utils';
import type { VocabDTO, TranslateResponse } from '@ai-task-flow/shared';

const PAGE_SIZE = 50;

export function VocabView() {
  const {
    items, total, loading, translating, lastTranslate, query,
    translate, fetchList, setQuery, saveFromTranslate, toggleStar, toggleMastered, remove,
  } = useVocabStore();

  const [input, setInput] = useState('');
  const [localKw, setLocalKw] = useState(query.kw ?? '');
  const { confirm } = useConfirm();

  // 挂载 + 筛选/分页变化时拉列表（fetchList 是 zustand action，引用稳定）
  useEffect(() => {
    void fetchList();
  }, [fetchList, query.kw, query.mastered, query.starred, query.page]);

  const handleTranslate = async () => {
    if (!input.trim()) return;
    await translate(input);
  };

  const handleSearch = (kw: string) => {
    setLocalKw(kw);
    setQuery({ kw: kw.trim() || undefined });
  };

  const page = query.page ?? 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-4 md:flex-row">
      {/* ===== 翻译区(宽屏左栏 w-96 / 窄屏顶部)===== */}
      <section className="bg-card flex shrink-0 flex-col gap-2 rounded-lg border p-3 md:w-96">
        <div className="flex flex-col gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleTranslate();
              }
            }}
            placeholder="输入要翻译的文本,Enter 翻译(Shift+Enter 换行)"
            className="min-h-[60px] max-h-[160px] resize-y"
          />
          <Button onClick={() => void handleTranslate()} disabled={translating || !input.trim()} className="self-end">
            {translating ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            翻译
          </Button>
        </div>

        {lastTranslate && (
          <TranslateResult data={lastTranslate} onSave={() => void saveFromTranslate()} />
        )}
      </section>

      {/* ===== 生词本列表 ===== */}
      <section className="bg-card flex min-h-0 flex-1 flex-col gap-2 rounded-lg border p-3">
        {/* 工具栏 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">生词本</span>
          <Badge variant="secondary">{total}</Badge>
          <div className="relative ml-auto">
            <Search className="text-muted-foreground absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
            <Input
              value={localKw}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="搜索单词或译文"
              className="h-8 w-48 pl-7 text-xs"
            />
          </div>
        </div>

        {/* 筛选片 */}
        <div className="flex flex-wrap items-center gap-1">
          <FilterChip active={query.mastered === undefined} onClick={() => setQuery({ mastered: undefined })}>全部</FilterChip>
          <FilterChip active={query.mastered === false} onClick={() => setQuery({ mastered: false })}>未掌握</FilterChip>
          <FilterChip active={query.mastered === true} onClick={() => setQuery({ mastered: true })}>已掌握</FilterChip>
          <span className="text-muted-foreground mx-1 text-xs">·</span>
          <FilterChip active={query.starred === true} onClick={() => setQuery({ starred: query.starred ? undefined : true })}>
            <Star className="size-3" /> 仅收藏
          </FilterChip>
        </div>

        {/* 列表 */}
        <ScrollArea className="min-h-0 flex-1">
          {loading && items.length === 0 ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
              <Loader2 className="size-4 animate-spin" /> 加载中…
            </div>
          ) : items.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center text-sm">
              暂无生词,去翻译并收藏吧
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 pr-2">
              {items.map((v) => (
                <VocabRow
                  key={v.id}
                  vocab={v}
                  onToggleStar={() => void toggleStar(v)}
                  onToggleMastered={() => void toggleMastered(v)}
                  onRemove={async () => {
                    if (
                      await confirm({
                        description: `确定删除生词「${v.word}」?`,
                        confirmText: '删除',
                        variant: 'destructive',
                      })
                    ) {
                      void remove(v.id);
                    }
                  }}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        {/* 分页 */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-end gap-2 pt-1 text-sm">
            <span className="text-muted-foreground">第 {page}/{totalPages} 页 · 共 {total}</span>
            <Button size="icon" variant="outline" className="size-7" disabled={page <= 1} onClick={() => setQuery({ page: page - 1 })}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button size="icon" variant="outline" className="size-7" disabled={page >= totalPages} onClick={() => setQuery({ page: page + 1 })}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

/** 翻译结果展示 + 朗读(原文/译文) + 存入生词本 */
function TranslateResult({
  data,
  onSave,
}: {
  data: { text: string; result: TranslateResponse };
  onSave: () => void;
}) {
  const { text, result } = data;
  const support = isSpeechSupported();
  return (
    <div className="bg-background/50 rounded-md border p-2.5 text-sm">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {result.pos && <Badge variant="outline" className="text-[10px]">{result.pos}</Badge>}
            <span className="text-muted-foreground text-xs">{result.sourceLang || '—'} → zh</span>
          </div>
          <p className="mt-1 font-medium leading-relaxed">{result.translation}</p>
          {result.definition && <p className="text-muted-foreground mt-1 text-xs">{result.definition}</p>}
          {result.example && <p className="text-muted-foreground mt-1 text-xs italic">例:{result.example}</p>}
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          {support && (
            <>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => speak(text, result.sourceLang || undefined)}>
                <Volume2 className="size-3.5" /> 原文
              </Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => speak(result.translation, 'zh')}>
                <Volume2 className="size-3.5" /> 译文
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" className="h-7" onClick={onSave}>
            <Save className="size-3.5" /> 存生词本
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 生词行:单词/译文/例句 + 朗读 + 收藏/掌握/删除 */
function VocabRow({
  vocab, onToggleStar, onToggleMastered, onRemove,
}: {
  vocab: VocabDTO;
  onToggleStar: () => void;
  onToggleMastered: () => void;
  onRemove: () => void;
}) {
  const support = isSpeechSupported();
  return (
    <div className="group flex items-start gap-2 rounded-md border p-2 hover:bg-accent/40">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{vocab.word}</span>
          {vocab.pos && <Badge variant="outline" className="text-[10px]">{vocab.pos}</Badge>}
        </div>
        <p className="text-sm">{vocab.translation}</p>
        {vocab.example && <p className="text-muted-foreground text-xs italic">例:{vocab.example}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-60 group-hover:opacity-100">
        {support && (
          <>
            <Button size="icon" variant="ghost" className="size-7" title="朗读原文" onClick={() => speak(vocab.word, vocab.sourceLang || undefined)}>
              <Volume2 className="size-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="size-7" title="朗读译文" onClick={() => speak(vocab.translation, vocab.targetLang)}>
              <Volume2 className="size-3.5 text-primary" />
            </Button>
          </>
        )}
        <Button size="icon" variant="ghost" className="size-7" title={vocab.starred ? '取消收藏' : '收藏'} onClick={onToggleStar}>
          <Star className={cn('size-3.5', vocab.starred && 'text-amber-500 fill-current')} />
        </Button>
        <Button size="icon" variant="ghost" className="size-7" title={vocab.mastered ? '取消掌握' : '标记掌握'} onClick={onToggleMastered}>
          {vocab.mastered ? <CheckCircle2 className="size-3.5 text-green-500" /> : <Circle className="size-3.5" />}
        </Button>
        <Button size="icon" variant="ghost" className="hover:text-destructive size-7" title="删除" onClick={onRemove}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

/** 筛选片(按钮式 toggle) */
function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors',
        active ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
