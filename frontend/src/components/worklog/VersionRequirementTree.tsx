// frontend/src/components/worklog/VersionRequirementTree.tsx
// 左栏:建设主题 → 版本 → 需求树(条目在右栏)。
// 主题行:名称 / 展开收起 / 复制 g_xxx / 版本数；版本行:名称 / 展开收起 / 复制 v_xxx / 需求数·条目数；
// 需求行:标题 / 关联项目徽标 / 条目数 / 复制 id。
// selection 仍只含 { versionId, requirementId }:主题只做分组,不参与选中。
// 新建版本 / 新建需求 / 删除版本 / 删除主题走弹窗;主题与版本重命名保持行内快速编辑,
// 删除需求保留行内二次确认(普通确认即可,不涉及级联整版/整主题)。
import { useEffect, useState } from 'react';
import {
  ChevronDown, ChevronRight, Tag, FileText, Pencil, Trash2, Check, X, Plus, Layers, AlertTriangle,
} from 'lucide-react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CopyIdButton } from '@/components/common/CopyIdButton';
import { cn } from '@/lib/utils';
import type { WorklogData, WorklogVersion } from '@ai-task-flow/shared';

export interface RequirementSelection {
  versionId?: string;
  requirementId?: string;
}

type PendingAction =
  | { kind: 'rename-program'; programId: string; current: string }
  | { kind: 'rename-version'; versionId: string; current: string }
  | { kind: 'rename-requirement'; versionId: string; requirementId: string; current: string }
  | { kind: 'delete-requirement'; versionId: string; requirementId: string };

interface VersionRequirementTreeProps {
  data: WorklogData;
  selection: RequirementSelection;
  onSelect: (sel: RequirementSelection) => void;
  /** 全树拉取失败:空树时不得显示「还没有主题」(会误导为数据为空) */
  loadFailed?: boolean;
  /** 打开「新建主题」弹窗(侧栏顶部入口) */
  onCreateProgramClick?: () => void;
  /** 打开「新建版本」弹窗;从主题行右键进入时携带主题 id 以预选 */
  onCreateVersionClick?: (programId?: string) => void;
  /** 打开「新建需求」弹窗(携带所属版本 id) */
  onCreateRequirementClick?: (versionId: string) => void;
  /** 打开「删除版本」强确认弹窗(携带版本 id) */
  onDeleteVersionClick?: (versionId: string) => void;
  /** 打开「删除主题」强确认弹窗(携带主题 id) */
  onDeleteProgramClick?: (programId: string) => void;
  onRenameProgram?: (programId: string, newName: string) => Promise<void> | void;
  onRenameVersion?: (versionId: string, newName: string) => Promise<void> | void;
  onRenameRequirement?: (versionId: string, requirementId: string, newTitle: string) => Promise<void> | void;
  onDeleteRequirement?: (versionId: string, requirementId: string) => Promise<void> | void;
}

/** 版本条目总数(需求下条目求和) */
function countVersionEntries(version: WorklogVersion): number {
  return version.requirements.reduce((sum, r) => sum + r.entries.length, 0);
}

/** 版本新→旧:数字感知排序,V8.0.10 排在 V8.0.9 前(与旧树一致)。 */
function sortVersionsDesc(versions: WorklogVersion[]): WorklogVersion[] {
  return [...versions].sort((a, b) =>
    b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' }),
  );
}

export function VersionRequirementTree({
  data, selection, onSelect, loadFailed,
  onCreateProgramClick, onCreateVersionClick, onCreateRequirementClick, onDeleteVersionClick,
  onDeleteProgramClick, onRenameProgram, onRenameVersion, onRenameRequirement, onDeleteRequirement,
}: VersionRequirementTreeProps) {
  /** 默认全部展开；只记录“已收起”的主题/版本,新建或新加载的条目天然展开。 */
  const [collapsedPrograms, setCollapsedPrograms] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [inputValue, setInputValue] = useState('');

  const toggleProgram = (programId: string) => {
    setCollapsedPrograms((prev) => {
      const next = new Set(prev);
      if (next.has(programId)) next.delete(programId);
      else next.add(programId);
      return next;
    });
  };

  const toggle = (versionId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(versionId)) next.delete(versionId);
      else next.add(versionId);
      return next;
    });
  };

  // 外部选择(搜索定位/新建需求后选中)落到某版本时,自动展开被收起的主题与版本。
  // 同时依赖 requirementId:在同一折叠版本下新建需求,versionId 不变也要展开出新行。
  useEffect(() => {
    const vid = selection.versionId;
    if (!vid) return;
    const version = data.versions.find((v) => v.id === vid);
    if (version) {
      setCollapsedPrograms((prev) => {
        if (!prev.has(version.programId)) return prev;
        const next = new Set(prev);
        next.delete(version.programId);
        return next;
      });
    }
    setCollapsed((prev) => {
      if (!prev.has(vid)) return prev;
      const next = new Set(prev);
      next.delete(vid);
      return next;
    });
  }, [selection.versionId, selection.requirementId, data.versions]);

  const start = (action: PendingAction, initial = '') => {
    setInputValue(initial);
    setPending(action);
  };
  const cancel = () => setPending(null);

  const confirmPending = async () => {
    if (!pending) return;
    const action = pending;
    setPending(null);
    const text = inputValue.trim();
    if (action.kind === 'rename-program') {
      if (text) await onRenameProgram?.(action.programId, text);
    } else if (action.kind === 'rename-version') {
      if (text) await onRenameVersion?.(action.versionId, text);
    } else if (action.kind === 'rename-requirement') {
      if (text) await onRenameRequirement?.(action.versionId, action.requirementId, text);
    } else {
      await onDeleteRequirement?.(action.versionId, action.requirementId);
    }
  };

  const programs = data.programs ?? [];
  // 主题按名称排序,版本在各自主题内新→旧
  const sortedPrograms = [...programs].sort((a, b) => a.name.localeCompare(b.name));
  // 防脏数据:programId 悬空的版本不能从树上消失,单列「未归属主题」分组(只读展示,不做主题操作)
  const programIds = new Set(programs.map((p) => p.id));
  const orphanVersions = sortVersionsDesc(data.versions.filter((v) => !programIds.has(v.programId)));
  const isEmpty = programs.length === 0 && data.versions.length === 0;

  /** 版本行 + 需求行(主题分组与未归属分组共用) */
  const renderVersion = (version: WorklogVersion) => {
    const isCollapsed = collapsed.has(version.id);
    const isVersionActive = selection.versionId === version.id && !selection.requirementId;
    const entryCount = countVersionEntries(version);
    return (
      <div key={version.id} className="ml-5">
        <div
          className={cn(
            'hover:bg-accent flex items-center gap-1 rounded-md px-2 py-1.5',
            isVersionActive && 'bg-accent',
          )}
        >
          {/* 折叠箭头独立于选择按钮:点击只切换展开,不会触发 onSelect 触发的自动展开 */}
          {version.requirements.length > 0 ? (
            <button
              type="button"
              aria-label={isCollapsed ? `展开 ${version.name}` : `收起 ${version.name}`}
              onClick={(e) => { e.stopPropagation(); toggle(version.id); }}
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              {isCollapsed
                ? <ChevronRight className="size-3.5" />
                : <ChevronDown className="size-3.5" />}
            </button>
          ) : <span className="size-3.5 shrink-0" />}
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <button
                type="button"
                onClick={() => onSelect({ versionId: version.id })}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-medium"
              >
                <Tag className="text-primary size-4 shrink-0" />
                <span className="flex-1 truncate">{version.name}</span>
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem
                onSelect={() => onCreateRequirementClick?.(version.id)}
              >
                <Plus className="mr-2 size-4" /> 新建需求
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => start(
                  { kind: 'rename-version', versionId: version.id, current: version.name },
                  version.name,
                )}
              >
                <Pencil className="mr-2 size-4" /> 重命名
              </ContextMenuItem>
              <ContextMenuItem
                className="text-destructive"
                onSelect={() => onDeleteVersionClick?.(version.id)}
              >
                <Trash2 className="mr-2 size-4" /> 删除版本
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          <span className="text-muted-foreground shrink-0 text-[11px]">
            {version.requirements.length} 需求 · {entryCount} 条
          </span>
          <CopyIdButton id={version.id} iconOnly className="text-muted-foreground shrink-0" />
        </div>

        {pending?.kind === 'rename-version' && pending.versionId === version.id && (
          <div className="ml-5">
            <InlineInput
              value={inputValue}
              onChange={setInputValue}
              onConfirm={() => void confirmPending()}
              onCancel={cancel}
              ariaLabel="新版本名"
            />
          </div>
        )}

        {!isCollapsed && version.requirements.map((req) => {
          const isReqActive = selection.requirementId === req.id;
          const projectBadges = (req.projects ?? []).slice(0, 2);
          const extraProjects = (req.projects?.length ?? 0) - projectBadges.length;
          return (
            <div key={req.id}>
              <div
                className={cn(
                  'hover:bg-accent ml-5 flex items-center gap-1 rounded-md px-2 py-1',
                  isReqActive && 'bg-accent',
                )}
              >
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <button
                      type="button"
                      onClick={() => onSelect({ versionId: version.id, requirementId: req.id })}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm"
                    >
                      <FileText className="text-muted-foreground size-3.5 shrink-0" />
                      <span className="flex-1 truncate">{req.title}</span>
                    </button>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      onSelect={() => start(
                        { kind: 'rename-requirement', versionId: version.id, requirementId: req.id, current: req.title },
                        req.title,
                      )}
                    >
                      <Pencil className="mr-2 size-4" /> 重命名
                    </ContextMenuItem>
                    <ContextMenuItem
                      className="text-destructive"
                      onSelect={() => setPending({
                        kind: 'delete-requirement', versionId: version.id, requirementId: req.id,
                      })}
                    >
                      <Trash2 className="mr-2 size-4" /> 删除需求
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
                {projectBadges.map((name) => (
                  <Badge key={name} variant="outline" className="max-w-24 shrink-0 truncate text-[10px]">
                    {name}
                  </Badge>
                ))}
                {extraProjects > 0 && (
                  <span className="text-muted-foreground shrink-0 text-[10px]">+{extraProjects}</span>
                )}
                <Badge variant="secondary" className="shrink-0">{req.entries.length}</Badge>
                <CopyIdButton id={req.id} iconOnly className="text-muted-foreground shrink-0" />
              </div>

              {pending?.kind === 'rename-requirement' && pending.requirementId === req.id && (
                <div className="ml-10">
                  <InlineInput
                    value={inputValue}
                    onChange={setInputValue}
                    onConfirm={() => void confirmPending()}
                    onCancel={cancel}
                    ariaLabel="新需求名"
                  />
                </div>
              )}
              {pending?.kind === 'delete-requirement' && pending.requirementId === req.id && (
                <div className="ml-10">
                  <ConfirmRow
                    label={`删除需求「${req.title}」(${req.entries.length} 条)?`}
                    onConfirm={() => void confirmPending()}
                    onCancel={cancel}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-0.5">
      <div className="mb-1 flex items-center justify-between gap-1 px-1">
        <span className="text-muted-foreground text-[11px] font-medium">建设主题</span>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground h-6 px-2 text-xs"
          onClick={() => onCreateProgramClick?.()}
        >
          <Plus className="size-3.5" /> 新建主题
        </Button>
      </div>

      {isEmpty && (
        <p className="text-muted-foreground px-2 py-1 text-xs leading-relaxed">
          {loadFailed
            ? '加载失败，请刷新重试。'
            : '还没有建设主题。先新建主题，再建版本与需求。'}
        </p>
      )}

      {sortedPrograms.map((program) => {
        const versions = sortVersionsDesc(data.versions.filter((v) => v.programId === program.id));
        const isCollapsed = collapsedPrograms.has(program.id);
        return (
          <div key={program.id}>
            <div className="hover:bg-accent flex items-center gap-1 rounded-md px-2 py-1.5">
              {versions.length > 0 ? (
                <button
                  type="button"
                  aria-label={isCollapsed ? `展开 ${program.name}` : `收起 ${program.name}`}
                  onClick={(e) => { e.stopPropagation(); toggleProgram(program.id); }}
                  className="text-muted-foreground hover:text-foreground shrink-0"
                >
                  {isCollapsed
                    ? <ChevronRight className="size-3.5" />
                    : <ChevronDown className="size-3.5" />}
                </button>
              ) : <span className="size-3.5 shrink-0" />}
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={() => toggleProgram(program.id)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-semibold"
                  >
                    <Layers className="text-primary size-4 shrink-0" />
                    <span className="flex-1 truncate">{program.name}</span>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => onCreateVersionClick?.(program.id)}>
                    <Plus className="mr-2 size-4" /> 新建版本
                  </ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() => start(
                      { kind: 'rename-program', programId: program.id, current: program.name },
                      program.name,
                    )}
                  >
                    <Pencil className="mr-2 size-4" /> 重命名
                  </ContextMenuItem>
                  <ContextMenuItem
                    className="text-destructive"
                    onSelect={() => onDeleteProgramClick?.(program.id)}
                  >
                    <Trash2 className="mr-2 size-4" /> 删除主题
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              <span className="text-muted-foreground shrink-0 text-[11px]">
                {versions.length} 版本
              </span>
              <CopyIdButton id={program.id} iconOnly className="text-muted-foreground shrink-0" />
            </div>

            {pending?.kind === 'rename-program' && pending.programId === program.id && (
              <div className="ml-5">
                <InlineInput
                  value={inputValue}
                  onChange={setInputValue}
                  onConfirm={() => void confirmPending()}
                  onCancel={cancel}
                  ariaLabel="新主题名"
                />
              </div>
            )}

            {!isCollapsed && versions.map(renderVersion)}
          </div>
        );
      })}

      {programs.length > 0 && data.versions.length === 0 && (
        <p className="text-muted-foreground px-2 py-1 text-xs leading-relaxed">
          还没有版本。在主题行右键「新建版本」，或点下方按钮。
        </p>
      )}

      {orphanVersions.length > 0 && (
        <div>
          <div className="text-muted-foreground flex items-center gap-1 px-2 py-1.5 text-xs font-medium">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span className="flex-1 truncate">未归属主题</span>
            <span className="shrink-0 text-[11px]">{orphanVersions.length} 版本</span>
          </div>
          {orphanVersions.map(renderVersion)}
        </div>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-foreground mt-1 w-full justify-start px-2 text-xs"
        onClick={() => onCreateVersionClick?.()}
      >
        <Plus className="size-3.5" /> 新建版本
      </Button>
    </div>
  );
}

/** 二次确认行:删除需求(普通确认,不涉级联整版) */
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

/** 内联输入行(主题/版本/需求重命名共用) */
function InlineInput({ value, onChange, onConfirm, onCancel, ariaLabel }: {
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  ariaLabel: string;
}) {
  return (
    <div className="mx-2 my-1 flex items-center gap-1.5">
      <Input
        autoFocus
        value={value}
        aria-label={ariaLabel}
        placeholder={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onConfirm(); if (e.key === 'Escape') onCancel(); }}
        className="h-6 text-xs"
      />
      <Button variant="ghost" size="sm" className="size-6 p-0" onClick={onConfirm} aria-label="确认">
        <Check className="size-3" />
      </Button>
      <Button variant="ghost" size="sm" className="size-6 p-0" onClick={onCancel} aria-label="取消">
        <X className="size-3" />
      </Button>
    </div>
  );
}
