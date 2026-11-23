// frontend/src/components/worklog/ProjectPathDialog.tsx
// 项目路径绑定弹窗:一行一个绝对路径整体保存;已绑定路径可就地解绑。
// 组件自持 API 调用与 toast,成功后通过 onChanged 通知父组件重拉树。
import { useEffect, useState } from 'react';
import { Unlink } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toaster';
import { worklogApi } from '@/api/worklog';
import { cn } from '@/lib/utils';

interface ProjectPathDialogProps {
  project: string;
  paths: string[];
  missingPaths?: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 绑定/解绑成功后通知父组件刷新树 */
  onChanged?: () => void | Promise<void>;
}

const errMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function ProjectPathDialog({
  project, paths, missingPaths, open, onOpenChange, onChanged,
}: ProjectPathDialogProps) {
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [unbinding, setUnbinding] = useState<string | null>(null);
  /** 用户是否在本地编辑过文本域:编辑后服务端刷新不得覆盖未保存输入 */
  const [dirty, setDirty] = useState(false);

  const pathsKey = paths.join('\n');

  // 每次打开视为新会话,清除编辑标记(下一次服务端数据可正常回填)
  useEffect(() => {
    if (open) setDirty(false);
  }, [open]);

  // 仅在用户未编辑时用服务端路径回填。解绑触发的 refresh 不会抹掉刚敲的新行。
  useEffect(() => {
    if (open && !dirty) setDraft(pathsKey);
  }, [open, pathsKey, dirty]);

  const save = async () => {
    const list = draft.split('\n').map((line) => line.trim()).filter(Boolean);
    // 空文本域 + 已有绑定 = 清空全部绑定:破坏性操作必须二次确认(整体保存语义下不能静默清空)
    if (
      list.length === 0
      && paths.length > 0
      && !window.confirm('路径已清空，保存会解除该项目的全部路径绑定，确定继续？')
    ) {
      return;
    }
    setSaving(true);
    try {
      await worklogApi.bindPaths(project, list);
      setDirty(false);
      toast.success('路径已绑定');
      await onChanged?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(`绑定失败:${errMessage(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const unbind = async (target: string) => {
    setUnbinding(target);
    try {
      await worklogApi.unbindPath(project, target);
      // 本地同步移除,父组件 refresh 落定前后的文本域都保持一致
      setDraft((prev) => prev.split('\n').filter((line) => line.trim() !== target).join('\n'));
      toast.success('路径已解绑');
      await onChanged?.();
    } catch (err) {
      toast.error(`解绑失败:${errMessage(err)}`);
    } finally {
      setUnbinding(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>绑定路径 · {project}</DialogTitle>
          <DialogDescription>
            一行一个绝对路径。记录时 AI 会按所在目录自动归属到项目;同一路径只能被一个项目占用。
          </DialogDescription>
        </DialogHeader>

        {paths.length > 0 && (
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs">已绑定路径</p>
            {paths.map((path) => {
              const isMissing = missingPaths?.includes(path) ?? false;
              return (
                <div key={path} className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
                  <span
                    className={cn('flex-1 truncate', isMissing && 'text-destructive')}
                    title={isMissing ? '路径不存在' : path}
                  >
                    {path}
                  </span>
                  {isMissing && <span className="text-destructive shrink-0">路径不存在</span>}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 shrink-0 px-2 text-xs"
                    disabled={unbinding === path}
                    onClick={() => void unbind(path)}
                  >
                    <Unlink className="size-3" />
                    {unbinding === path ? '解绑中…' : '解绑'}
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        <Textarea
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
          rows={6}
          disableAutoGrow
          aria-label="项目路径"
          placeholder={'D:\\xunfei\\资源加工平台\nD:\\xunfei\\另一仓库'}
          className="font-mono text-xs"
        />

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
