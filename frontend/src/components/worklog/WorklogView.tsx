// frontend/src/components/worklog/WorklogView.tsx
// 工作记录页(应用默认落地视图):左栏项目/版本树 + 右栏条目流。
// 数据局部 state(单一树,能局部不全局);每次操作后重拉全树(读不缓存,与后端锁协议一致——
// AI 刚经 MCP 记的条目,点刷新即见)。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, BookOpenText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';
import { worklogApi } from '@/api/worklog';
import type { WorklogData } from '@ai-task-flow/shared';
import { ProjectVersionTree, type TreeSelection } from './ProjectVersionTree';
import { EntryItem } from './EntryItem';
import { NewEntryForm } from './NewEntryForm';
import { AiGuideView } from './AiGuideView';

export function WorklogView() {
  const [data, setData] = useState<WorklogData>({ projects: [] });
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<TreeSelection>({});
  const [mode, setMode] = useState<'entries' | 'guide'>('entries');
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async (keepSelection = true) => {
    try {
      const tree = await worklogApi.getTree();
      setData(tree);
      if (!keepSelection) setSelection({});
    } catch {
      // 拉取失败保留现有数据,toast 提示
      toast.error('工作记录加载失败,请确认后端已启动');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 选中版本的所有条目(新在前);未选版本时显示项目下全部(再按版本分组信息合并进 meta)
  const visibleEntries = useMemo(() => {
    const result: Array<{
      entry: WorklogData['projects'][number]['versions'][number]['entries'][number];
      project: string; version: string;
    }> = [];
    for (const project of data.projects) {
      if (selection.project && project.name !== selection.project) continue;
      for (const version of project.versions) {
        if (selection.version && version.name !== selection.version) continue;
        for (const entry of version.entries) {
          result.push({ entry, project: project.name, version: version.name });
        }
      }
    }
    return result.sort((a, b) => b.entry.createdAt - a.entry.createdAt);
  }, [data, selection]);

  const projectOptions = useMemo(
    () => data.projects.map((p) => ({ name: p.name, versions: p.versions.map((v) => v.name) })),
    [data],
  );
  const currentProjectVersions = useMemo(
    () => data.projects.find((p) => p.name === (selection.project ?? visibleEntries[0]?.project))?.versions.map((v) => v.name) ?? [],
    [data, selection, visibleEntries],
  );

  const handleCreate = async (input: { project: string; version: string; title: string; detail: string; tags?: string[] }) => {
    await worklogApi.create(input);
    setCreating(false);
    setSelection({ project: input.project, version: input.version });
    await refresh();
    toast.success(`已记录:${input.project} / ${input.version}`);
  };

  const handleSave = async (id: string, patch: { title?: string; detail?: string; tags?: string[]; version?: string }) => {
    try {
      await worklogApi.update(id, patch);
      await refresh();
      toast.success('已更新');
    } catch (err) {
      toast.error(`更新失败:${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDeleteEntry = async (id: string) => {
    await worklogApi.deleteEntry(id);
    await refresh();
    toast.success('已删除(删除前已自动快照备份)');
  };

  const wrapTreeAction = (fn: () => Promise<unknown>, successTitle: string) => async () => {
    try {
      await fn();
      await refresh();
      toast.success(successTitle);
    } catch (err) {
      toast.error(`操作失败:${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (loading) {
    return <div className="text-muted-foreground flex h-full items-center justify-center text-sm">加载工作记录…</div>;
  }

  return (
    <div className="flex h-full">
      {/* 左栏:树 + 操作 */}
      <aside className="border-r flex w-60 shrink-0 flex-col @2xl:w-64">
        <div className="flex items-center gap-1 border-b px-3 py-2">
          <span className="flex-1 text-sm font-semibold">工作记录</span>
          <Button variant="ghost" size="sm" className="size-7 p-0" title="刷新(AI 刚记的条目点这里可见)" onClick={() => void refresh()}>
            <RefreshCw className="size-3.5" />
          </Button>
          <Button
            variant="ghost" size="sm" className="size-7 p-0"
            title="AI 使用指南"
            onClick={() => setMode((m) => (m === 'guide' ? 'entries' : 'guide'))}
          >
            <BookOpenText className="size-3.5" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {data.projects.length === 0 ? (
            <p className="text-muted-foreground p-2 text-xs leading-relaxed">
              还没有记录。让 AI 干完活调用 record_work,或点右上「+ 记一条」手动记录。
            </p>
          ) : (
            <ProjectVersionTree
              data={data}
              selection={selection}
              onSelect={setSelection}
              onRenameVersion={(p, v, n) => wrapTreeAction(() => worklogApi.renameVersion(p, v, n), '版本已重命名')()}
              onRenameProject={(p, n) => wrapTreeAction(() => worklogApi.renameProject(p, n), '项目已重命名')()}
              onDeleteVersion={(p, v) => wrapTreeAction(() => worklogApi.deleteVersion(p, v), '版本已删除')()}
              onDeleteProject={(p) => wrapTreeAction(() => worklogApi.deleteProject(p), '项目已删除')()}
            />
          )}
        </div>
        <div className="border-t p-2">
          <Button variant="outline" size="sm" className="w-full" onClick={() => setCreating(true)}>
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
              <h2 className="flex-1 text-sm font-semibold">
                {selection.project
                  ? selection.version
                    ? `${selection.project} / ${selection.version}`
                    : `${selection.project}(全部版本)`
                  : '全部记录'}
                <span className="text-muted-foreground ml-2 text-xs font-normal">{visibleEntries.length} 条</span>
              </h2>
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
              <p className="text-muted-foreground py-12 text-center text-sm">
                暂无条目。「+ 记一条」或让 AI 调用 record_work。
              </p>
            ) : (
              visibleEntries.map(({ entry, project, version }) => (
                <EntryItem
                  key={entry.id}
                  entry={entry}
                  projectVersions={currentProjectVersions.length ? currentProjectVersions : [version]}
                  currentProject={project}
                  currentVersion={version}
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
