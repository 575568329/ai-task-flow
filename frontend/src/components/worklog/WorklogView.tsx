// frontend/src/components/worklog/WorklogView.tsx
// 工作记录页(应用默认落地视图):左栏「版本 → 需求」树 + 右栏条目流。
// 数据局部 state(单一树,能局部不全局);每次操作后重拉全树(读不缓存,与后端锁协议一致)。
// 项目已降为字典(路径归属/筛选),路径绑定与三态展示移到「项目字典」弹窗。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, RefreshCw, BookOpenText, FolderGit2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';
import { useUIStore } from '@/stores/uiStore';
import { worklogApi } from '@/api/worklog';
import type {
  WorklogData,
  WorklogRecordRequest,
  WorkStage,
} from '@ai-task-flow/shared';
import { VersionRequirementTree, type RequirementSelection } from './VersionRequirementTree';
import { ProjectDictionaryDialog } from './ProjectDictionaryDialog';
import { EntryItem } from './EntryItem';
import { NewEntryForm } from './NewEntryForm';
import { AiGuideView } from './AiGuideView';
import { WorkStageMultiSelect } from '@/components/common/WorkStageMultiSelect';
import { SearchInput } from '@/components/common/SearchInput';
import { WorkspaceLayout, WorkspaceSidebar, WorkspaceToolbar } from '@/components/layout/WorkspaceLayout';
import type { StageFilter } from '@/lib/workStage';
import { filterEntries } from './searchFilter';

const errMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function WorklogView() {
  const [data, setData] = useState<WorklogData>({ projects: [], versions: [] });
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selection, setSelection] = useState<RequirementSelection>({});
  const [mode, setMode] = useState<'entries' | 'guide'>('entries');
  const [creating, setCreating] = useState(false);
  const [keyword, setKeyword] = useState(''); // 全局模糊搜索(标题/详情/文件路径)
  const [stageFilter, setStageFilter] = useState<StageFilter>([]);
  const [relatedFilter, setRelatedFilter] = useState(''); // 关联项目筛选(项目名快照,空=不过滤)
  const [expandAll, setExpandAll] = useState<boolean | null>(null);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);

  /** 竞态守卫:只有最新一次 refresh 的响应可以落盘(慢的旧响应丢弃) */
  const refreshSeq = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current;
    try {
      const tree = await worklogApi.getTree();
      if (seq !== refreshSeq.current) return; // 已有更新的请求在途,丢弃本次
      setData(tree);
      setLoadFailed(false);
      // selection 跟随数据:指向的版本/需求不存在(被改名/删除)则回退
      setSelection((prev) => {
        if (!prev.versionId) return prev;
        const version = tree.versions.find((v) => v.id === prev.versionId);
        if (!version) return {};
        if (prev.requirementId && !version.requirements.some((r) => r.id === prev.requirementId)) {
          return { versionId: prev.versionId };
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

  // 可见条目:keyword 非空 → 全局搜索(忽略树选择);否则按树选择(版本/需求)过滤。新在前。
  const { entries: visibleEntries, isSearching } = useMemo(
    () => filterEntries(data, selection, keyword, stageFilter, relatedFilter),
    [data, selection, keyword, stageFilter, relatedFilter],
  );
  // 仅关联筛选时也视为全局视图(不要求树选择)
  const noSelection = !isSearching && !selection.versionId && !relatedFilter;

  // 「关联项目」下拉选项:全树条目 relatedProjects 去重(名称快照,与筛选口径一致)
  const relatedProjectOptions = useMemo(() => {
    const names = new Set<string>();
    for (const version of data.versions) {
      for (const requirement of version.requirements) {
        for (const entry of requirement.entries) {
          for (const name of entry.relatedProjects ?? []) {
            if (name) names.add(name);
          }
        }
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [data]);

  // 数据刷新后所选关联项目不存在(如关联被清理)则回退为不过滤
  useEffect(() => {
    if (relatedFilter && !relatedProjectOptions.includes(relatedFilter)) setRelatedFilter('');
  }, [relatedFilter, relatedProjectOptions]);

  // 新建条目的版本/需求下拉数据
  const versionOptions = useMemo(
    () => data.versions.map((v) => ({
      id: v.id,
      name: v.name,
      requirements: v.requirements.map((r) => ({ id: r.id, title: r.title })),
    })),
    [data],
  );

  const selectedVersion = useMemo(
    () => data.versions.find((v) => v.id === selection.versionId),
    [data, selection.versionId],
  );
  const selectedRequirement = useMemo(
    () => selectedVersion?.requirements.find((r) => r.id === selection.requirementId),
    [selectedVersion, selection.requirementId],
  );

  /** 点击条目上的关联项目徽标:按该项目名筛选(清空关键词,保留当前树选择) */
  const handleRelatedBadgeClick = (projectName: string) => {
    setKeyword('');
    setRelatedFilter(projectName);
  };

  /** 树操作统一包装:失败提示,成功重拉 */
  const runTreeAction = async (fn: () => Promise<unknown>, successTitle: string) => {
    try {
      await fn();
      await refresh();
      toast.success(successTitle);
    } catch (err) {
      toast.error(`操作失败:${errMessage(err)}`);
    }
  };

  const handleCreateVersion = async (name: string) => {
    try {
      const { id } = await worklogApi.createVersion({ name });
      setSelection({ versionId: id });
      await refresh();
      toast.success(`版本已创建:${name}`);
    } catch (err) {
      toast.error(`创建版本失败:${errMessage(err)}`);
    }
  };

  const handleCreateRequirement = async (versionId: string, title: string) => {
    try {
      const { id } = await worklogApi.createRequirement({ versionId, title });
      setSelection({ versionId, requirementId: id });
      await refresh();
      toast.success(`需求已创建:${title}`);
    } catch (err) {
      toast.error(`创建需求失败:${errMessage(err)}`);
    }
  };

  const handleDeleteVersion = async (versionId: string) => {
    await runTreeAction(async () => {
      await worklogApi.deleteVersion(versionId);
      if (selection.versionId === versionId) setSelection({});
    }, '版本已删除');
  };

  const handleDeleteRequirement = async (versionId: string, requirementId: string) => {
    await runTreeAction(async () => {
      await worklogApi.deleteRequirement(versionId, requirementId);
      if (selection.requirementId === requirementId) setSelection({ versionId });
    }, '需求已删除');
  };

  const handleCreate = async (input: {
    versionId: string;
    requirementId: string;
    title: string;
    detail: string;
    tags?: string[];
    stage?: WorkStage;
  }) => {
    try {
      // 后端把空/缺失 stage 视为「未标注」;shared 里 stage 必填,用窄化类型承载可选 stage,
      // 只放宽 stage 一项,其余字段仍受 WorklogRecordRequest 约束(避免整体断言掩盖拼写错误)。
      const payload: Omit<WorklogRecordRequest, 'stage'> & { stage?: WorkStage } = {
        versionId: input.versionId,
        requirementId: input.requirementId,
        title: input.title,
        detail: input.detail,
        ...(input.tags ? { tags: input.tags } : {}),
        ...(input.stage ? { stage: input.stage } : {}),
      };
      await worklogApi.record(payload as WorklogRecordRequest);
      setCreating(false);
      setMode('entries');
      setSelection({ versionId: input.versionId, requirementId: input.requirementId });
      await refresh();
      toast.success('已记录');
    } catch (err) {
      toast.error(`记录失败:${errMessage(err)}`);
    }
  };

  const handleSave = async (
    id: string,
    patch: { title?: string; detail?: string; tags?: string[]; stage?: WorkStage },
  ) => {
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

  const handleSelect = (sel: RequirementSelection) => {
    setSelection(sel);
    setMode('entries'); // 指南模式下点树 = 返回条目列表
  };

  if (loading) {
    return <div className="text-muted-foreground flex h-full items-center justify-center text-sm">加载工作记录…</div>;
  }

  const emptyHint = loadFailed
    ? '加载失败,点左上角刷新重试(后端可能未启动)。'
    : noSelection
      ? '数据量较大,默认不加载全部。请在左侧选择版本或需求查看记录。'
      : relatedFilter
        ? `没有关联「${relatedFilter}」的记录。`
        : '还没有记录。让 AI 干完活调用 record_work,或点「+ 记一条」手动记录。';

  const titleText = isSearching
    ? `搜索「${keyword.trim()}」`
    : selection.requirementId
      ? `${selectedVersion?.name ?? '版本'} / ${selectedRequirement?.title ?? '需求'}`
      : selection.versionId
        ? `${selectedVersion?.name ?? '版本'}(全部需求)`
        : relatedFilter
          ? `关联「${relatedFilter}」`
          : '工作记录';

  return (
    <WorkspaceLayout
      sidebar={(
        <WorkspaceSidebar
          title="工作记录"
          actions={(
            <>
              <Button variant="ghost" size="sm" className="size-7 p-0" title="刷新(AI 刚记的条目点这里可见;切换视图也会自动刷新)" onClick={() => void refresh()}>
                <RefreshCw className="size-3.5" />
              </Button>
              <Button
                variant="ghost" size="sm" className="size-7 p-0"
                title="项目字典与路径绑定"
                onClick={() => setProjectDialogOpen(true)}
              >
                <FolderGit2 className="size-3.5" />
              </Button>
              <Button
                variant={mode === 'guide' ? 'secondary' : 'ghost'} size="sm" className="size-7 p-0"
                title="AI 使用指南(什么时候让 AI 调用什么工具)"
                onClick={() => setMode((m) => (m === 'guide' ? 'entries' : 'guide'))}
              >
                <BookOpenText className="size-3.5" />
              </Button>
            </>
          )}
        >
          <VersionRequirementTree
            data={data}
            selection={selection}
            onSelect={handleSelect}
            onCreateVersion={(name) => handleCreateVersion(name)}
            onRenameVersion={(versionId, newName) => runTreeAction(
              () => worklogApi.renameVersion(versionId, newName), '版本已重命名',
            )}
            onDeleteVersion={(versionId) => handleDeleteVersion(versionId)}
            onCreateRequirement={(versionId, title) => handleCreateRequirement(versionId, title)}
            onRenameRequirement={(versionId, requirementId, newTitle) => runTreeAction(
              () => worklogApi.renameRequirement(versionId, requirementId, newTitle), '需求已重命名',
            )}
            onDeleteRequirement={(versionId, requirementId) => handleDeleteRequirement(versionId, requirementId)}
          />
        </WorkspaceSidebar>
      )}
      toolbar={mode === 'guide' ? undefined : (
        <WorkspaceToolbar
          search={(
            <SearchInput
              value={keyword}
              onChange={setKeyword}
              placeholder="搜索需求:标题 / 详情 / 文件路径(全局,不分版本)"
              ariaLabel="搜索工作记录"
            />
          )}
          title={(
            <>
              {titleText}
              {relatedFilter && (isSearching || selection.versionId) && (
                <span className="text-muted-foreground ml-2 text-xs font-normal">· 筛选关联「{relatedFilter}」</span>
              )}
              {!noSelection && (
                <span className="text-muted-foreground ml-2 text-xs font-normal">{visibleEntries.length} 条</span>
              )}
            </>
          )}
          actions={(
            <>
              {relatedProjectOptions.length > 0 && (
                <select
                  aria-label="按关联项目筛选"
                  title="只看关联了指定项目的记录"
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
              <Button
                size="sm"
                className="h-8 shrink-0 px-3 text-xs"
                onClick={() => { setCreating(true); setMode('entries'); }}
              >
                <Plus className="size-3.5" />记一条
              </Button>
            </>
          )}
        />
      )}
    >
      {mode === 'guide' ? (
        <AiGuideView />
      ) : (
        <div className="mx-auto max-w-3xl space-y-3 p-4 @xl:p-6">
          {creating && (
            <NewEntryForm
              versions={versionOptions}
              defaultVersionId={selection.versionId ?? ''}
              defaultRequirementId={selection.requirementId ?? ''}
              onCreate={handleCreate}
              onCancel={() => setCreating(false)}
            />
          )}

          {visibleEntries.length === 0 && !creating ? (
            <p className="text-muted-foreground py-12 text-center text-sm">{emptyHint}</p>
          ) : (
            visibleEntries.map(({ entry, version, requirement }) => (
              <EntryItem
                key={entry.id}
                entry={entry}
                contextLabel={
                  isSearching || relatedFilter
                    ? `${version} / ${requirement}`
                    : (!selection.requirementId ? requirement : undefined)
                }
                expandAll={expandAll}
                onSave={handleSave}
                onDelete={handleDeleteEntry}
                onRelatedClick={handleRelatedBadgeClick}
              />
            ))
          )}
        </div>
      )}

      <ProjectDictionaryDialog
        projects={data.projects}
        open={projectDialogOpen}
        onOpenChange={setProjectDialogOpen}
        onPathsChanged={() => refresh()}
      />
    </WorkspaceLayout>
  );
}
