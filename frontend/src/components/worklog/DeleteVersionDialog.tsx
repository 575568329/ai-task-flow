// frontend/src/components/worklog/DeleteVersionDialog.tsx
// 删除版本强确认弹窗:必须手工输入完整版本名才能启用「确认删除」。
// 删除会级联该版本下全部需求与条目(后端自动快照备份),故不提供「一键确认」。
// 实际删除动作由父组件通过 onConfirm 注入(便于复用统一刷新/选中回退逻辑)。
import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';

const errMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface DeleteVersionDialogProps {
  open: boolean;
  versionName: string;
  onClose: () => void;
  /** 执行删除;父组件负责调用 deleteVersion 与刷新。抛错时弹窗保持打开。 */
  onConfirm: () => void | Promise<void>;
}

export function DeleteVersionDialog({
  open, versionName, onClose, onConfirm,
}: DeleteVersionDialogProps) {
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  // 每次打开/目标版本变化都要求重新输入,避免残留上一次的确认文本
  useEffect(() => {
    if (!open) return;
    setConfirmText('');
    setDeleting(false);
  }, [open, versionName]);

  // 允许首尾空格,但必须与版本名完全一致(大小写敏感,版本名本身有语义)
  const matched = versionName.length > 0 && confirmText.trim() === versionName;

  const submit = async () => {
    if (!matched || deleting) return;
    setDeleting(true);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      toast.error(`删除版本失败:${errMessage(err)}`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>删除版本 · {versionName}</DialogTitle>
          <DialogDescription>
            删除会级联移除该版本下的全部需求与条目(删除前自动快照备份),不可撤销。
            请输入完整版本名以确认。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <span className="text-sm font-medium">输入版本名确认</span>
          <Input
            autoFocus
            aria-label="输入版本名确认"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            placeholder={versionName}
          />
          {confirmText.length > 0 && !matched && (
            <p className="text-destructive text-xs">版本名不一致,无法删除。</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={deleting}>取消</Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={!matched || deleting}>
            {deleting ? '删除中…' : '确认删除'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
