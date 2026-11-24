// frontend/src/components/worklog/VersionRequirementTree.tsx
// 左栏:建设主题 → 版本树(条目在右栏;需求层已移除)。
// 主题行:名称 / 展开收起 / 复制 g_xxx / 版本数；版本行:名称 / 复制 v_xxx / 条目数。
// selection 只含 { versionId }:主题只做分组,不参与选中。
// 新建版本 / 删除版本 / 删除主题走弹窗;主题与版本重命名保持行内快速编辑。
import { useEffect, useState } from 'react';
import {
  ChevronDown, ChevronRight, Tag, Pencil, Trash2, Check, X, Plus, Layers, AlertTriangle,
} from 'lucide-react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CopyIdButton } from '@/components/common/CopyIdButton';
import { cn } from '@/lib/utils';
import type { WorklogData, WorklogVersion } from '@ai-task-flow/shared';

export interface VersionSelection {
  versionId?: string;
}

type PendingAction =
  | { kind: 'rename-program'; programId: string; current: string }
  | { kind: 'rename-version'; versionId: string; current: string };

interface VersionRequirementTreeProps {
  data: WorklogData;
  selection: VersionSelection;
  onSelect: (sel: VersionSelection) => void;
  /** 全树拉取失败:空树时不得显示「还没有主题」(会误导为数据为空) */
  loadFailed?: boolean;
  /** 打开「新建主题」弹窗(侧栏顶部入口) */
  onCreateProgramClick?: () => void;
  /** 打开「新建版本」弹窗;从主题行右键进入时携带主题 id 以预选 */
  onCreateVersionClick?: (programId?: string) => void;
  /** 打开「删除版本」强确认弹窗(携带版本 id) */
  onDeleteVersionClick?: (versionId: string) => void;
  /** 打开「删除主题」强确认弹窗(携带主题 id) */
  onDeleteProgramClick?: (programId: string) => void;
  onRenameProgram?: (programId: string, newName: string) => Promise<void> | void;
  onRenameVersion?: (versionId: string, newName: string) => Promise<void> | void;
}

/** 版本新→旧:数字感知排序,V8.0.10 排在 V8.0.9 前(与旧树一致)。 */
function sortVersionsDesc(versions: WorklogVersion[]): WorklogVersion[] {
  return [...versions].sort((a, b) =>
    b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' }),
  );
}

export function VersionRequirementTree({
  data, selection, onSelect, loadFailed,
  onCreateProgramClick, onCreateVersionClick, onDeleteVersionClick,
  onDeleteProgramClick, onRenameProgram, onRenameVersion,
}: VersionRequirementTreeProps) {
  /** 默认全部展开；只记录“已收起”的主题,新建或新加载的条目天然展开。 */
  const [collapsedPrograms, setCollapsedPrograms] = useState<Set<string>>(new Set());
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

  // 外部选择(搜索定位/新建版本后选中)落到某版本时,自动展开被收起的主题。
  useEffect(() => {
    const vid = selection.versionId;
    if (!vid) return;
    const version = data.versions.find((v) => v.id === vid);
    if (!version) return;
    setCollapsedPrograms((prev) => {
      if (!prev.has(version.programId)) return prev;
      const next = new Set(prev);
      next.delete(version.programId);
      return next;
    });
  }, [selection.versionId, data.versions]);

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
    if (!text) return;
    if (action.kind === 'rename-program') {
      await onRenameProgram?.(action.programId, text);
    } else {
      await onRenameVersion?.(action.versionId, text);
    }
  };

  const programs = data.programs ?? [];
  // 主题按名称排序,版本在各自主题内新→旧
  const sortedPrograms = [...programs].sort((a, b) => a.name.localeCompare(b.name));
  // 防脏数据:programId 悬空的版本不能从树上消失,单列「未归属主题」分组(只读展示,不做主题操作)
  const programIds = new Set(programs.map((p) => p.id));
  const orphanVersions = sortVersionsDesc(data.versions.filter((v) => !programIds.has(v.programId)));
  const isEmpty = programs.length === 0 && data.versions.length === 0;

  /** 版本行(主题分组与未归属分组共用) */
  const renderVersion = (version: WorklogVersion) => {
    const isVersionActive = selection.versionId === version.id;
    return (
      <div key={version.id} className="ml-5">
        <div
          className={cn(
            'hover:bg-accent flex items-center gap-1 rounded-md px-2 py-1.5',
            isVersionActive && 'bg-accent',
          )}
        >
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
            {version.entries.length} 条
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
            : '还没有建设主题。先新建主题，再建版本。'}
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

/** 内联输入行(主题/版本重命名共用) */
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
