// frontend/src/components/worklog/ProjectVersionTree.tsx
// 左栏:项目/版本树(计数徽标 + 右键 重命名/删除)。重命名与删除均内联/确认态,零二级弹窗。
import { useEffect, useState } from 'react';
import {
  ChevronDown, ChevronRight, FolderGit2, Tag, Pencil, Trash2, Check, X,
} from 'lucide-react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { WorklogData } from '@ai-task-flow/shared';

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
}

type PendingAction =
  | { kind: 'rename-version'; project: string; version: string }
  | { kind: 'rename-project'; project: string }
  | { kind: 'delete-version'; project: string; version: string }
  | { kind: 'delete-project'; project: string };

export function ProjectVersionTree({
  data, selection, onSelect,
  onRenameVersion, onRenameProject, onDeleteVersion, onDeleteProject,
}: ProjectVersionTreeProps) {
  /** 默认全部收起；只记录“已展开”的项目，新项目/新加载的项目也默认收起。 */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [renameValue, setRenameValue] = useState('');

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
        return (
          <div key={project.name}>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <button
                  type="button"
                  onClick={() => { onSelect({ project: project.name }); toggle(project.name); }}
                  className={cn(
                    'hover:bg-accent flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm font-medium',
                    isProjectActive && 'bg-accent',
                  )}
                >
                  {project.versions.length > 0 && (
                    isCollapsed
                      ? <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
                      : <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
                  )}
                  <FolderGit2 className="text-primary size-4 shrink-0" />
                  <span className="flex-1 truncate">{project.name}</span>
                  <Badge variant="secondary" className="shrink-0">{totalEntries}</Badge>
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem
                  onSelect={() => startRename('rename-project', project.name, '', project.name)}
                >
                  <Pencil className="mr-2 size-4" /> 重命名
                </ContextMenuItem>
                <ContextMenuItem
                  className="text-destructive"
                  onSelect={() => setPending({ kind: 'delete-project', project: project.name })}
                >
                  <Trash2 className="mr-2 size-4" /> 删除项目
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>

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
