// frontend/src/components/board/TaskDrawer.tsx
// 任务详情/编辑抽屉(Sheet):左编辑表单 + 右 Markdown 预览(实时反映草稿)。
// 表单 + 步骤 + 按状态的操作(派发 / 审查 approve+reject+diff / 保存 / 删除)。
// 创建模式(uiStore.creatingTask)与编辑模式(selectedTaskId)共用一个抽屉。
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Loader2,
  Terminal,
  Trash2,
  Copy,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import {
  Priority,
  stepsToMarkdown,
  buildTaskPrompt,
  type TaskDTO,
  type TaskStep,
  type TaskEnv,
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
import { MessageContent } from '@/components/chat/MessageContent';
import { toast } from '@/components/ui/toaster';
import { useConfirm } from '@/components/ui/confirm';
import { useUIStore } from '@/stores/uiStore';
import { useTaskStore } from '@/stores/taskStore';
import { usePreviewStore } from '@/stores/previewStore';
import { StepEditor } from './StepEditor';
import { RepoPathPicker } from './RepoPathPicker';
import { OpenClaudeDialog } from './OpenClaudeDialog';
import { STATUS_LABELS } from '@/lib/taskMeta';
import {
  loadShortcuts,
  eventToCombo,
  isSingleKey,
  isTypingTarget,
  isCapturing,
  formatCombo,
  type ShortcutMap,
} from '@/lib/shortcuts';

interface Draft {
  prefix: string;
  title: string;
  description: string;
  priority: Priority;
  repoPath: string;
  projectName: string;
  env: TaskEnv;
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
  env: 'pwsh',
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
    env: task.env ?? 'pwsh',
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

  const task = selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) : undefined;
  const isCreate = creatingTask || !task;
  const open = creatingTask || selectedTaskId !== null;
  // 图片预览(YARL)打开时,屏蔽抽屉的 outside-click / ESC(详见 SheetContent 注释)
  const previewOpen = usePreviewStore((s) => !!s.src);

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [openClaude, setOpenClaude] = useState(false);
  // 标题输入 ref:新建模式打开抽屉后自动聚焦,点「新建任务」即可直接输入
  const titleRef = useRef<HTMLInputElement>(null);

  // 快捷键配置(设置面板改动后重载)
  const [shortcuts, setShortcuts] = useState<ShortcutMap>(() => loadShortcuts());
  useEffect(() => {
    const reload = () => setShortcuts(loadShortcuts());
    window.addEventListener('shortcuts-changed', reload);
    return () => window.removeEventListener('shortcuts-changed', reload);
  }, []);

  // 打开/切换选中时同步草稿;不依赖 task 本身,避免 SSE 更新打断编辑。
  useEffect(() => {
    if (creatingTask) {
      setDraft(EMPTY_DRAFT);
      // 抽屉动画(~80ms)结束后聚焦标题,让新建「一步到位」可直接录入
      const timer = setTimeout(() => titleRef.current?.focus(), 80);
      return () => clearTimeout(timer);
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
        const created = await createTask({
          prefix: draft.prefix.trim(),
          title: draft.title.trim(),
          description: draft.description,
          priority: draft.priority,
          repoPath: draft.repoPath || undefined,
          projectName: draft.projectName || undefined,
          source: 'manual',
          relatedFiles,
          steps: draft.steps,
          env: draft.env,
        });
        toast.success('任务已创建,可继续编辑');
        // 不关闭抽屉:切换到新任务的编辑态,所有编辑态按钮立即可用,无需重开
        setCreatingTask(false);
        setSelectedTask(created.id);
      } else if (task) {
        await updateTask(task.id, {
          title: draft.title.trim(),
          description: draft.description,
          priority: draft.priority,
          repoPath: draft.repoPath || undefined,
          projectName: draft.projectName || undefined,
          relatedFiles,
          steps: draft.steps,
          env: draft.env,
        });
        toast.success('已保存');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // saveRef/savingRef:keydown 监听器用,始终指向最新值,避免监听器只绑一次时闭包捕获旧 draft
  const saveRef = useRef(save);
  const savingRef = useRef(saving);
  const openClaudeRef = useRef<() => void>(() => {});
  saveRef.current = save;
  savingRef.current = saving;

  // 抽屉内快捷键(配置可改):saveTask=保存,openTerminal=打开终端;仅抽屉打开时生效
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isCapturing()) return;
      const combo = eventToCombo(e);
      if (!combo) return;
      // 保存(默认 Ctrl+S,带修饰在输入框中也触发)
      if (combo === shortcuts.saveTask) {
        e.preventDefault();
        if (!savingRef.current) void saveRef.current();
        return;
      }
      // 打开终端:单键在输入框中跳过
      if (combo === shortcuts.openTerminal) {
        if (isSingleKey(combo) && isTypingTarget(e.target as HTMLElement)) return;
        e.preventDefault();
        openClaudeRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, shortcuts]);

  const { confirm } = useConfirm();

  // 打开"打开终端"弹窗(新建 / 恢复 Claude 会话);基于 draft.repoPath,未保存任务也可用
  const onOpenClaude = () => {
    if (!draft.repoPath.trim()) {
      toast.error('请先填写仓库路径');
      return;
    }
    setOpenClaude(true);
  };
  openClaudeRef.current = onOpenClaude;

  // 复制执行指令(D4 统一入口 buildTaskPrompt),不触发状态变更,便于手动粘贴
  const onCopyPrompt = async () => {
    if (!task) return;
    try {
      const prompt = buildTaskPrompt(task);
      await navigator.clipboard.writeText(prompt);
      toast.success('执行指令已复制到剪贴板');
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

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && close()}>
      <SheetContent
        side="right"
        className="flex w-[80vw] sm:max-w-none flex-col gap-0 overflow-hidden p-0"
        // 图片预览(YARL)打开时,屏蔽抽屉的 outside-click / ESC 关闭:
        // YARL 蒙版 portal 到 document.body,不在本抽屉的 content 树内 → 点击它 / 按 ESC
        // 会被 Radix 误判为"操作抽屉外部"而连带关闭抽屉(只关了抽屉、预览没关)。
        // 预览打开期间吞掉这两个事件,交由 YARL 自行关闭;预览关闭后抽屉恢复正常行为。
        onInteractOutside={(e) => {
          if (previewOpen) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (previewOpen) e.preventDefault();
        }}
      >
        {/* 顶部:标题/状态(跨三栏) */}
        <SheetHeader className="shrink-0 border-b px-4 py-3">
          <SheetTitle>{isCreate ? (draft.title.trim() || '新任务') : (task?.title ?? '任务详情')}</SheetTitle>
          <SheetDescription>
            {isCreate ? '新任务 · 填写后保存即创建' : task ? STATUS_LABELS[task.status] : ''}
          </SheetDescription>
        </SheetHeader>

        {/* 三栏:元信息(固定窄) | 步骤(flex-1) | 预览(flex-1) */}
        <div className="flex flex-1 flex-row overflow-hidden">
          {/* 栏1:元信息(字段紧凑纵向排列) */}
          <div className="bg-muted/20 flex w-[240px] shrink-0 flex-col gap-3 overflow-y-auto border-r px-3 py-3">
            <Field label="标题 *">
              <Input
                ref={titleRef}
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
              <RepoPathPicker
                value={draft.repoPath}
                onChange={(p) => patch({ repoPath: p })}
                onPicked={(path) =>
                  patch({
                    repoPath: path,
                    projectName: draft.projectName || path.split(/[\\/]/).pop() || '',
                  })
                }
              />
            </Field>
            <Field label="项目名">
              <Input
                value={draft.projectName}
                onChange={(e) => patch({ projectName: e.target.value })}
                placeholder="留空则从仓库路径提取"
              />
            </Field>
            <Field label="执行环境">
              <Select
                value={draft.env}
                onValueChange={(value) => patch({ env: value as TaskEnv })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pwsh">pwsh (PowerShell 7)</SelectItem>
                  <SelectItem value="wsl">wsl (Ubuntu)</SelectItem>
                  <SelectItem value="cmd">cmd (Windows)</SelectItem>
                </SelectContent>
              </Select>
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

        {/* 底部:操作按钮(跨三栏)。新建态统一显示编辑态按钮;
            打开终端基于 draft.repoPath 可用,复制指令/删除依赖已保存任务,未保存时禁用 */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t px-4 py-3">
          <Button
            size="sm"
            onClick={onOpenClaude}
            title={`打开终端 (${formatCombo(shortcuts.openTerminal)})`}
          >
            <Terminal className="size-4" />
            打开终端
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onCopyPrompt}
            disabled={!task}
            title={!task ? '保存后可复制执行指令' : '复制执行指令'}
          >
            <Copy className="size-4" />
            复制执行指令
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            保存
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive ml-auto"
            onClick={onDelete}
            disabled={!task}
            title={!task ? '保存后可删除' : '删除任务'}
          >
            <Trash2 className="size-4" />
            删除
          </Button>
        </div>
      </SheetContent>

      {/* 打开终端:新建 / 恢复 Claude 会话(基于 draft.repoPath;新建态也可用) */}
      <OpenClaudeDialog
        open={openClaude}
        onOpenChange={setOpenClaude}
        repoPath={draft.repoPath}
        env={draft.env}
      />
    </Sheet>
  );
}
