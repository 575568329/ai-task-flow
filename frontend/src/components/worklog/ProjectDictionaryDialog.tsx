// frontend/src/components/worklog/ProjectDictionaryDialog.tsx
// 项目字典(从旧树移出的项目设置):项目用于路径归属与筛选,不再是树根。
// 支持新建(名称 + 可选路径)、重命名、删除(强确认:只移除字典,历史条目不动)与路径绑定。
// 每个项目展示路径三态:已绑定尾段(+N)/未绑定/路径不存在标红;可就地打开路径绑定弹窗。
import { useEffect, useState } from 'react';
import { Check, Link2, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { worklogApi } from '@/api/worklog';
import type { WorklogProject } from '@ai-task-flow/shared';
import { ProjectPathDialog } from './ProjectPathDialog';

const errMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** 路径尾两段(统一用 \ 展示):D:\xunfei\资源加工平台 → …\xunfei\资源加工平台 */
export function formatPathTail(path: string): string {
  const segments = path.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0) return path;
  const tail = segments.slice(-2).join('\\');
  return segments.length > 2 ? `…\\${tail}` : tail;
}

/** 一行一个路径;空行忽略(路径合法性/冲突由后端校验) */
export function parsePathsText(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

interface ProjectDictionaryDialogProps {
  projects: WorklogProject[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 新建/改名/删除/路径绑定成功后通知父组件重拉(不传则只在弹窗内提示) */
  onChanged?: () => void | Promise<void>;
}

export function ProjectDictionaryDialog({
  projects, open, onOpenChange, onChanged,
}: ProjectDictionaryDialogProps) {
  /** 正在绑定路径的项目名(嵌套弹窗挂载即 open;关闭置空) */
  const [bindingProject, setBindingProject] = useState<string | null>(null);
  const bindingTarget = bindingProject
    ? projects.find((p) => p.name === bindingProject)
    : undefined;

  // 新建
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPathsText, setNewPathsText] = useState('');
  const [creatingBusy, setCreatingBusy] = useState(false);

  // 重命名(行内)
  const [renamingProject, setRenamingProject] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renamingBusy, setRenamingBusy] = useState(false);

  // 删除(强确认弹窗)
  const [deletingProject, setDeletingProject] = useState<string | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  // 关闭即视为一次会话结束:重开时不得残留新建表单/重命名输入/删除确认框
  useEffect(() => {
    if (open) return;
    setBindingProject(null);
    setCreating(false);
    setNewName('');
    setNewPathsText('');
    setCreatingBusy(false);
    setRenamingProject(null);
    setRenameValue('');
    setRenamingBusy(false);
    setDeletingProject(null);
    setDeletingBusy(false);
  }, [open]);

  const resetCreate = () => {
    setCreating(false);
    setNewName('');
    setNewPathsText('');
    setCreatingBusy(false);
  };

  /** 变更成功后刷新;刷新失败不能报成「操作失败」(操作已落库) */
  const notifyChanged = async (fallbackMessage: string) => {
    try {
      await onChanged?.();
    } catch {
      toast.error(fallbackMessage);
    }
  };

  const submitCreate = async () => {
    const name = newName.trim();
    if (!name || creatingBusy) return;
    const paths = parsePathsText(newPathsText);
    setCreatingBusy(true);
    let created = false;
    try {
      await worklogApi.createProject({ name, ...(paths.length ? { paths } : {}) });
      created = true;
      toast.success(`项目已创建:${name}`);
      resetCreate();
    } catch (err) {
      toast.error(`新建项目失败:${errMessage(err)}`);
    } finally {
      setCreatingBusy(false);
    }
    if (created) await notifyChanged('项目已创建,但列表刷新失败,请手动刷新');
  };

  const startRename = (project: WorklogProject) => {
    setRenamingProject(project.name);
    setRenameValue(project.name);
  };

  const submitRename = async () => {
    const target = renamingProject;
    const newNameValue = renameValue.trim();
    if (!target || !newNameValue || renamingBusy) return;
    if (newNameValue === target) {
      setRenamingProject(null);
      return;
    }
    setRenamingBusy(true);
    let renamed = false;
    try {
      await worklogApi.renameProject(target, newNameValue);
      renamed = true;
      toast.success(`项目已重命名为:${newNameValue}`);
      setRenamingProject(null);
    } catch (err) {
      toast.error(`重命名失败:${errMessage(err)}`);
    } finally {
      setRenamingBusy(false);
    }
    if (renamed) await notifyChanged('项目已重命名,但列表刷新失败,请手动刷新');
  };

  const submitDelete = async () => {
    const target = deletingProject;
    if (!target || deletingBusy) return;
    setDeletingBusy(true);
    let deleted = false;
    try {
      await worklogApi.deleteProject(target);
      deleted = true;
      toast.success(`项目已删除:${target}`);
      setDeletingProject(null);
    } catch (err) {
      toast.error(`删除项目失败:${errMessage(err)}`);
    } finally {
      setDeletingBusy(false);
    }
    if (deleted) await notifyChanged('项目已删除,但列表刷新失败,请手动刷新');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>项目字典</DialogTitle>
          <DialogDescription>
            项目用于记录路径归属与筛选;同一路径只能被一个项目占用。绑定后 AI 记录会按所在目录自动归属。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs">共 {projects.length} 个项目</span>
          {!creating && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setCreating(true)}
            >
              <Plus className="size-3" /> 新建项目
            </Button>
          )}
        </div>

        {creating && (
          <div className="space-y-2 rounded-md border p-2">
            <Input
              autoFocus
              aria-label="项目名"
              placeholder="项目名,如 资源加工平台"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void submitCreate(); }}
              className="h-8 text-xs"
            />
            <Textarea
              aria-label="项目路径"
              placeholder="可选:绑定路径,一行一个(如 D:\\xunfei\\资源加工平台)"
              value={newPathsText}
              onChange={(e) => setNewPathsText(e.target.value)}
              rows={3}
              className="text-xs"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={resetCreate} disabled={creatingBusy}>
                取消
              </Button>
              <Button size="sm" className="h-7 px-2 text-xs" onClick={() => void submitCreate()} disabled={!newName.trim() || creatingBusy}>
                {creatingBusy ? '创建中…' : '创建'}
              </Button>
            </div>
          </div>
        )}

        {projects.length === 0 ? (
          <p className="text-muted-foreground text-xs leading-relaxed">
            还没有项目。先新建项目并可选绑定路径,记录会按路径自动归属。
          </p>
        ) : (
          <div className="space-y-1">
            {projects.map((project) => {
              const boundPaths = project.paths ?? [];
              const missingSet = new Set(project.missingPaths ?? []);
              const missingCount = boundPaths.filter((p) => missingSet.has(p)).length;
              const firstPathMissing = boundPaths.length > 0 && missingSet.has(boundPaths[0]);
              if (renamingProject === project.name) {
                return (
                  <div
                    key={project.id}
                    className="flex items-center gap-1.5 rounded-md border px-2 py-1.5"
                  >
                    <Input
                      autoFocus
                      aria-label="新项目名"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void submitRename();
                        if (e.key === 'Escape') setRenamingProject(null);
                      }}
                      className="h-6 flex-1 text-xs"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="size-6 p-0"
                      aria-label="确认重命名"
                      onClick={() => void submitRename()}
                      disabled={!renameValue.trim() || renamingBusy}
                    >
                      <Check className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="size-6 p-0"
                      aria-label="取消重命名"
                      onClick={() => setRenamingProject(null)}
                      disabled={renamingBusy}
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                );
              }
              return (
                <div
                  key={project.id}
                  className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
                >
                  <span className="shrink-0 font-medium">{project.name}</span>
                  <span className="flex min-w-0 flex-1 items-center gap-1">
                    {boundPaths.length > 0 ? (
                      <>
                        <span
                          className={cn(
                            'truncate',
                            firstPathMissing ? 'text-destructive' : 'text-muted-foreground',
                          )}
                          title={firstPathMissing ? '路径不存在' : boundPaths[0]}
                        >
                          {formatPathTail(boundPaths[0])}
                        </span>
                        {boundPaths.length > 1 && (
                          <span className="text-muted-foreground shrink-0">+{boundPaths.length - 1}</span>
                        )}
                        {/* 多路径时明确失效条数,避免 +N 里藏着坏路径却看不出来 */}
                        {boundPaths.length > 1 && missingCount > 0 && (
                          <span className="text-destructive shrink-0" title="其中部分路径不存在">
                            {missingCount} 条失效
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground/70">未绑定路径</span>
                    )}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 shrink-0 px-2 text-xs"
                    onClick={() => setBindingProject(project.name)}
                  >
                    <Link2 className="size-3" /> 绑定路径…
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 shrink-0 px-2 text-xs"
                    onClick={() => startRename(project)}
                  >
                    <Pencil className="size-3" /> 重命名
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive h-6 shrink-0 px-2 text-xs"
                    onClick={() => setDeletingProject(project.name)}
                  >
                    <Trash2 className="size-3" /> 删除
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {bindingTarget && (
          <ProjectPathDialog
            project={bindingTarget.name}
            paths={bindingTarget.paths ?? []}
            missingPaths={bindingTarget.missingPaths}
            open
            onOpenChange={(value) => { if (!value) setBindingProject(null); }}
            onChanged={onChanged}
          />
        )}

        {deletingProject && (
          <Dialog open onOpenChange={(value) => { if (!value) setDeletingProject(null); }}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>删除项目 · {deletingProject}</DialogTitle>
                <DialogDescription>
                  只移除字典，历史条目不删除；路径归属将失效。
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDeletingProject(null)} disabled={deletingBusy}>
                  取消
                </Button>
                <Button variant="destructive" onClick={() => void submitDelete()} disabled={deletingBusy}>
                  {deletingBusy ? '删除中…' : '确认删除'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}
