// frontend/src/components/worklog/RequirementDialog.tsx
// 新建需求弹窗:标题 + 关联项目(多选,项目来自项目字典 data.projects)。
// 创建成功后弹窗内常驻展示 r_xxx 与复制按钮;onCreated 通知父组件刷新并选中新需求。
import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { CopyIdButton } from '@/components/common/CopyIdButton';
import { toast } from '@/components/ui/toaster';
import { worklogApi } from '@/api/worklog';
import type { WorklogProject } from '@ai-task-flow/shared';

const errMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export interface RequirementCreatedResult {
  id: string;
  versionId: string;
  title: string;
}

interface RequirementDialogProps {
  open: boolean;
  versionId: string;
  versionName: string;
  /** 项目字典(仅用 name 作为关联项目选项) */
  projects: WorklogProject[];
  onClose: () => void;
  /** 创建成功后通知父组件刷新并选中新需求;弹窗保持打开以展示可复制的 id */
  onCreated?: (created: RequirementCreatedResult) => void | Promise<void>;
}

export function RequirementDialog({
  open, versionId, versionName, projects, onClose, onCreated,
}: RequirementDialogProps) {
  const [title, setTitle] = useState('');
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const projectOptions = useMemo(
    () => projects.map((p) => p.name).sort((a, b) => a.localeCompare(b)),
    [projects],
  );

  // 重新打开(或切换所属版本)时清空上一次的输入与成功态
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setSelectedProjects([]);
    setSaving(false);
    setCreatedId(null);
  }, [open, versionId]);

  const canSubmit = title.trim().length > 0 && !saving;

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      const { id } = await worklogApi.createRequirement({
        versionId,
        title: trimmed,
        ...(selectedProjects.length > 0 ? { projects: selectedProjects } : {}),
      });
      setCreatedId(id);
      toast.success(`需求已创建:${trimmed}`);
      await onCreated?.({ id, versionId, title: trimmed });
    } catch (err) {
      toast.error(`创建需求失败:${errMessage(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建需求 · {versionName}</DialogTitle>
          <DialogDescription>
            需求挂在版本「{versionName}」下,用于归组一组功能点。关联项目可留空。
          </DialogDescription>
        </DialogHeader>

        {createdId ? (
          <div className="space-y-3">
            <p className="text-sm">
              需求「{title.trim()}」已创建。把下面的 ID 复制给 AI,即可把记录写入该需求。
            </p>
            <div className="bg-muted/40 flex items-center gap-2 rounded-md border px-3 py-2">
              <span className="text-muted-foreground shrink-0 text-xs">需求 ID</span>
              <code className="flex-1 truncate font-mono text-xs">{createdId}</code>
              <CopyIdButton id={createdId} iconOnly className="text-muted-foreground shrink-0" />
            </div>
            <DialogFooter>
              <Button onClick={onClose}>关闭</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <span className="text-sm font-medium">需求标题</span>
              <Input
                autoFocus
                aria-label="需求标题"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
                placeholder="如 澳门底层数据建设"
              />
            </div>
            <div className="space-y-1.5">
              <span className="text-sm font-medium">关联项目(可选)</span>
              <MultiSelect
                options={projectOptions}
                value={selectedProjects}
                onChange={setSelectedProjects}
                placeholder="选择关联项目"
                noun="项目"
                ariaLabel="关联项目"
              />
              {projectOptions.length === 0 && (
                <p className="text-muted-foreground text-xs">
                  项目字典为空。先在「项目字典」里绑定路径或记录时传项目,这里才会有选项。
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>取消</Button>
              <Button onClick={() => void submit()} disabled={!canSubmit}>
                {saving ? '创建中…' : '创建'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
