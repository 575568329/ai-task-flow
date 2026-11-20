// frontend/src/components/worklog/WorklogView.tsx
// 工作记录页(应用默认落地视图):左栏项目/版本树 + 右栏条目流。
// 数据局部 state(单一树,能局部不全局);每次操作后重拉全树(读不缓存,与后端锁协议一致)。
// 审阅修复:refresh 竞态序号守卫/selection 随重命名删除跟随/视图激活静默重拉/
// 挪版本列表按条目所属项目传入/错误提示统一收口(不再双重 toast)。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, RefreshCw, BookOpenText, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';
import { useUIStore } from '@/stores/uiStore';
import { worklogApi } from '@/api/worklog';
import type { WorklogData, WorkStage } from '@ai-task-flow/shared';
import { ProjectVersionTree, type TreeSelection } from './ProjectVersionTree';
import { EntryItem } from './EntryItem';
import { NewEntryForm } from './NewEntryForm';
import { AiGuideView } from './AiGuideView';
import { WorkStageMultiSelect } from '@/components/common/WorkStageMultiSelect';
import type { StageFilter } from '@/lib/workStage';
import { filterEntries } from './searchFilter';

const errMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function WorklogView() {
  const [data, setData] = useState<WorklogData>({ projects: [] });
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selection, setSelection] = useState<TreeSelection>({});
  const [mode, setMode] = useState<'entries' | 'guide'>('entries');
  const [creating, setCreating] = useState(false);
  const [keyword, setKeyword] = useState(''); // 全局模糊搜索(标题/详情/文件路径)
  const [stageFilter, setStageFilter] = useState<StageFilter>([]);
  const [expandAll, setExpandAll] = useState<boolean | null>(null);

  /** 竞态守卫:只有最新一次 refresh 的响应可以落盘(慢的旧响应丢弃) */
  const refreshSeq = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current;
    try {
      const tree = await worklogApi.getTree();
      if (seq !== refreshSeq.current) return; // 已有更新的请求在途,丢弃本次
      setData(tree);
      setLoadFailed(false);
      // selection 跟随数据:指向的项目/版本不存在(被改名/删除)则回退
      setSelection((prev) => {
        if (!prev.project) return prev;
        const proj = tree.projects.find((p) => p.name === prev.project);
        if (!proj) return {};
        if (prev.version && !proj.versions.some((v) => v.name === prev.version)) {
          return { project: prev.project };
        }
        return prev;
      });
    } catch {
      if (seq !== refreshSeq.current) return;
      setLoadFailed(true); // 拉取失败保留现有数据,空态文案据此切换(不误导为"没有记录")
      toast.error('工作记录加载失败,请确认后端已启动');
    } finally {
      if (seq === refreshSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // keep-alive 视图激活打点:切回本视图时静默重拉(AI 刚经 MCP 记的条目即见,无需手动刷新)
  const worklogEnterTick = useUIStore((s) => s.viewEnterTick?.worklog ?? 0);
  useEffect(() => {
    if (worklogEnterTick > 0) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 打点变化即意图
  }, [worklogEnterTick]);

  // 可见条目:keyword 非空 → 全局搜索(忽略树选择);否则按树选择过滤。新在前。
  // 本地过滤(全树已在内存,个人量级零延迟),匹配语义与后端 query_work 一致。
  const { entries: visibleEntries, isSearching } = useMemo(
    () => filterEntries(data, selection, keyword, stageFilter),
    [data, selection, keyword, stageFilter],
  );
  const noSelection = !isSearching && !selection.project;

  // 项目名 → 版本列表(挪版本下拉按条目所属项目取,跨项目混看不错配)
  const versionsByProject = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of data.projects) map.set(p.name, p.versions.map((v) => v.name));
    return map;
  }, [data]);

  const projectOptions = useMemo(
    () => data.projects.map((p) => ({ name: p.name, versions: p.versions.map((v) => v.name) })),
    [data],
  );

  const handleCreate = async (input: { project: string; version: string; title: string; detail: string; tags?: string[]; stage?: WorkStage }) => {
    try {
      await worklogApi.create(input);
      setCreating(false);
      setMode('entries');
      setSelection({ project: input.project, version: input.version });
      await refresh();
      toast.success(`已记录:${input.project} / ${input.version}`);
    } catch (err) {
      toast.error(`记录失败:${errMessage(err)}`);
    }
  };

  const handleSave = async (id: string, patch: { title?: string; detail?: string; tags?: string[]; stage?: WorkStage; version?: string }) => {
    try {
      await worklogApi.update(id, patch);
      await refresh();
      toast.success('已更新');
    } catch (err) {
      toast.error(`更新失败:${errMessage(err)}`);
    }
  };

  const handleDeleteEntry = async (id: string) => {
    try {
      await worklogApi.deleteEntry(id);
      await refresh();
      toast.success('已删除(删除前已自动快照备份)');
    } catch (err) {
      toast.error(`删除失败:${errMessage(err)}`);
    }
  };

  /** 树上破坏性操作的统一包装:提示 + 重拉 + selection 跟随(重命名改写选中名,删除命中则回退) */
  const treeAction = (
    fn: () => Promise<unknown>,
    successTitle: string,
    follow?: (prev: TreeSelection) => TreeSelection,
  ) => async () => {
    try {
      await fn();
      if (follow) setSelection(follow);
      await refresh();
      toast.success(successTitle);
    } catch (err) {
      toast.error(`操作失败:${errMessage(err)}`);
    }
  };

  const handleSelect = (sel: TreeSelection) => {
    setSelection(sel);
    setMode('entries'); // 指南模式下点树 = 返回条目列表(修复"指南无返回语义")
  };

  if (loading) {
    return <div className="text-muted-foreground flex h-full items-center justify-center text-sm">加载工作记录…</div>;
  }

  const emptyHint = loadFailed
    ? '加载失败,点左上角刷新重试(后端可能未启动)。'
    : noSelection
      ? '数据量较大,默认不加载全部。请在左侧展开项目,选择版本查看记录。'
      : '还没有记录。让 AI 干完活调用 record_work,或点「+ 记一条」手动记录。';

  return (
    <div className="flex h-full">
      {/* 左栏:树 + 操作 */}
      <aside className="border-r flex w-60 shrink-0 flex-col @2xl:w-64">
        <div className="flex items-center gap-1 border-b px-3 py-2">
          <span className="flex-1 text-sm font-semibold">工作记录</span>
          <Button variant="ghost" size="sm" className="size-7 p-0" title="刷新(AI 刚记的条目点这里可见;切换视图也会自动刷新)" onClick={() => void refresh()}>
            <RefreshCw className="size-3.5" />
          </Button>
          <Button
            variant={mode === 'guide' ? 'secondary' : 'ghost'} size="sm" className="size-7 p-0"
            title="AI 使用指南(什么时候让 AI 调用什么工具)"
            onClick={() => setMode((m) => (m === 'guide' ? 'entries' : 'guide'))}
          >
            <BookOpenText className="size-3.5" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {data.projects.length === 0 ? (
            <p className="text-muted-foreground p-2 text-xs leading-relaxed">{emptyHint}</p>
          ) : (
            <ProjectVersionTree
              data={data}
              selection={selection}
              onSelect={handleSelect}
              onRenameVersion={(p, v, n) => treeAction(
                () => worklogApi.renameVersion(p, v, n), '版本已重命名',
                (prev) => (prev.project === p && prev.version === v ? { project: p, version: n } : prev),
              )()}
              onRenameProject={(p, n) => treeAction(
                () => worklogApi.renameProject(p, n), '项目已重命名',
                (prev) => (prev.project === p ? { ...prev, project: n } : prev),
              )()}
              onDeleteVersion={(p, v) => treeAction(
                () => worklogApi.deleteVersion(p, v), '版本已删除',
                (prev) => (prev.project === p && prev.version === v ? { project: p } : prev),
              )()}
              onDeleteProject={(p) => treeAction(
                () => worklogApi.deleteProject(p), '项目已删除',
                (prev) => (prev.project === p ? {} : prev),
              )()}
            />
          )}
        </div>
        <div className="border-t p-2">
          <Button variant="outline" size="sm" className="w-full" onClick={() => { setCreating(true); setMode('entries'); }}>
            <Plus className="size-4" /> 记一条
          </Button>
        </div>
      </aside>

      {/* 右栏:条目流 / AI 指南 */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        {mode === 'guide' ? (
          <AiGuideView />
        ) : (
          <div className="mx-auto max-w-3xl space-y-3 p-4 @xl:p-6">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-4" />
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setKeyword(''); }}
                  placeholder="搜索需求:标题 / 详情 / 文件路径(全局,不分项目)"
                  className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border pr-8 pl-8 text-sm outline-none focus-visible:ring-[3px]"
                  aria-label="搜索工作记录"
                />
                {keyword && (
                  <button
                    type="button" onClick={() => setKeyword('')} title="清空搜索"
                    className="text-muted-foreground hover:text-foreground absolute top-2.5 right-2.5"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">
                {isSearching
                  ? `搜索「${keyword.trim()}」`
                  : selection.project
                    ? selection.version
                      ? `${selection.project} / ${selection.version}`
                      : `${selection.project}(全部版本)`
                    : '工作记录'}
                {!noSelection && (
                  <span className="text-muted-foreground ml-2 text-xs font-normal">{visibleEntries.length} 条</span>
                )}
              </h2>
              <div className="flex items-center gap-2">
                <WorkStageMultiSelect
                  value={stageFilter}
                  onChange={setStageFilter}
                  ariaLabel="按阶段筛选"
                  className="w-36"
                />
                {visibleEntries.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 px-3 text-xs"
                    onClick={() => setExpandAll((value) => !(value ?? false))}
                  >
                    {expandAll ? '全部收起' : '全部展开'}
                  </Button>
                )}
              </div>
            </div>

            {creating && (
              <NewEntryForm
                projects={projectOptions}
                defaultProject={selection.project ?? ''}
                defaultVersion={selection.version ?? ''}
                onCreate={handleCreate}
                onCancel={() => setCreating(false)}
              />
            )}

            {visibleEntries.length === 0 && !creating ? (
              <p className="text-muted-foreground py-12 text-center text-sm">{emptyHint}</p>
            ) : (
              visibleEntries.map(({ entry, project, version }) => (
                <EntryItem
                  key={entry.id}
                  entry={entry}
                  projectVersions={versionsByProject.get(project) ?? [version]}
                  currentVersion={version}
                  contextLabel={isSearching ? `${project} / ${version}` : (!selection.version ? version : undefined)}
                  expandAll={expandAll}
                  onSave={handleSave}
                  onDelete={handleDeleteEntry}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
