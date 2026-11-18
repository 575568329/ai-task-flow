import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Conclusion, ConclusionSummary } from '@ai-task-flow/shared';
import { Plus, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { useUIStore } from '@/stores/uiStore';
import { conclusionApi } from '@/api/conclusion';
import { ConclusionProjectList } from './ConclusionProjectList';
import { ConclusionCardItem } from './ConclusionCardItem';
import { ConclusionForm, type ConclusionFormValue } from './ConclusionForm';
import { ConclusionMetaForm, type ConclusionMetaValue } from './ConclusionMetaForm';
import { filterConclusions, type ConclusionSelection } from './searchFilter';

const errMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function ConclusionView() {
  const [cards, setCards] = useState<ConclusionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<ConclusionSelection>({ type: 'all' });
  const [keyword, setKeyword] = useState('');
  const [searchResults, setSearchResults] = useState<ConclusionSummary[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Conclusion | null>(null);
  const [form, setForm] = useState<{ mode: 'create' | 'append'; initial?: Conclusion } | null>(null);
  const [metaForm, setMetaForm] = useState<Conclusion | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const current = ++seq.current;
    try {
      const res = await conclusionApi.list();
      if (current !== seq.current) return;
      setCards(res.conclusions);
    } catch {
      toast.error('结论卡加载失败，请确认后端已启动');
    } finally {
      if (current === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const enterTick = useUIStore((s) => s.viewEnterTick?.conclusion ?? 0);
  useEffect(() => {
    if (enterTick > 0) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 打点变化即意图
  }, [enterTick]);

  useEffect(() => {
    const text = keyword.trim();
    if (!text) {
      setSearchResults(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void conclusionApi.list({ keyword: text })
        .then((res) => setSearchResults(res.conclusions))
        .catch(() => toast.error('搜索失败'));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  const visible = useMemo(
    () => searchResults ?? filterConclusions(cards, selection),
    [searchResults, cards, selection],
  );
  const projects = useMemo(
    () => [...new Set(cards.filter((c) => c.scope === 'project').map((c) => c.project ?? '未归类'))],
    [cards],
  );

  const toggle = async (summary: ConclusionSummary) => {
    if (expandedId === summary.id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(summary.id);
    setDetail(null);
    try {
      const full = await conclusionApi.get(summary.id);
      setDetail(full);
    } catch (err) {
      toast.error(`读取详情失败：${errMessage(err)}`);
    }
  };

  const submit = async (value: ConclusionFormValue) => {
    try {
      if (form?.mode === 'append' && form.initial) {
        await conclusionApi.append(form.initial.id, {
          expectedRev: value.expectedRev,
          scope: value.scope,
          project: value.project,
          version: value.version,
          title: value.title,
          tags: value.tags,
          decision: value.decision,
          data: value.data,
          openItems: value.openItems,
          codeRefs: value.codeRefs,
          changeNote: value.changeNote ?? '人工修订',
        });
        toast.success('已追加新版');
      } else {
        await conclusionApi.create({
          scope: value.scope,
          project: value.project,
          version: value.version,
          title: value.title,
          tags: value.tags,
          decision: value.decision,
          data: value.data,
          openItems: value.openItems,
          codeRefs: value.codeRefs,
        });
        toast.success('已创建结论卡');
      }
      setForm(null);
      setExpandedId(null);
      setDetail(null);
      await refresh();
    } catch (err) {
      toast.error(`保存失败：${errMessage(err)}`);
    }
  };

  const patchMeta = async (value: ConclusionMetaValue) => {
    if (!metaForm) return;
    try {
      await conclusionApi.patch(metaForm.id, value);
      const full = await conclusionApi.get(metaForm.id);
      setMetaForm(null);
      setDetail(full);
      await refresh();
      toast.success('信息已更新');
    } catch (err) {
      toast.error(`更新信息失败：${errMessage(err)}`);
    }
  };

  const remove = async (summary: ConclusionSummary) => {
    if (!window.confirm(`删除「${summary.title}」？删除前会自动备份。`)) return;
    try {
      await conclusionApi.remove(summary.id);
      if (expandedId === summary.id) {
        setExpandedId(null);
        setDetail(null);
      }
      await refresh();
      toast.success('已删除（删除前已自动备份）');
    } catch (err) {
      toast.error(`删除失败：${errMessage(err)}`);
    }
  };

  if (loading) {
    return <div className="text-muted-foreground flex h-full items-center justify-center text-sm">加载结论卡…</div>;
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r @2xl:w-64">
        <div className="flex items-center gap-1 border-b px-3 py-2">
          <span className="flex-1 text-sm font-semibold">结论</span>
          <Button variant="ghost" size="sm" className="size-7 p-0" title="刷新" onClick={() => void refresh()}>
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
        <div className="border-b p-2">
          <div className="relative">
            <Search className="text-muted-foreground absolute top-2.5 left-2 size-3.5" />
            <Input
              className="h-8 pl-7 text-xs"
              placeholder="搜索标题/历史结论…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <ConclusionProjectList cards={cards} selection={selection} onSelect={setSelection} />
        </div>
        <p className="text-muted-foreground border-t p-2 text-[10px] leading-relaxed">
          删除前自动备份到 ~/.ai-task-flow/conclusion-backups/
        </p>
      </aside>

      <section className="flex-1 overflow-y-auto">
        <div className="flex items-center gap-2 border-b px-4 py-2">
          <span className="flex-1 text-sm font-semibold">
            {searchResults ? `搜索结果 · ${searchResults.length}` : `${visible.length} 张结论卡`}
          </span>
          <Button size="sm" onClick={() => setForm({ mode: 'create' })}>
            <Plus className="mr-1 size-3.5" />新建结论
          </Button>
        </div>

        <div className="space-y-3 p-4">
          {form && (
            <ConclusionForm
              mode={form.mode}
              initial={form.initial}
              projects={projects}
              onSubmit={submit}
              onCancel={() => setForm(null)}
            />
          )}

          {metaForm && (
            <ConclusionMetaForm
              initial={metaForm}
              projects={projects}
              onSubmit={patchMeta}
              onCancel={() => setMetaForm(null)}
            />
          )}

          {visible.length === 0 && !form && (
            <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-sm leading-relaxed">
              <p className="font-medium">还没有结论卡。</p>
              <p className="mt-2">让 AI 记录时，可以直接说：</p>
              <pre className="bg-muted mt-2 rounded p-2 text-xs whitespace-pre-wrap">
                {`把刚才的结论记到 ai-task-flow，项目 ${projects[0] ?? '<项目名>'}：
结论、关键数据、待办、涉及文件`}
              </pre>
            </div>
          )}

          {visible.map((summary) => (
            <ConclusionCardItem
              key={summary.id}
              summary={summary}
              expanded={expandedId === summary.id}
              detail={expandedId === summary.id ? detail ?? undefined : undefined}
              onToggle={() => void toggle(summary)}
              onEdit={() => {
                if (detail && expandedId === summary.id) {
                  setForm({ mode: 'append', initial: detail });
                }
              }}
              onPatch={() => {
                if (detail && expandedId === summary.id) setMetaForm(detail);
              }}
              onDelete={() => void remove(summary)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
