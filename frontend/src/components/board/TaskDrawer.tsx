// frontend/src/components/board/TaskDrawer.tsx
// 任务详情/编辑抽屉(Sheet):左编辑表单 + 右 Markdown 预览(实时反映草稿)。
// 表单 + 步骤 + 按状态的操作(派发 / 审查 approve+reject+diff / 保存 / 删除)。
// 创建模式(uiStore.creatingTask)与编辑模式(selectedTaskId)共用一个抽屉。
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Loader2,
  FolderOpen,
  Rocket,
  Check,
  X,
  Trash2,
  FileDiff,
  Copy,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import {
  Priority,
  TaskStatus,
  stepsToMarkdown,
  buildClaudeCodePrompt,
  type TaskDTO,
  type TaskStep,
} from '@ai-task-flow/shared';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DiffViewer } from '@/components/DiffViewer';
import { MessageContent } from '@/components/chat/MessageContent';
import { toast } from '@/components/ui/toaster';
import { useConfirm } from '@/components/ui/confirm';
import { useUIStore } from '@/stores/uiStore';
import { useTaskStore } from '@/stores/taskStore';
import { taskApi, systemApi } from '@/api/task';
import { StepEditor } from './StepEditor';
import { STATUS_LABELS } from '@/lib/taskMeta';

interface Draft {
  prefix: string;
  title: string;
  description: string;
  priority: Priority;
  repoPath: string;
  projectName: string;
  relatedFilesText: string;
  steps: TaskStep[];
}

const EMPTY_DRAFT: Draft = {
  prefix: '',
  title: '',
  description: '',
  priority: Priority.P2,
  repoPath: '',
  projectName: '',
  relatedFilesText: '',
  steps: [],
};

function taskToDraft(task: TaskDTO): Draft {
  return {
    prefix: '',
    title: task.title,
    description: task.description,
    priority: task.priority,
    repoPath: task.repoPath ?? '',
    projectName: task.projectName ?? '',
    relatedFilesText: task.relatedFiles.join('\n'),
    steps: task.steps,
  };
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-muted-foreground text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
}

export function TaskDrawer() {
  const selectedTaskId = useUIStore((s) => s.selectedTaskId);
  const creatingTask = useUIStore((s) => s.creatingTask);
  const setSelectedTask = useUIStore((s) => s.setSelectedTask);
  const setCreatingTask = useUIStore((s) => s.setCreatingTask);

  const tasks = useTaskStore((s) => s.tasks);
  const createTask = useTaskStore((s) => s.create);
  const updateTask = useTaskStore((s) => s.update);
  const removeTask = useTaskStore((s) => s.remove);
  const dispatchTask = useTaskStore((s) => s.dispatch);

  const task = selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) : undefined;
  const isCreate = creatingTask || !task;
  const open = creatingTask || selectedTaskId !== null;

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffText, setDiffText] = useState('');
  const [showPreview, setShowPreview] = useState(true);

  // 打开/切换选中时同步草稿;不依赖 task 本身,避免 SSE 更新打断编辑。
  useEffect(() => {
    if (creatingTask) {
      setDraft(EMPTY_DRAFT);
    } else if (selectedTaskId) {
      const current = tasks.find((t) => t.id === selectedTaskId);
      if (current) setDraft(taskToDraft(current));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creatingTask, selectedTaskId]);

  // 实时预览:本地按草稿拼 Markdown(预览顺序 = 编辑器顺序 = 给 AI 的顺序)
  const markdown = useMemo(() => {
    const lines = [
      `# ${draft.title || '(无标题)'}`,
      '',
      `**优先级**: ${draft.priority}`,
    ];
    if (!isCreate && task) lines.push(`**状态**: ${STATUS_LABELS[task.status]}`);
    if (task?.source === 'web') {
      lines.push(`**来源**: 网页剪藏`);
      if (task.sourceUrl) lines.push(`**网页地址**: ${task.sourceUrl}`);
    }
    if (draft.projectName) lines.push(`**项目**: ${draft.projectName}`);
    if (draft.repoPath) lines.push(`**仓库路径**: \`${draft.repoPath}\``);
    lines.push('', '## 描述', '', draft.description || '（无描述）', '');
    if (draft.steps.length > 0) {
      lines.push('## 任务步骤', '', stepsToMarkdown(draft.steps, 3));
    }
    return lines.join('\n');
  }, [draft, task, isCreate]);

  const close = () => {
    setSelectedTask(null);
    setCreatingTask(false);
  };

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const onPickDir = async () => {
    try {
      const { path } = await systemApi.selectDirectory();
      if (path) {
        patch({
          repoPath: path,
          projectName: draft.projectName || path.split(/[\\/]/).pop() || '',
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '选择目录失败');
    }
  };

  const parseRelatedFiles = () =>
    draft.relatedFilesText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

  const save = async () => {
    if (!draft.title.trim()) {
      toast.error('请填写标题');
      return;
    }
    setSaving(true);
    const relatedFiles = parseRelatedFiles();
    try {
      if (isCreate) {
        await createTask({
          prefix: draft.prefix.trim(),
          title: draft.title.trim(),
          description: draft.description,
          priority: draft.priority,
          repoPath: draft.repoPath || undefined,
          projectName: draft.projectName || undefined,
          source: 'manual',
          relatedFiles,
          steps: draft.steps,
        });
        toast.success('任务已创建');
        close();
      } else if (task) {
        await updateTask(task.id, {
          title: draft.title.trim(),
          description: draft.description,
          priority: draft.priority,
          repoPath: draft.repoPath || undefined,
          projectName: draft.projectName || undefined,
          relatedFiles,
          steps: draft.steps,
        });
        toast.success('已保存');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const onDispatch = async () => {
    if (!task) return;
    try {
      await dispatchTask(task.id);
      toast.success('已派发,Claude 指令已复制到剪贴板');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '派发失败');
    }
  };

  const { confirm, prompt: promptInput } = useConfirm();

  // 复制派发指令(任务 markdown 的 Claude Code 拉取指令),不触发状态变更
  const onCopyPrompt = async () => {
    if (!task) return;
    try {
      const prompt = buildClaudeCodePrompt(task);
      await navigator.clipboard.writeText(prompt);
      toast.success('派发指令已复制到剪贴板');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '复制失败');
    }
  };

  const onDelete = async () => {
    if (!task) return;
    if (
      !(await confirm({
        title: '删除任务',
        description: `确认删除「${task.title}」?此操作不可撤销。`,
        confirmText: '删除',
        variant: 'destructive',
      }))
    )
      return;
    try {
      await removeTask(task.id);
      toast.success('已删除');
      close();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败');
    }
  };

  const onShowDiff = async () => {
    if (!task) return;
    try {
      const res = await taskApi.getDiff(task.id);
      setDiffText(res.diff || '(无改动)');
      setDiffOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '获取 diff 失败');
    }
  };

  const onApprove = async () => {
    if (!task) return;
    try {
      await taskApi.approve(task.id);
      toast.success('已通过,分支已合并');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '通过失败');
    }
  };

  const onReject = async () => {
    if (!task) return;
    const reason = await promptInput({
      title: '驳回任务',
      description: '请输入驳回原因',
      placeholder: '驳回原因…',
    });
    if (reason === null) return;
    if (!reason.trim()) {
      toast.error('驳回必须填写原因');
      return;
    }
    try {
      await taskApi.reject(task.id, { reason: reason.trim() });
      toast.success('已驳回');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '驳回失败');
    }
  };

  // 只有 TODO 态可派发(PLANNING 是从未使用的死状态,已从枚举删除)
  const canDispatch = !isCreate && task?.status === TaskStatus.TODO;
  const canReview = !isCreate && task?.status === TaskStatus.REVIEW;

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && close()}>
      <SheetContent
        side="right"
        className="flex w-[80vw] sm:max-w-none flex-col gap-0 overflow-hidden p-0"
      >
        {/* 顶部:标题/状态(跨三栏) */}
        <SheetHeader className="shrink-0 border-b px-4 py-3">
          <SheetTitle>{isCreate ? '新建任务' : (task?.title ?? '任务详情')}</SheetTitle>
          <SheetDescription>
            {isCreate ? '仅标题必填,其余可留空' : task ? STATUS_LABELS[task.status] : ''}
          </SheetDescription>
        </SheetHeader>

        {/* 三栏:元信息(固定窄) | 步骤(flex-1) | 预览(flex-1) */}
        <div className="flex flex-1 flex-row overflow-hidden">
          {/* 栏1:元信息(字段紧凑纵向排列) */}
          <div className="bg-muted/20 flex w-[240px] shrink-0 flex-col gap-3 overflow-y-auto border-r px-3 py-3">
            <Field label="标题 *">
              <Input
                value={draft.title}
                onChange={(e) => patch({ title: e.target.value })}
                placeholder="任务标题(必填)"
              />
            </Field>
            <Field label="描述">
              <Textarea
                value={draft.description}
                onChange={(e) => patch({ description: e.target.value })}
                placeholder="任务的详细描述"
                className="min-h-16"
              />
            </Field>
            <Field label="优先级">
              <Select
                value={draft.priority}
                onValueChange={(value) => patch({ priority: value as Priority })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={Priority.P0}>P0 紧急</SelectItem>
                  <SelectItem value={Priority.P1}>P1 高</SelectItem>
                  <SelectItem value={Priority.P2}>P2 普通</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="仓库路径">
              <div className="flex gap-2">
                <Input
                  value={draft.repoPath}
                  onChange={(e) => patch({ repoPath: e.target.value })}
                  placeholder="/path/to/repo"
                />
                <Button variant="outline" size="icon" onClick={onPickDir} aria-label="选择目录">
                  <FolderOpen className="size-4" />
                </Button>
              </div>
            </Field>
            <Field label="项目名">
              <Input
                value={draft.projectName}
                onChange={(e) => patch({ projectName: e.target.value })}
                placeholder="留空则从仓库路径提取"
              />
            </Field>
            <Field label="关联文件">
              <Textarea
                value={draft.relatedFilesText}
                onChange={(e) => patch({ relatedFilesText: e.target.value })}
                placeholder={'src/a.ts\nsrc/b.ts'}
                className="min-h-12 font-mono text-xs"
              />
            </Field>
            {isCreate && (
              <Field label="前缀(可选)">
                <Input
                  value={draft.prefix}
                  onChange={(e) => patch({ prefix: e.target.value })}
                  placeholder="留空自动用 TASK"
                />
              </Field>
            )}
          </div>

          {/* 栏2:步骤(与预览平分剩余宽度;收起预览时独占) */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-h-11 shrink-0 items-center gap-1 border-b px-3 py-2">
              {!showPreview && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => setShowPreview(true)}
                  aria-label="展开预览"
                >
                  <ChevronLeft className="size-4" />
                </Button>
              )}
              <span className="text-sm font-semibold">步骤</span>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3">
              <StepEditor steps={draft.steps} onChange={(steps) => patch({ steps })} />
            </div>
          </div>

          {/* 栏3:预览(实时 Markdown;与步骤平分剩余宽度) */}
          {showPreview && (
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-l">
              <div className="flex min-h-11 shrink-0 items-center gap-1 border-b px-3 py-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => setShowPreview(false)}
                  aria-label="收起预览"
                >
                  <ChevronRight className="size-4" />
                </Button>
                <span className="text-sm font-semibold">预览</span>
              </div>
              <div className="flex-1 overflow-y-auto px-3 py-3">
                <MessageContent content={markdown} />
              </div>
            </div>
          )}
        </div>

        {/* 底部:操作按钮(跨三栏) */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t px-4 py-3">
          {canReview && (
            <>
              <Button variant="outline" size="sm" onClick={onShowDiff}>
                <FileDiff className="size-4" />
                Diff
              </Button>
              <Button size="sm" onClick={onApprove}>
                <Check className="size-4" />
                通过
              </Button>
              <Button variant="destructive" size="sm" onClick={onReject}>
                <X className="size-4" />
                驳回
              </Button>
            </>
          )}
          {canDispatch && (
            <Button size="sm" onClick={onDispatch}>
              <Rocket className="size-4" />
              派发
            </Button>
          )}
          {!isCreate && task && (
            <Button variant="outline" size="sm" onClick={onCopyPrompt}>
              <Copy className="size-4" />
              复制派发指令
            </Button>
          )}
          <Button size="sm" onClick={save} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {isCreate ? '创建' : '保存'}
          </Button>
          {!isCreate && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive ml-auto"
              onClick={onDelete}
            >
              <Trash2 className="size-4" />
              删除
            </Button>
          )}
        </div>
      </SheetContent>

      <Dialog open={diffOpen} onOpenChange={setDiffOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>代码变更 (diff)</DialogTitle>
          </DialogHeader>
          <DiffViewer text={diffText} className="max-h-[60vh]" />
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}
