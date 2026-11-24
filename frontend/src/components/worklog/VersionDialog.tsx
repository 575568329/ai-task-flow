// frontend/src/components/worklog/VersionDialog.tsx
// 新建版本弹窗:所属主题(必选)+ 名称 + 描述。创建成功后弹窗内常驻展示 v_xxx 与复制按钮,
// 并通过 onCreated 通知父组件刷新、把选择落到新版本(树对新版本天然展开)。
// 不在创建成功后自动关闭:id 是让 AI 精确引用的入口,必须让用户看得到、复制得到。
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
import type { WorklogProgram } from '@ai-task-flow/shared';

const errMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export interface VersionCreatedResult {
  id: string;
  name: string;
}

interface VersionDialogProps {
  open: boolean;
  /** 主题列表(来自全树 data.programs):版本必须归属其一 */
  programs: WorklogProgram[];
  /** 从主题行右键进入时预选该主题;未传则只有一个主题时自动选中 */
  defaultProgramId?: string;
  onClose: () => void;
  /** 创建成功后通知父组件刷新并展开/选中该版本;弹窗保持打开以展示可复制的 id */
  onCreated?: (created: VersionCreatedResult) => void | Promise<void>;
}

export function VersionDialog({
  open, programs, defaultProgramId, onClose, onCreated,
}: VersionDialogProps) {
  const [name, setName] = useState('');
  const [programId, setProgramId] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  /** 创建成功后的版本 id;非空即进入成功态(展示 id + 复制) */
  const [createdId, setCreatedId] = useState<string | null>(null);

  // 每次重新打开视为一次新会话,清空上一次的输入与成功态。
  // 预选优先级:主题行右键带入的 id > 仅有一个主题时自动选中 > 空(强制用户选择)。
  // 不依赖 programs 引用:创建成功后父组件 refresh 会换新数组,依赖它会把成功态(可复制 id)擦掉。
  useEffect(() => {
    if (!open) return;
    setName('');
    setProgramId(defaultProgramId ?? (programs.length === 1 ? programs[0].id : ''));
    setDescription('');
    setSaving(false);
    setCreatedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在意「打开/预选变化」这一次会话
  }, [open, defaultProgramId]);

  // 弹窗打开期间主题被外部删除:清空失效预选,避免提交时打到已不存在的主题
  useEffect(() => {
    if (!open || !programId) return;
    if (!programs.some((p) => p.id === programId)) setProgramId('');
  }, [open, programId, programs]);

  const canSubmit = name.trim().length > 0 && programId.length > 0 && !saving;

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || !programId || saving) return;
    const trimmedDescription = description.trim();
    // 创建与刷新分两个异常边界:创建成功后的刷新失败绝不能报成「创建失败」
    let result: { id: string } | null = null;
    setSaving(true);
    try {
      result = await worklogApi.createVersion({
        name: trimmed,
        programId,
        ...(trimmedDescription ? { description: trimmedDescription } : {}),
      });
    } catch (err) {
      toast.error(`创建版本失败:${errMessage(err)}`);
    } finally {
      setSaving(false);
    }
    if (!result) return;

    setCreatedId(result.id);
    toast.success(`版本已创建:${trimmed}`);
    try {
      await onCreated?.({ id: result.id, name: trimmed });
    } catch {
      // 版本已落库:提示刷新失败即可,不得诱导用户重复创建
      toast.error('版本已创建,但列表刷新失败,请手动刷新');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建版本</DialogTitle>
          <DialogDescription>
            版本归属建设主题(如「澳门底层数据建设」)。创建后把版本 ID 给 AI,即可在其下精确记录。
          </DialogDescription>
        </DialogHeader>

        {createdId ? (
          <div className="space-y-3">
            <p className="text-sm">
              版本「{name.trim()}」已创建。把下面的 ID 复制给 AI,或在树里右键该版本继续建需求。
            </p>
            <div className="bg-muted/40 flex items-center gap-2 rounded-md border px-3 py-2">
              <span className="text-muted-foreground shrink-0 text-xs">版本 ID</span>
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
              <span className="text-sm font-medium">所属主题</span>
              {programs.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  还没有建设主题。请先在左侧新建主题,再回来建版本。
                </p>
              ) : (
                <select
                  aria-label="所属主题"
                  value={programId}
                  onChange={(e) => setProgramId(e.target.value)}
                  className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                >
                  <option value="">请选择主题</option>
                  {programs.map((program) => (
                    <option key={program.id} value={program.id}>{program.name}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="space-y-1.5">
              <span className="text-sm font-medium">版本名</span>
              <Input
                autoFocus
                aria-label="版本名"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
                placeholder="如 V8.0.9"
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
                placeholder="这一版主要做什么"
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
