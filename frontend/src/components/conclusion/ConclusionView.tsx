import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Conclusion, ConclusionSummary } from '@ai-task-flow/shared';
import { Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';
import { useUIStore } from '@/stores/uiStore';
import { conclusionApi } from '@/api/conclusion';
import { worklogApi } from '@/api/worklog';
import { ConclusionProjectList } from './ConclusionProjectList';
import { ConclusionCardItem } from './ConclusionCardItem';
import { ConclusionForm, type ConclusionFormValue } from './ConclusionForm';
import { ConclusionMetaForm, type ConclusionMetaValue } from './ConclusionMetaForm';
import { WorkStageMultiSelect } from '@/components/common/WorkStageMultiSelect';
import { SearchInput } from '@/components/common/SearchInput';
import { WorkspaceLayout, WorkspaceSidebar, WorkspaceToolbar } from '@/components/layout/WorkspaceLayout';
import type { StageFilter } from '@/lib/workStage';
import {
  filterConclusions,
  filterConclusionsByRelatedProject,
  filterConclusionsByStage,
  type ConclusionSelection,
} from './searchFilter';

const errMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** 项目 id → 最新名称映射;ready 区分「树已成功加载」与「尚未加载/加载失败」 */
interface ProjectIndex {
  names: Map<string, string>;
  ready: boolean;
}

/** 关联项目展示名:id 映射最新名优先,映射不到退回名称快照;两者都无则跳过 */
function resolveRelatedLabels(
  card: { relatedProjects?: string[]; relatedProjectIds?: string[] },
  names: Map<string, string>,
): string[] {
  const ids = card.relatedProjectIds ?? [];
  const snapshots = card.relatedProjects ?? [];
  const labels: string[] = [];
  for (let index = 0; index < Math.max(ids.length, snapshots.length); index += 1) {
    const id = ids[index];
    const label = (id ? names.get(id) : undefined) ?? snapshots[index];
    if (label) labels.push(label);
  }
  return labels;
}

/**
 * 展示口径卡片:主项目名/关联项目名按 id 映射覆盖为最新名(未命中保持快照)。
 * 侧栏分组、筛选与卡片展示必须共用这一份,否则项目改名后卡片显示新名、侧栏仍挂旧名。
 */
function mapCardNames(card: ConclusionSummary, names: Map<string, string>): ConclusionSummary {
  const project = (card.projectId ? names.get(card.projectId) : undefined) ?? card.project;
  const projectChanged = project !== card.project;
  const related = resolveRelatedLabels(card, names);
  const snapshots = card.relatedProjects ?? [];
  const relatedChanged = related.length > 0
    && (related.length !== snapshots.length || related.some((name, index) => name !== snapshots[index]));
  if (!projectChanged && !relatedChanged) return card;
  return {
    ...card,
    ...(projectChanged ? { project } : {}),
    ...(relatedChanged ? { relatedProjects: related } : {}),
  };
}

export function ConclusionView() {
  const [cards, setCards] = useState<ConclusionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  // 默认不加载全部:数据量大时一次性渲染所有卡片会卡,先让用户选项目或搜索
  const [selection, setSelection] = useState<ConclusionSelection | null>(null);
  const [keyword, setKeyword] = useState('');
  const [stageFilter, setStageFilter] = useState<StageFilter>([]);
  const [relatedFilter, setRelatedFilter] = useState('');
  const [searchResults, setSearchResults] = useState<ConclusionSummary[] | null>(null);
  /** 写操作/刷新后自增:让带关键词的搜索结果重新拉取,避免列表已更新、搜索仍是旧快照 */
  const [searchTick, setSearchTick] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Conclusion | null>(null);
  const [form, setForm] = useState<{ mode: 'create' | 'append'; initial?: Conclusion } | null>(null);
  const [metaForm, setMetaForm] = useState<Conclusion | null>(null);
  /** 项目 id → 名称映射,仅用于展示;加载失败静默,退回卡上名称快照 */
  const [projectIndex, setProjectIndex] = useState<ProjectIndex>({ names: new Map(), ready: false });
  const seq = useRef(0);
  /** 搜索请求归属序号:慢的旧关键词响应不得覆盖新关键词的结果 */
  const searchSeq = useRef(0);
  /** 详情请求归属序号:只允许最新一次展开/收起的响应落盘(否则 A 的慢响应会盖掉 B 的详情) */
  const detailSeq = useRef(0);

  /** 拉项目树重建 id → 名称映射:项目重命名/删除后卡片展示随之刷新;失败静默保留旧映射 */
  const loadProjectNames = useCallback(async () => {
    try {
      const tree = await worklogApi.getTree();
      const names = new Map<string, string>();
      for (const project of tree.projects) names.set(project.id, project.name);
      setProjectIndex({ names, ready: true });
    } catch {
      // 映射只是展示增强:失败时保持原状,卡片退回名称快照
    }
  }, []);

  const refresh = useCallback(async () => {
    const current = ++seq.current;
    // 列表重拉成功与否都让在途搜索失效并重查:删除/追加后旧搜索结果会残留(已删卡点击 404)
    setSearchTick((tick) => tick + 1);
    // 每次刷新顺带重建项目名映射(挂载时 refresh 会执行一次)
    void loadProjectNames();
    try {
      const res = await conclusionApi.list();
      if (current !== seq.current) return;
      setCards(res.conclusions);
    } catch {
      toast.error('结论卡加载失败，请确认后端已启动');
    } finally {
      if (current === seq.current) setLoading(false);
    }
  }, [loadProjectNames]);

  useEffect(() => { void refresh(); }, [refresh]);

  const enterTick = useUIStore((s) => s.viewEnterTick?.conclusion ?? 0);
  useEffect(() => {
    if (enterTick > 0) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 打点变化即意图
  }, [enterTick]);

  useEffect(() => {
    // 每次关键词变化或列表刷新都领取新序号;旧响应回来时序号已过期 → 丢弃
    const current = ++searchSeq.current;
    const text = keyword.trim();
    if (!text) {
      setSearchResults(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void conclusionApi.list({ keyword: text })
        .then((res) => {
          if (current === searchSeq.current) setSearchResults(res.conclusions);
        })
        .catch(() => {
          if (current === searchSeq.current) toast.error('搜索失败');
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [keyword, searchTick]);

  /** 展示口径:侧栏分组/筛选/卡片渲染统一用映射后的卡片,项目改名后各处同步刷新 */
  const displayCards = useMemo(
    () => cards.map((card) => mapCardNames(card, projectIndex.names)),
    [cards, projectIndex.names],
  );
  const displaySearchResults = useMemo(
    () => (searchResults ? searchResults.map((card) => mapCardNames(card, projectIndex.names)) : null),
    [searchResults, projectIndex.names],
  );

  const visible = useMemo(() => {
    if (displaySearchResults) {
      return filterConclusionsByRelatedProject(
        filterConclusionsByStage(displaySearchResults, stageFilter),
        relatedFilter,
      );
    }
    if (!selection) return [];
    return filterConclusionsByRelatedProject(
      filterConclusionsByStage(filterConclusions(displayCards, selection), stageFilter),
      relatedFilter,
    );
  }, [displaySearchResults, displayCards, selection, stageFilter, relatedFilter]);

  // 「关联项目」下拉选项:展示口径卡片的 relatedProjects 去重(与筛选口径一致)
  const relatedProjectOptions = useMemo(() => {
    const names = new Set<string>();
    for (const card of displayCards) {
      for (const name of card.relatedProjects ?? []) {
        if (name) names.add(name);
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [displayCards]);

  // 数据刷新后所选关联项目不存在(如关联被清理)则回退为不过滤
  useEffect(() => {
    if (relatedFilter && !relatedProjectOptions.includes(relatedFilter)) setRelatedFilter('');
  }, [relatedFilter, relatedProjectOptions]);
  const projects = useMemo(
    () => [...new Set(cards.filter((c) => c.scope === 'project').map((c) => c.project ?? '未归类'))],
    [cards],
  );

  /** 主项目展示名:有 id 且映射命中用最新名,否则退回快照;树已加载却查不到 = 项目已删除 */
  const resolveMainProject = (summary: ConclusionSummary): { label?: string; deleted: boolean } => {
    if (!summary.projectId) return { label: summary.project, deleted: false };
    const mapped = projectIndex.names.get(summary.projectId);
    if (mapped) return { label: mapped, deleted: false };
    return { label: summary.project, deleted: projectIndex.ready };
  };

  /** 关联项目展示名:按 id 映射最新名称,映射不到退回名称快照;两者都无则跳过 */
  const resolveRelatedProjects = (
    card: { relatedProjects?: string[]; relatedProjectIds?: string[] },
  ): string[] => resolveRelatedLabels(card, projectIndex.names);

  const toggle = async (summary: ConclusionSummary) => {
    const current = ++detailSeq.current;
    if (expandedId === summary.id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(summary.id);
    setDetail(null);
    try {
      const full = await conclusionApi.get(summary.id);
      // 归属守卫:期间又点了别的卡片(或收起),本次响应作废,避免 A 的详情落到 B 名下
      if (current === detailSeq.current) setDetail(full);
    } catch (err) {
      if (current === detailSeq.current) toast.error(`读取详情失败：${errMessage(err)}`);
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
          relatedProjects: value.relatedProjects,
          changeNote: value.changeNote ?? '人工修订',
          stage: value.stage,
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
          relatedProjects: value.relatedProjects,
          stage: value.stage,
        });
        toast.success('已创建结论卡');
      }
      // 新建后切到该卡所在分组:默认空态下不切过去就看不到刚建的卡
      if (form?.mode !== 'append') {
        if (value.scope === 'personal') setSelection({ type: 'personal' });
        else if (value.project) setSelection({ type: 'project', project: value.project });
        else setSelection({ type: 'all' });
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
      // 仅当它仍是当前展开卡时才回填详情(表单打开期间用户可能已展开别的卡)
      if (metaForm.id === expandedId) setDetail(full);
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
    <WorkspaceLayout
      sidebar={(
        <WorkspaceSidebar
          title="结论"
          actions={(
            <Button variant="ghost" size="sm" className="size-7 p-0" title="刷新" onClick={() => void refresh()}>
              <RefreshCw className="size-3.5" />
            </Button>
          )}
          footer={(
            <p className="text-muted-foreground text-[10px] leading-relaxed">
              删除前自动备份到 ~/.ai-task-flow/conclusion-backups/
            </p>
          )}
        >
          <ConclusionProjectList cards={displayCards} selection={selection} onSelect={setSelection} />
        </WorkspaceSidebar>
      )}
      toolbar={(
        <WorkspaceToolbar
          search={(
            <SearchInput
              value={keyword}
              onChange={setKeyword}
              placeholder="搜索标题/历史结论…"
              ariaLabel="搜索结论卡"
            />
          )}
          title={
            searchResults
              ? `搜索结果 · ${searchResults.length}`
              : selection
                ? `${visible.length} 张结论卡`
                : '结论'
          }
          actions={(
            <>
              {relatedProjectOptions.length > 0 && (
                <select
                  aria-label="按关联项目筛选结论卡"
                  title="只看关联了指定项目的结论卡"
                  value={relatedFilter}
                  onChange={(e) => setRelatedFilter(e.target.value)}
                  className="border-input bg-background h-8 shrink-0 rounded-md border px-2 text-xs"
                >
                  <option value="">全部关联项目</option>
                  {relatedProjectOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              )}
              <WorkStageMultiSelect
                value={stageFilter}
                onChange={setStageFilter}
                ariaLabel="按阶段筛选结论卡"
                className="w-36"
              />
              <Button
                size="sm"
                className="h-8 shrink-0 px-3 text-xs"
                onClick={() => setForm({ mode: 'create' })}
              >
                <Plus className="size-3.5" />新建结论
              </Button>
            </>
          )}
        />
      )}
    >
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
          !selection && !searchResults ? (
            <div className="text-muted-foreground py-12 text-center text-sm">
              <p>数据量较大，默认不加载全部。请在左侧选择项目，或搜索标题/结论。</p>
              <p className="text-muted-foreground mt-2 text-xs">
                结论卡按会话归档，路径只用于展示；按项目路径归属的是工作记录。
              </p>
            </div>
          ) : (
            <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-sm leading-relaxed">
              <p className="font-medium">还没有结论卡。</p>
              <p className="mt-2">让 AI 记录时，可以直接说：</p>
              <pre className="bg-muted mt-2 rounded p-2 text-xs whitespace-pre-wrap">
                {`把刚才的结论记到 ai-task-flow，项目 ${projects[0] ?? '<项目名>'}：
结论、关键数据、待办、涉及文件`}
              </pre>
              <p className="text-muted-foreground mt-2 text-xs">
                结论卡按会话归档，路径只用于展示；按项目路径归属的是工作记录。
              </p>
            </div>
          )
        )}

        {visible.map((summary) => {
          // 纵深防御:详情必须同时"属于当前展开卡"且 id 对齐,陈旧对象绝不驱动编辑/改信息
          const activeDetail =
            expandedId === summary.id && detail?.id === summary.id ? detail : undefined;
          const mainProject = resolveMainProject(summary);
          return (
            <ConclusionCardItem
              key={summary.id}
              summary={summary}
              expanded={expandedId === summary.id}
              projectLabel={mainProject.label}
              projectDeleted={mainProject.deleted}
              relatedProjectLabels={resolveRelatedProjects(summary)}
              detail={activeDetail}
              onRelatedClick={setRelatedFilter}
              onToggle={() => void toggle(summary)}
              onEdit={() => {
                if (activeDetail) {
                  // 主项目/关联项目都预填映射后的最新名:项目改名后按旧快照提交会解析不到 id,
                  // 后端回退 projectId:'' 把引用清空且 warnings 前端不展示,用户无感知。
                  setForm({
                    mode: 'append',
                    initial: {
                      ...activeDetail,
                      project: mainProject.label ?? activeDetail.project,
                      relatedProjects: resolveRelatedProjects(activeDetail),
                    },
                  });
                }
              }}
              onPatch={() => {
                if (activeDetail) {
                  setMetaForm({
                    ...activeDetail,
                    project: mainProject.label ?? activeDetail.project,
                  });
                }
              }}
              onDelete={() => void remove(summary)}
            />
          );
        })}
      </div>
    </WorkspaceLayout>
  );
}
