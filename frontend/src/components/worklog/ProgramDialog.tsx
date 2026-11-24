// frontend/src/components/worklog/ProgramDialog.tsx
// 新建建设主题弹窗:名称 + 描述。创建成功后弹窗内常驻展示 g_xxx 与复制按钮,
// 并通过 onCreated 通知父组件刷新。与 VersionDialog 一致,成功后不自动关闭:
// id 是让 AI 精确引用的入口,必须让用户看得到、复制得到。
import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CopyIdButton } from '@/components/common/CopyIdButton';
import { toast } from '@/components/ui/toaster';
import { worklogApi } from '@/api/worklog';

const errMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export interface ProgramCreatedResult {
  id: string;
  name: string;
}

interface ProgramDialogProps {
  open: boolean;
  onClose: () => void;
  /** 创建成功后通知父组件刷新;弹窗保持打开以展示可复制的 id */
  onCreated?: (created: ProgramCreatedResult) => void | Promise<void>;
}

export function ProgramDialog({ open, onClose, onCreated }: ProgramDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  /** 创建成功后的主题 id;非空即进入成功态(展示 id + 复制) */
  const [createdId, setCreatedId] = useState<string | null>(null);

  // 每次重新打开视为一次新会话,清空上一次的输入与成功态
  useEffect(() => {
    if (!open) return;
    setName('');
    setDescription('');
    setSaving(false);
    setCreatedId(null);
  }, [open]);

  const canSubmit = name.trim().length > 0 && !saving;

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    const trimmedDescription = description.trim();
    // 创建与刷新分两个异常边界:创建成功后的刷新失败绝不能报成「创建失败」
    let result: { id: string } | null = null;
    setSaving(true);
    try {
      result = await worklogApi.createProgram({
        name: trimmed,
        ...(trimmedDescription ? { description: trimmedDescription } : {}),
      });
    } catch (err) {
      toast.error(`创建主题失败:${errMessage(err)}`);
    } finally {
      setSaving(false);
    }
    if (!result) return;

    setCreatedId(result.id);
    toast.success(`主题已创建:${trimmed}`);
    try {
      await onCreated?.({ id: result.id, name: trimmed });
    } catch {
      // 主题已落库:提示刷新失败即可,不得诱导用户重复创建
      toast.error('主题已创建,但列表刷新失败,请手动刷新');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建建设主题</DialogTitle>
          <DialogDescription>
            建设主题是工作记录的最高层级(如「澳门底层数据建设」),版本挂在主题下。创建后把主题 ID 给 AI,便于按主题检索。
          </DialogDescription>
        </DialogHeader>

        {createdId ? (
          <div className="space-y-3">
            <p className="text-sm">
              主题「{name.trim()}」已创建。把下面的 ID 复制给 AI,或在树里右键该主题继续建版本。
            </p>
            <div className="bg-muted/40 flex items-center gap-2 rounded-md border px-3 py-2">
              <span className="text-muted-foreground shrink-0 text-xs">主题 ID</span>
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
              <span className="text-sm font-medium">主题名</span>
              <Input
                autoFocus
                aria-label="主题名"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
                placeholder="如 澳门底层数据建设"
              />
            </div>
            <div className="space-y-1.5">
              <span className="text-sm font-medium">描述(可选)</span>
              <Textarea
                aria-label="描述(可选)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                disableAutoGrow
                placeholder="这个主题覆盖的范围"
              />
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
