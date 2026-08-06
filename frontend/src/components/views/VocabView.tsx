// frontend/src/components/views/VocabView.tsx
// 翻译生词本:左栏划词翻译,右栏生词本列表 + 有道导入 + 墨墨同步(云词本/学习计划)+ 学习进度。
// 宽屏(md+)左右分栏(左栏 w-96 录入,右栏列表占满);窄屏回退上下。
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Loader2, Search, Volume2, Star, CheckCircle2, Circle, Trash2, Save,
  ChevronLeft, ChevronRight, Upload, Cloud, CircleDashed, AlertCircle,
  RotateCw, GraduationCap, ChevronDown,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useConfirm } from '@/components/ui/confirm';
import { useVocabStore } from '@/stores/vocabStore';
import { useMaimemoStore } from '@/stores/maimemoStore';
import { useUIStore } from '@/stores/uiStore';
import { speak, isSpeechSupported } from '@/lib/speech';
import { cn } from '@/lib/utils';
import type { VocabDTO, TranslateResponse, StudySyncStatus, MaimemoWordStudyRecord } from '@ai-task-flow/shared';

const PAGE_SIZE = 50;

export function VocabView() {
  const {
    items, total, loading, translating, lastTranslate, query, importing, importResult,
    translate, fetchList, setQuery, saveFromTranslate, toggleStar, toggleMastered, remove,
    importYoudaoBin, clearImportResult,
  } = useVocabStore();

  // 墨墨配置 + 进度
  const maimemoConfig = useMaimemoStore((s) => s.config);
  const fetchMaimemoConfig = useMaimemoStore((s) => s.fetchConfig);
  const progress = useMaimemoStore((s) => s.progress);
  const loadingProgress = useMaimemoStore((s) => s.loadingProgress);
  const fetchProgress = useMaimemoStore((s) => s.fetchProgress);
  const syncingNotepad = useMaimemoStore((s) => s.syncingNotepad);
  const syncingStudy = useMaimemoStore((s) => s.syncingStudy);
  const syncNotepad = useMaimemoStore((s) => s.syncNotepad);
  const syncStudy = useMaimemoStore((s) => s.syncStudy);
  const openSettings = useUIStore((s) => s.openSettings);

  const [input, setInput] = useState('');
  const [localKw, setLocalKw] = useState(query.kw ?? '');
  const { confirm } = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const maimemoReady = !!maimemoConfig?.tokenSet;
  const anySyncing = syncingNotepad || syncingStudy;

  // 列表:挂载 + 筛选/分页变化时拉取
  useEffect(() => {
    void fetchList();
  }, [fetchList, query.kw, query.mastered, query.starred, query.studySyncStatus, query.page]);

  // 墨墨配置:挂载时拉一次
  useEffect(() => {
    void fetchMaimemoConfig();
  }, [fetchMaimemoConfig]);

  // 配置就绪后拉一次进度(仅一次,后续手动刷新)
  useEffect(() => {
    if (maimemoReady) void fetchProgress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maimemoReady]);

  const handleTranslate = async () => {
    if (!input.trim()) return;
    await translate(input);
  };

  const handleSearch = (kw: string) => {
    setLocalKw(kw);
    setQuery({ kw: kw.trim() || undefined });
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    await importYoudaoBin(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSyncStudy = async () => {
    const result = await syncStudy();
    if (result) {
      await fetchList(); // 刷新徽章状态
      if (result.synced > 0) void fetchProgress(true);
    }
  };

  const handleSyncNotepad = async () => {
    const ok = await confirm({
      description: `将用本地 ${total} 个生词覆盖墨墨云词本当前内容，墨墨侧的修改会丢失，是否继续？`,
      confirmText: '覆盖同步',
      variant: 'destructive',
    });
    if (!ok) return;
    await syncNotepad();
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
        {/* 墨墨进度 strip（仅已配置时显示，一行非卡片） */}
        {maimemoReady && (
          <MaimemoStrip
            local={progress?.local}
            account={progress?.accountLevel}
            loading={loadingProgress}
            onRefresh={() => void fetchProgress(true)}
          />
        )}

        {/* 工具栏 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">生词本</span>
          <Badge variant="secondary">{total}</Badge>

          {/* 同步组：未配置 → 连接墨墨；已配置 → 学习计划(主) + 云词本(次) */}
          <div className="ml-2 flex items-center gap-1.5 border-l pl-2">
            {maimemoReady ? (
              <>
                <Button
                  size="sm"
                  onClick={() => void handleSyncStudy()}
                  disabled={anySyncing}
                  title="查询墨墨单词 ID 后加入复习队列（逐词，较慢）"
                >
                  {syncingStudy ? <Loader2 className="size-4 animate-spin" /> : <GraduationCap className="size-4" />}
                  加入学习计划
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleSyncNotepad()}
                  disabled={anySyncing}
                  title="全量写入墨墨云词本（覆盖，用于备份/手动挑词）"
                >
                  {syncingNotepad ? <Loader2 className="size-4 animate-spin" /> : <Cloud className="size-4" />}
                  同步云词本
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => openSettings('maimemo')}>
                <Cloud className="size-4" /> 连接墨墨
              </Button>
            )}
          </div>

          {/* 导入按钮（直接触发系统文件选择器） */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            title="导入有道翻译导出的 .bin 生词本"
          >
            {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            导入
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".bin"
            className="hidden"
            onChange={(e) => void handleImportFile(e.target.files?.[0])}
          />

          <div className="relative ml-auto">
            <Search className="text-muted-foreground absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
            <Input
              value={localKw}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="搜索单词或译文"
              className="h-8 w-44 pl-7 text-xs"
            />
          </div>
        </div>

        {/* 筛选片 + 同步状态 Select */}
        <div className="flex flex-wrap items-center gap-1">
          <FilterChip active={query.mastered === undefined} onClick={() => setQuery({ mastered: undefined })}>全部</FilterChip>
          <FilterChip active={query.mastered === false} onClick={() => setQuery({ mastered: false })}>未掌握</FilterChip>
          <FilterChip active={query.mastered === true} onClick={() => setQuery({ mastered: true })}>已掌握</FilterChip>
          <span className="text-muted-foreground mx-1 text-xs">·</span>
          <FilterChip active={query.starred === true} onClick={() => setQuery({ starred: query.starred ? undefined : true })}>
            <Star className="size-3" /> 仅收藏
          </FilterChip>
          {maimemoReady && (
            <Select
              value={query.studySyncStatus ?? 'all'}
              onValueChange={(v) => setQuery({ studySyncStatus: v === 'all' ? undefined : (v as StudySyncStatus) })}
            >
              <SelectTrigger size="sm" className="ml-1 h-7 w-[120px] text-xs">
                    <SelectValue placeholder="同步状态" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">同步状态：全部</SelectItem>
                    <SelectItem value="pending">待同步</SelectItem>
                    <SelectItem value="syncing">同步中</SelectItem>
                    <SelectItem value="synced">已加入计划</SelectItem>
                    <SelectItem value="failed">失败</SelectItem>
                  </SelectContent>
            </Select>
          )}
        </div>

        {/* 导入结果行内卡 */}
        {importResult && (
          <div className="bg-accent/60 flex items-center gap-2 rounded-md border p-2 text-xs">
            <CheckCircle2 className="size-3.5 text-primary" />
            <span>
              已解析 {importResult.parsed} · 新增 <b>{importResult.added}</b> · 重复 {importResult.duplicates}
              {importResult.skipped > 0 && ` · 跳过 ${importResult.skipped}`}
            </span>
            {importResult.added > 0 && (
              <button
                className="text-primary hover:underline"
                onClick={() => { setQuery({ studySyncStatus: 'pending', page: 1 }); clearImportResult(); }}
              >
                查看待同步 →
              </button>
            )}
            <button className="text-muted-foreground ml-auto hover:text-foreground" onClick={clearImportResult}>✕</button>
          </div>
        )}

        {/* 列表 */}
        <ScrollArea className="min-h-0 flex-1">
          {loading && items.length === 0 ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
              <Loader2 className="size-4 animate-spin" /> 加载中…
            </div>
          ) : items.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center text-sm">
              暂无生词，{maimemoReady ? '点上方「导入」或有道 .bin' : '点「翻译」录入或「导入」有道 .bin'}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 pr-2">
              {items.map((v) => (
                <VocabRow
                  key={v.id}
                  vocab={v}
                  record={progress?.perWord.find(r => r.spelling.toLowerCase() === v.word.toLowerCase())}
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

/** 墨墨学习进度 strip：本地口径一行 + 详情 Popover（账号级标注含其他词库） */
function MaimemoStrip({
  local, account, loading, onRefresh,
}: {
  local?: { added: number; mastered: number; learning: number; notStarted: number };
  account?: { finished: number; total: number; studyTime: number };
  loading: boolean;
  onRefresh: () => void;
}) {
  const added = local?.added ?? 0;
  if (added === 0 && !account) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <GraduationCap className="size-3.5" /> 尚无单词加入学习计划
      </div>
    );
  }
  return (
    <div className="text-muted-foreground flex items-center gap-2 text-xs">
      <GraduationCap className="size-3.5 text-primary" />
      <span className="text-foreground font-medium tabular-nums">{local?.mastered ?? 0}</span>已掌握
      <span>·</span>
      <span className="tabular-nums">{local?.learning ?? 0}</span>学习中
      <span>·</span>
      <span className="tabular-nums">{local?.notStarted ?? 0}</span>未开始
      <span className="text-muted-foreground/70">/ 已加入 {added}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button className="hover:text-foreground ml-1 inline-flex items-center gap-0.5 hover:underline">
            详情 <ChevronDown className="size-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 text-xs" align="start">
          {account && (
            <div className="border-b pb-1.5">
              <div className="text-muted-foreground mb-0.5">今日总体（含其他词库）</div>
              <div className="tabular-nums">已学 {account.finished}/{account.total} · {Math.round(account.studyTime / 60)} 分钟</div>
            </div>
          )}
          <div className="pt-1.5">
            <div className="text-muted-foreground mb-0.5">本应用单词</div>
            <div className="tabular-nums">
              已掌握 {local?.mastered ?? 0} · 学习中 {local?.learning ?? 0} · 未开始 {local?.notStarted ?? 0} / 共 {added}
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <Button size="icon" variant="ghost" className="size-6 ml-auto" onClick={onRefresh} disabled={loading} title="刷新进度">
        {loading ? <Loader2 className="size-3 animate-spin" /> : <RotateCw className="size-3" />}
      </Button>
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

/** 把 ISO 日期转成「今天 / N 天后 / 已到期」的相对描述（用于下次复习提示） */
function formatDaysUntil(iso: string): string {
  const days = Math.floor((Date.parse(iso) - Date.now()) / 86_400_000);
  if (days < 0) return '已到期';
  if (days === 0) return '今天';
  return `${days} 天后`;
}

/** 同步状态徽章图标（无文字，hover title 显示中文） */
function SyncBadge({ status }: { status: StudySyncStatus }) {
  switch (status) {
    case 'syncing':
      return <span title="同步中"><Loader2 className="text-primary size-3.5 animate-spin" /></span>;
    case 'synced':
      return <span title="已加入墨墨学习计划"><GraduationCap className="text-primary size-3.5" /></span>;
    case 'failed':
      return <span title="同步失败"><AlertCircle className="text-destructive size-3.5" /></span>;
    default:
      return <span title="待同步到墨墨"><CircleDashed className="text-muted-foreground size-3.5" /></span>;
  }
}

/** 生词行:单词/译文/例句 + 同步徽章 + 朗读 + 收藏/掌握/删除；已同步词点行展开记忆详情 */
function VocabRow({
  vocab, record, onToggleStar, onToggleMastered, onRemove,
}: {
  vocab: VocabDTO;
  record?: MaimemoWordStudyRecord;
  onToggleStar: () => void;
  onToggleMastered: () => void;
  onRemove: () => void;
}) {
  const support = isSpeechSupported();
  const [expanded, setExpanded] = useState(false);
  const status = vocab.studySyncStatus ?? 'pending';
  const hasDetail = status === 'synced' && !!record;

  return (
    <div className="group rounded-md border hover:bg-accent/40">
      <div className="flex items-start gap-2 p-2">
        <div
          className={cn('min-w-0 flex-1', hasDetail && 'cursor-pointer')}
          onClick={() => hasDetail && setExpanded((e) => !e)}
        >
          <div className="flex items-center gap-1.5">
            <span className="font-medium">{vocab.word}</span>
            {vocab.pos && <Badge variant="outline" className="text-[10px]">{vocab.pos}</Badge>}
            <SyncBadge status={status} />
            {hasDetail && <ChevronDown className={cn('text-muted-foreground size-3 transition-transform', expanded && 'rotate-180')} />}
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
      {expanded && hasDetail && record && (
        <div className="text-muted-foreground border-t px-2 py-1.5 text-xs">
          {record.reviewCount !== undefined && <span>累计复习 {record.reviewCount} 次 · </span>}
          {record.lastReviewAt && <span>上次 {new Date(record.lastReviewAt).toLocaleDateString()} · </span>}
          {record.nextReviewAt && <span>下次 {new Date(record.nextReviewAt).toLocaleDateString()}（{formatDaysUntil(record.nextReviewAt)}）</span>}
        </div>
      )}
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
