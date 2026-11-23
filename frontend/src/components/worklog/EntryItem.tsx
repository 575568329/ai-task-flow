// frontend/src/components/worklog/EntryItem.tsx
// 条目卡:title/tags/date/上下文徽标/files 徽标 + detail markdown + diff 折叠 + 内联编辑/删除。
// 编辑为 partial 提交:表单外字段(diff/files)不回传即保留,不会被抹掉。
// 新模型下条目由「版本 → 需求」承载,update 不支持跨版本/需求搬移,卡片不再提供挪版本入口。
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, Trash2, Check, X, FileCode2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DiffViewer } from '@/components/DiffViewer';
import { MessageContent } from '@/components/common/MessageContent';
import { WorkStageBadge } from '@/components/common/WorkStageBadge';
import { CopyIdButton } from '@/components/common/CopyIdButton';
import { WorkStageSelect } from '@/components/common/WorkStageSelect';
import { toast } from '@/components/ui/toaster';
import { plainTextExcerpt } from '@/lib/markdownText';
import { cn } from '@/lib/utils';
import type { WorklogEntry, WorkStage } from '@ai-task-flow/shared';

interface EntryItemProps {
  entry: WorklogEntry;
  /** 上下文徽标文本(如搜索结果的「版本/需求」或跨需求视图的需求名),不传则不显示 */
  contextLabel?: string;
  /** 全局展开/收起信号：true=全部展开，false=全部收起，null/undefined=各卡自管 */
  expandAll?: boolean | null;
  onSave: (id: string, patch: { title?: string; detail?: string; tags?: string[]; stage?: WorkStage }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** 点击关联项目徽标(按该项目名筛选);不传则徽标不可交互 */
  onRelatedClick?: (name: string) => void;
}

export function EntryItem({
  entry, contextLabel, expandAll, onSave, onDelete, onRelatedClick,
}: EntryItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  // 编辑态(partial:title/detail/tags/stage)
  const [title, setTitle] = useState(entry.title);
  const [detail, setDetail] = useState(entry.detail);
  const [tagsText, setTagsText] = useState((entry.tags ?? []).join(', '));
  const [stage, setStage] = useState<WorkStage | ''>(entry.stage ?? '');

  useEffect(() => {
    if (expandAll !== null && expandAll !== undefined) setExpanded(expandAll);
  }, [expandAll]);

  const startEdit = () => {
    setExpanded(true);
    setTitle(entry.title);
    setDetail(entry.detail);
    setTagsText((entry.tags ?? []).join(', '));
    setStage(entry.stage ?? '');
    setEditing(true);
  };

  const save = async () => {
    if (!title.trim()) { toast.error('标题不能为空'); return; }
    setSaving(true);
    try {
      const tags = [...new Set(tagsText.split(/[,，]/).map((t) => t.trim()).filter(Boolean))];
      await onSave(entry.id, {
        title: title.trim(),
        detail,
        tags,
        ...(stage ? { stage } : {}),
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); }
    if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
  };

  // tags 渲染去重稳定 key
  const uniqueTags = useMemo(() => [...new Set(entry.tags ?? [])], [entry.tags]);

  return (
    <article className="group bg-card border overflow-hidden rounded-lg p-4 space-y-3">
      {editing ? (
        <div className="space-y-3" onKeyDown={onKeyDown}>
          <div className="space-y-1.5">
            <Label htmlFor={`et-title-${entry.id}`} className="text-xs">标题(一句话功能点)</Label>
            <Input
              id={`et-title-${entry.id}`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="font-medium"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`et-stage-${entry.id}`} className="text-xs">阶段（唯一标签；缺陷修改用 fix 标签）</Label>
            <WorkStageSelect
              value={stage}
              onChange={(value) => setStage(value as WorkStage | '')}
              className="w-56"
              ariaLabel="选择阶段"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`et-detail-${entry.id}`} className="text-xs">详细说明(建议格式:改了什么 1.2.3. → 为什么改 → 影响面)</Label>
            <Textarea
              id={`et-detail-${entry.id}`}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={6}
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`et-tags-${entry.id}`} className="text-xs">标签(逗号分隔:feat/fix/refactor/docs)</Label>
            <div className="flex items-center gap-2">
              <Input
                id={`et-tags-${entry.id}`}
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                className="text-sm"
              />
              <Button size="sm" onClick={save} disabled={saving || !title.trim()}>
                <Check className="size-4" /> 保存
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                <X className="size-4" /> 取消
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              仅更新表单内字段;diff 与文件引用保持原样(可由 AI 用 update_work 补充)。Ctrl+Enter 保存,Esc 取消。
            </p>
          </div>
        </div>
      ) : (
        <>
          <header className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-sm font-semibold" title={entry.title}>{entry.title}</h3>
              </div>
              <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-xs">
                <span>{entry.date}</span>
                <CopyIdButton id={entry.id} />
                <WorkStageBadge stage={entry.stage} />
                {entry.relatedProjects?.length ? (
                  <Badge variant="outline" className="text-muted-foreground text-xs">
                    关联:
                    {entry.relatedProjects.map((name) => (
                      <button
                        key={name}
                        type="button"
                        title="筛选该关联项目"
                        className="hover:text-foreground cursor-pointer transition-colors hover:underline"
                        onClick={() => onRelatedClick?.(name)}
                      >
                        {name}
                      </button>
                    ))}
                  </Badge>
                ) : null}
                {entry.pathUnmatched && (
                  <span className="text-muted-foreground/80" title="记录时的路径未匹配任何已绑定项目,可在左栏为项目绑定路径">
                    当前路径未归属项目
                  </span>
                )}
                {contextLabel && (
                  <Badge variant="outline" className="text-xs">{contextLabel}</Badge>
                )}
                {uniqueTags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <div
                className={cn(
                  'flex shrink-0 items-center gap-1 transition-opacity',
                  confirmDelete
                    ? 'opacity-100'                            // 确认删除进行中:常驻
                    : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100', // hover/键盘聚焦才显示
                )}
              >
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={startEdit}>
                  <Pencil className="size-3" /> 编辑
                </Button>
                {confirmDelete ? (
                  <>
                    <Button variant="destructive" size="sm" className="h-6 px-2 text-xs" onClick={() => onDelete(entry.id)}>
                      <Check className="size-3" /> 确认删除
                    </Button>
                    <Button variant="ghost" size="sm" className="size-6 p-0" title="取消删除" onClick={() => setConfirmDelete(false)}>
                      <X className="size-3" />
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" size="sm" className="text-destructive h-6 px-2 text-xs" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="size-3" /> 删除
                  </Button>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 shrink-0 px-2 text-xs"
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                {expanded ? '收起' : '展开'}
              </Button>
            </div>
          </header>

          {entry.files?.length ? (
            <details className="text-xs">
              <summary className="text-muted-foreground flex cursor-pointer items-center gap-1">
                <FileCode2 className="size-3.5" />
                涉及文件 ({entry.files.length})
              </summary>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {entry.files.map((f, i) => (
                  <code
                    key={`${f.path}:${f.startLine ?? i}`}
                    title={f.startLine ? `${f.path}:${f.startLine}${f.endLine && f.endLine !== f.startLine ? `-${f.endLine}` : ''}` : f.path}
                    className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs"
                  >
                    {f.path}
                    {f.startLine ? `:${f.startLine}` : ''}
                  </code>
                ))}
              </div>
            </details>
          ) : null}

          {expanded ? (
            <div className="text-sm leading-relaxed">
              <MessageContent content={entry.detail} />
            </div>
          ) : (
            <p className="text-muted-foreground line-clamp-3 text-sm">
              {entry.detail.trim() ? plainTextExcerpt(entry.detail) : '无详细说明'}
            </p>
          )}

          {expanded && entry.diff ? (
            <div>
              <button
                type="button"
                onClick={() => setDiffOpen((v) => !v)}
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
              >
                {diffOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                {diffOpen ? '收起 diff' : '展开 diff'}
              </button>
              {diffOpen && (
                <div className="mt-2 max-h-96 overflow-auto rounded-md border">
                  <DiffViewer text={entry.diff} className="p-2 text-xs" />
                </div>
              )}
            </div>
          ) : null}

          <div className="-mx-4 -mb-4 mt-3 border-t">
            <Button
              variant="ghost"
              className="text-muted-foreground hover:text-foreground h-10 w-full rounded-none text-xs"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              {expanded ? '收起' : '展开全文'}
            </Button>
          </div>
        </>
      )}
    </article>
  );
}
