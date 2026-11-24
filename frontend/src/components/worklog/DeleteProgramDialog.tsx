// frontend/src/components/worklog/DeleteProgramDialog.tsx
// 删除建设主题强确认弹窗:必须手工输入完整主题名才能启用「确认删除」。
// 删除会级联该主题下全部版本与条目(后端自动快照备份),项目字典不受影响。
// 实际删除动作由父组件通过 onConfirm 注入(便于复用统一刷新/选中回退逻辑)。
import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';

const errMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface DeleteProgramDialogProps {
  open: boolean;
  programName: string;
  onClose: () => void;
  /** 执行删除;父组件负责调用 deleteProgram 与刷新。抛错时弹窗保持打开。 */
  onConfirm: () => void | Promise<void>;
}

export function DeleteProgramDialog({
  open, programName, onClose, onConfirm,
}: DeleteProgramDialogProps) {
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  // 每次打开/目标主题变化都要求重新输入,避免残留上一次的确认文本
  useEffect(() => {
    if (!open) return;
    setConfirmText('');
    setDeleting(false);
  }, [open, programName]);

  // 允许首尾空格,但必须与主题名完全一致(大小写敏感,主题名本身有语义)
  const matched = programName.length > 0 && confirmText.trim() === programName;

  const submit = async () => {
    if (!matched || deleting) return;
    setDeleting(true);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      toast.error(`删除主题失败:${errMessage(err)}`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>删除建设主题 · {programName}</DialogTitle>
          <DialogDescription>
            删除会级联移除该主题下的全部版本与条目；项目字典不受影响。
            删除前自动快照备份，不可撤销。请输入完整主题名以确认。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <span className="text-sm font-medium">输入主题名确认</span>
          <Input
            autoFocus
            aria-label="输入主题名确认"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            placeholder={programName}
          />
          {confirmText.length > 0 && !matched && (
            <p className="text-destructive text-xs">主题名不一致，无法删除。</p>
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
