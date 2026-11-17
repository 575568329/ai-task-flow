// frontend/src/components/worklog/EntryItem.tsx
// 条目卡:title/tags/date/files 徽标 + detail markdown + diff 折叠 + 内联编辑/删除。
// 编辑为 partial 提交:表单外字段(diff/files)不回传即保留,不会被抹掉。
import { useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, Trash2, Check, X, FileCode2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DiffViewer } from '@/components/DiffViewer';
import { MessageContent } from '@/components/common/MessageContent';
import type { WorklogEntry } from '@ai-task-flow/shared';

interface EntryItemProps {
  entry: WorklogEntry;
  /** 该条目所属项目的全部版本(编辑表单挪版本下拉用) */
  projectVersions: string[];
  currentProject: string;
  currentVersion: string;
  onSave: (id: string, patch: { title?: string; detail?: string; tags?: string[]; version?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function EntryItem({
  entry, projectVersions, currentProject, currentVersion, onSave, onDelete,
}: EntryItemProps) {
  const [editing, setEditing] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  // 编辑态(partial:title/detail/tags/挪版本)
  const [title, setTitle] = useState(entry.title);
  const [detail, setDetail] = useState(entry.detail);
  const [tagsText, setTagsText] = useState((entry.tags ?? []).join(', '));
  const [moveTo, setMoveTo] = useState('');

  const startEdit = () => {
    setTitle(entry.title);
    setDetail(entry.detail);
    setTagsText((entry.tags ?? []).join(', '));
    setMoveTo('');
    setEditing(true);
  };

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const tags = tagsText.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
      await onSave(entry.id, {
        title: title.trim(),
        detail,
        tags,
        ...(moveTo && moveTo !== currentVersion ? { version: moveTo } : {}),
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="bg-card border rounded-lg p-4 space-y-3">
      {editing ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="font-medium" autoFocus />
            <select
              value={moveTo || currentVersion}
              onChange={(e) => setMoveTo(e.target.value)}
              className="bg-background border rounded-md px-2 py-1.5 text-sm"
              title="移动到其他版本"
            >
              {projectVersions.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
              <option value={`+${currentProject}`}>＋ 新建版本…</option>
            </select>
          </div>
          {moveTo.startsWith('+') && (
            <Input
              placeholder="新版本名,如 v1.3.0"
              onChange={(e) => setMoveTo(e.target.value)}
              className="text-sm"
              autoFocus
            />
          )}
          <Textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={6} className="font-mono text-sm" />
          <div className="flex items-center gap-2">
            <Input
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="标签,逗号分隔(feat/fix/refactor/docs)"
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
            仅更新表单内字段;diff 与文件引用保持原样(可由 AI 用 update_work 补充)。人工记录默认无 diff。
          </p>
        </div>
      ) : (
        <>
          <header className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{entry.title}</h3>
            <span className="text-muted-foreground text-xs">{entry.date}</span>
            {entry.tags?.map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
            ))}
            {entry.updatedAt > entry.createdAt && (
              <span className="text-muted-foreground text-xs">(已编辑)</span>
            )}
            <span className="flex-1" />
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={startEdit}>
              <Pencil className="size-3" /> 编辑
            </Button>
            {confirmDelete ? (
              <>
                <Button variant="destructive" size="sm" className="h-6 px-2 text-xs" onClick={() => onDelete(entry.id)}>
                  <Check className="size-3" /> 确认删除
                </Button>
                <Button variant="ghost" size="sm" className="size-6 p-0" onClick={() => setConfirmDelete(false)}>
                  <X className="size-3" />
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" className="text-destructive h-6 px-2 text-xs" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-3" /> 删除
              </Button>
            )}
          </header>

          {entry.files?.length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <FileCode2 className="text-muted-foreground size-3.5" />
              {entry.files.map((f) => (
                <code
                  key={f.path}
                  title={f.startLine ? `${f.path}:${f.startLine}${f.endLine && f.endLine !== f.startLine ? `-${f.endLine}` : ''}` : f.path}
                  className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs"
                >
                  {f.path}
                  {f.startLine ? `:${f.startLine}` : ''}
                </code>
              ))}
            </div>
          ) : null}

          <div className="text-sm leading-relaxed">
            <MessageContent content={entry.detail} />
          </div>

          {entry.diff ? (
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
        </>
      )}
    </article>
  );
}
