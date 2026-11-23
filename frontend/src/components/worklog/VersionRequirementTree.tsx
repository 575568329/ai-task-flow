// frontend/src/components/worklog/VersionRequirementTree.tsx
// 左栏:版本 → 需求树(条目在右栏)。
// 版本行:名称 / 展开收起 / 复制 id / 需求数·条目数；需求行:标题 / 关联项目徽标 / 条目数 / 复制 id。
// 项目路径三态与绑定已移出树(见 ProjectDictionaryDialog),树只保留组织层级。
// 新建/重命名/删除先给最小内联入口,强确认弹窗由后续任务补足。
import { useEffect, useState } from 'react';
import {
  ChevronDown, ChevronRight, Tag, FileText, Pencil, Trash2, Check, X, Plus,
} from 'lucide-react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CopyIdButton } from '@/components/common/CopyIdButton';
import { cn } from '@/lib/utils';
import type { WorklogData } from '@ai-task-flow/shared';

export interface RequirementSelection {
  versionId?: string;
  requirementId?: string;
}

type PendingAction =
  | { kind: 'create-version' }
  | { kind: 'rename-version'; versionId: string; current: string }
  | { kind: 'delete-version'; versionId: string }
  | { kind: 'create-requirement'; versionId: string }
  | { kind: 'rename-requirement'; versionId: string; requirementId: string; current: string }
  | { kind: 'delete-requirement'; versionId: string; requirementId: string };

interface VersionRequirementTreeProps {
  data: WorklogData;
  selection: RequirementSelection;
  onSelect: (sel: RequirementSelection) => void;
  /** 最小新建入口(完整弹窗后续任务提供);未传则该入口不渲染动作 */
  onCreateVersion?: (name: string) => Promise<void> | void;
  onRenameVersion?: (versionId: string, newName: string) => Promise<void> | void;
  onDeleteVersion?: (versionId: string) => Promise<void> | void;
  onCreateRequirement?: (versionId: string, title: string) => Promise<void> | void;
  onRenameRequirement?: (versionId: string, requirementId: string, newTitle: string) => Promise<void> | void;
  onDeleteRequirement?: (versionId: string, requirementId: string) => Promise<void> | void;
}

/** 版本条目总数(需求下条目求和) */
function countVersionEntries(version: WorklogData['versions'][number]): number {
  return version.requirements.reduce((sum, r) => sum + r.entries.length, 0);
}

export function VersionRequirementTree({
  data, selection, onSelect,
  onCreateVersion, onRenameVersion, onDeleteVersion,
  onCreateRequirement, onRenameRequirement, onDeleteRequirement,
}: VersionRequirementTreeProps) {
  /** 默认全部展开；只记录“已收起”的版本,新版本/新加载的版本天然展开。 */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [inputValue, setInputValue] = useState('');

  const toggle = (versionId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(versionId)) next.delete(versionId);
      else next.add(versionId);
      return next;
    });
  };

  // 外部选择(搜索定位/新建需求后选中)落到某版本时,自动展开被收起的版本。
  // 同时依赖 requirementId:在同一折叠版本下新建需求,versionId 不变也要展开出新行。
  useEffect(() => {
    const vid = selection.versionId;
    if (!vid) return;
    setCollapsed((prev) => {
      if (!prev.has(vid)) return prev;
      const next = new Set(prev);
      next.delete(vid);
      return next;
    });
  }, [selection.versionId, selection.requirementId]);

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
    if (action.kind === 'create-version') {
      if (text) await onCreateVersion?.(text);
    } else if (action.kind === 'rename-version') {
      if (text) await onRenameVersion?.(action.versionId, text);
    } else if (action.kind === 'delete-version') {
      await onDeleteVersion?.(action.versionId);
    } else if (action.kind === 'create-requirement') {
      if (text) await onCreateRequirement?.(action.versionId, text);
    } else if (action.kind === 'rename-requirement') {
      if (text) await onRenameRequirement?.(action.versionId, action.requirementId, text);
    } else {
      await onDeleteRequirement?.(action.versionId, action.requirementId);
    }
  };

  // 版本新→旧:数字感知排序,V8.0.10 排在 V8.0.9 前(与旧树一致)。
  const sortedVersions = [...data.versions].sort((a, b) =>
    b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' }),
  );

  return (
    <div className="space-y-0.5">
      {data.versions.length === 0 && (
        <p className="text-muted-foreground px-2 py-1 text-xs leading-relaxed">
          还没有版本。先新建版本,再建需求,记录会挂在需求下。
        </p>
      )}

      {sortedVersions.map((version) => {
        const isCollapsed = collapsed.has(version.id);
        const isVersionActive = selection.versionId === version.id && !selection.requirementId;
        const entryCount = countVersionEntries(version);
        return (
          <div key={version.id}>
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
                    onSelect={() => start({ kind: 'create-requirement', versionId: version.id })}
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
                    onSelect={() => setPending({ kind: 'delete-version', versionId: version.id })}
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

            {/* 新建版本:最小内联入口 */}
            {pending?.kind === 'rename-version' && pending.versionId === version.id && (
              <InlineInput
                value={inputValue}
                onChange={setInputValue}
                onConfirm={() => void confirmPending()}
                onCancel={cancel}
                ariaLabel="新版本名"
              />
            )}
            {pending?.kind === 'delete-version' && pending.versionId === version.id && (
              <ConfirmRow
                label={`删除版本「${version.name}」(${entryCount} 条)?`}
                onConfirm={() => void confirmPending()}
                onCancel={cancel}
              />
            )}

            {pending?.kind === 'create-requirement' && pending.versionId === version.id && (
              <div className="ml-5">
                <InlineInput
                  value={inputValue}
                  onChange={setInputValue}
                  onConfirm={() => void confirmPending()}
                  onCancel={cancel}
                  ariaLabel="新需求标题"
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
                    <div className="ml-5">
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
                    <div className="ml-5">
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
      })}

      {pending?.kind === 'create-version' ? (
        <InlineInput
          value={inputValue}
          onChange={setInputValue}
          onConfirm={() => void confirmPending()}
          onCancel={cancel}
          ariaLabel="新版本名"
        />
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground mt-1 w-full justify-start px-2 text-xs"
          onClick={() => start({ kind: 'create-version' })}
        >
          <Plus className="size-3.5" /> 新建版本
        </Button>
      )}
    </div>
  );
}

/** 二次确认行:删除类操作,首点变确认态再点执行(强确认弹窗由后续任务替换) */
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

/** 内联输入行(新建/重命名共用) */
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
