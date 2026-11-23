// frontend/src/components/worklog/ProjectVersionTree.tsx
// 左栏:项目/版本树(计数徽标 + 右键 重命名/删除/绑定路径)。
// 项目第二行显示路径三态:已绑定尾段(+N)/未绑定/路径不存在标红。重命名与删除仍内联/确认态。
import { useEffect, useState } from 'react';
import {
  ChevronDown, ChevronRight, FolderGit2, Tag, Pencil, Trash2, Check, X, Link2,
} from 'lucide-react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { WorklogData } from '@ai-task-flow/shared';
import { ProjectPathDialog } from './ProjectPathDialog';

export interface TreeSelection {
  project?: string;
  version?: string;
}

interface ProjectVersionTreeProps {
  data: WorklogData;
  selection: TreeSelection;
  onSelect: (sel: TreeSelection) => void;
  onRenameVersion: (project: string, version: string, newName: string) => Promise<void>;
  onRenameProject: (project: string, newName: string) => Promise<void>;
  onDeleteVersion: (project: string, version: string) => Promise<void>;
  onDeleteProject: (project: string) => Promise<void>;
  /** 路径绑定/解绑成功后重拉树(不传则只在弹窗内提示) */
  onPathsChanged?: () => void | Promise<void>;
  /** 项目 id → 关联到该项目的记录数(树外条目);>0 时节点下显示弱提示 */
  relatedCounts?: Record<string, number>;
  /** 点击「另有 N 条关联记录」时把该关联项目设为筛选值(传项目名) */
  onRelatedFilterChange?: (projectName: string) => void;
}

/** 路径尾两段(统一用 \ 展示):D:\xunfei\资源加工平台 → …\xunfei\资源加工平台 */
export function formatPathTail(path: string): string {
  const segments = path.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0) return path;
  const tail = segments.slice(-2).join('\\');
  return segments.length > 2 ? `…\\${tail}` : tail;
}

type PendingAction =
  | { kind: 'rename-version'; project: string; version: string }
  | { kind: 'rename-project'; project: string }
  | { kind: 'delete-version'; project: string; version: string }
  | { kind: 'delete-project'; project: string };

export function ProjectVersionTree({
  data, selection, onSelect,
  onRenameVersion, onRenameProject, onDeleteVersion, onDeleteProject, onPathsChanged,
  relatedCounts, onRelatedFilterChange,
}: ProjectVersionTreeProps) {
  /** 默认全部收起；只记录“已展开”的项目，新项目/新加载的项目也默认收起。 */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [renameValue, setRenameValue] = useState('');
  /** 正在绑定路径的项目名(弹窗挂载即 open;关闭置空) */
  const [bindingProject, setBindingProject] = useState<string | null>(null);

  const toggle = (project: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(project)) next.delete(project);
      else next.add(project);
      return next;
    });
  };

  // 外部选择（建任务、搜索定位等）落到某项目时，自动展开该项目。
  useEffect(() => {
    if (!selection.project) return;
    setExpanded((prev) => {
      if (prev.has(selection.project!)) return prev;
      const next = new Set(prev);
      next.add(selection.project!);
      return next;
    });
  }, [selection.project]);

  const confirmPending = async () => {
    if (!pending) return;
    const action = pending;
    setPending(null);
    if (action.kind === 'rename-version') await onRenameVersion(action.project, action.version, renameValue);
    else if (action.kind === 'rename-project') await onRenameProject(action.project, renameValue);
    else if (action.kind === 'delete-version') await onDeleteVersion(action.project, action.version);
    else await onDeleteProject(action.project);
  };

  const startRename = (kind: 'rename-version' | 'rename-project', project: string, version: string, current: string) => {
    setRenameValue(current);
    setPending({ kind, project, version } as PendingAction);
    void version; // rename-project 时 version 不用
  };

  const bindingTarget = bindingProject
    ? data.projects.find((p) => p.name === bindingProject)
    : undefined;

  return (
    <div className="space-y-0.5">
      {data.projects.map((project) => {
        const isCollapsed = !expanded.has(project.name);
        // 版本新→旧：数字感知排序，V8.0.10 排在 V8.0.9 前。
        const sortedVersions = [...project.versions].sort((a, b) =>
          b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' }),
        );
        const isProjectActive = selection.project === project.name && !selection.version;
        const totalEntries = project.versions.reduce((sum, v) => sum + v.entries.length, 0);
        const boundPaths = project.paths ?? [];
        const isPathMissing = (project.missingPaths?.length ?? 0) > 0;
        const relatedCount = relatedCounts?.[project.id] ?? 0;
        return (
          <div key={project.name}>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <button
                  type="button"
                  onClick={() => { onSelect({ project: project.name }); toggle(project.name); }}
                  className={cn(
                    'hover:bg-accent flex w-full flex-col items-stretch gap-0.5 rounded-md px-2 py-1.5 text-left text-sm font-medium',
                    isProjectActive && 'bg-accent',
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    {project.versions.length > 0 && (
                      isCollapsed
                        ? <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
                        : <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
                    )}
                    <FolderGit2 className="text-primary size-4 shrink-0" />
                    <span className="flex-1 truncate">{project.name}</span>
                    <Badge variant="secondary" className="shrink-0">{totalEntries}</Badge>
                  </span>
                  <span className="flex min-w-0 items-center gap-1 pl-5 text-[11px] font-normal">
                    {boundPaths.length > 0 ? (
                      <>
                        <span
                          className={cn(
                            'truncate',
                            isPathMissing ? 'text-destructive' : 'text-muted-foreground',
                          )}
                          title={isPathMissing ? '路径不存在' : boundPaths[0]}
                        >
                          {formatPathTail(boundPaths[0])}
                        </span>
                        {boundPaths.length > 1 && (
                          <span className="text-muted-foreground shrink-0">+{boundPaths.length - 1}</span>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground/70">未绑定路径</span>
                    )}
                  </span>
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem
                  onSelect={() => startRename('rename-project', project.name, '', project.name)}
                >
                  <Pencil className="mr-2 size-4" /> 重命名
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => setBindingProject(project.name)}>
                  <Link2 className="mr-2 size-4" /> 绑定路径…
                </ContextMenuItem>
                <ContextMenuItem
                  className="text-destructive"
                  onSelect={() => setPending({ kind: 'delete-project', project: project.name })}
                >
                  <Trash2 className="mr-2 size-4" /> 删除项目
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>

            {/* 树外条目对本项目的关联提示:点击切到全局关联筛选 */}
            {relatedCount > 0 && (
              <button
                type="button"
                onClick={() => onRelatedFilterChange?.(project.name)}
                className="text-muted-foreground hover:text-foreground ml-5 block rounded px-2 py-0.5 text-left text-[11px] hover:underline"
                title={`查看其他项目里关联「${project.name}」的记录`}
              >
                另有 {relatedCount} 条关联记录
              </button>
            )}

            {/* 删除项目确认态 */}
            {pending?.kind === 'delete-project' && pending.project === project.name && (
              <ConfirmRow
                label={`删除项目「${project.name}」及全部版本?`}
                onConfirm={confirmPending}
                onCancel={() => setPending(null)}
              />
            )}
            {/* 重命名项目确认态 */}
            {pending?.kind === 'rename-project' && pending.project === project.name && (
              <RenameRow
                value={renameValue}
                onChange={setRenameValue}
                onConfirm={confirmPending}
                onCancel={() => setPending(null)}
              />
            )}

            {!isCollapsed && sortedVersions.map((version) => {
              const isVersionActive = selection.project === project.name && selection.version === version.name;
              return (
                <div key={version.name} className="pl-5">
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <button
                        type="button"
                        onClick={() => onSelect({ project: project.name, version: version.name })}
                        className={cn(
                          'hover:bg-accent flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm',
                          isVersionActive && 'bg-accent',
                        )}
                      >
                        <Tag className="text-muted-foreground size-3.5 shrink-0" />
                        <span className="flex-1 truncate">{version.name}</span>
                        <Badge variant="secondary" className="shrink-0">{version.entries.length}</Badge>
                      </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        onSelect={() => startRename('rename-version', project.name, version.name, version.name)}
                      >
                        <Pencil className="mr-2 size-4" /> 重命名
                      </ContextMenuItem>
                      <ContextMenuItem
                        className="text-destructive"
                        onSelect={() => setPending({ kind: 'delete-version', project: project.name, version: version.name })}
                      >
                        <Trash2 className="mr-2 size-4" /> 删除版本
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>

                  {pending?.kind === 'delete-version' && pending.project === project.name && pending.version === version.name && (
                    <ConfirmRow
                      label={`删除版本「${version.name}」(${version.entries.length} 条)?`}
                      onConfirm={confirmPending}
                      onCancel={() => setPending(null)}
                    />
                  )}
                  {pending?.kind === 'rename-version' && pending.project === project.name && pending.version === version.name && (
                    <RenameRow
                      value={renameValue}
                      onChange={setRenameValue}
                      onConfirm={confirmPending}
                      onCancel={() => setPending(null)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {bindingTarget && (
        <ProjectPathDialog
          project={bindingTarget.name}
          paths={bindingTarget.paths ?? []}
          missingPaths={bindingTarget.missingPaths}
          open
          onOpenChange={(open) => { if (!open) setBindingProject(null); }}
          onChanged={onPathsChanged}
        />
      )}
    </div>
  );
}

/** 二次确认行:删除类操作,首点变确认态再点执行(不弹 Dialog) */
function ConfirmRow({ label, onConfirm, onCancel }: { label: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="bg-destructive/5 border-destructive/30 mx-2 my-1 flex items-center gap-2 rounded-md border px-2 py-1.5">
      <span className="text-destructive flex-1 text-xs">{label}</span>
      <Button variant="destructive" size="sm" className="h-6 px-2 text-xs" onClick={onConfirm}>
        <Check className="size-3" /> 确认
      </Button>
      <Button variant="ghost" size="sm" className="size-6 p-0" onClick={onCancel}>
        <X className="size-3" />
      </Button>
    </div>
  );
}

/** 内联重命名行 */
function RenameRow({ value, onChange, onConfirm, onCancel }: {
  value: string; onChange: (v: string) => void; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="mx-2 my-1 flex items-center gap-1.5">
      <Input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onConfirm(); if (e.key === 'Escape') onCancel(); }}
        className="h-6 text-xs"
      />
      <Button variant="ghost" size="sm" className="size-6 p-0" onClick={onConfirm}>
        <Check className="size-3" />
      </Button>
      <Button variant="ghost" size="sm" className="size-6 p-0" onClick={onCancel}>
        <X className="size-3" />
      </Button>
    </div>
  );
}
