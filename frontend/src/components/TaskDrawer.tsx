// frontend/src/components/TaskDrawer.tsx
import { useState, useEffect, useMemo, useRef } from 'react';
import { TaskStatus, Priority, stepsToMarkdown, buildClaudeCodePrompt, type TaskDTO, type TaskStep } from '@ai-task-flow/shared';
import { Drawer } from './ui/Drawer';
import { Button } from './ui/Button';
import { Input, Textarea } from './ui/Input';
import { Select } from './ui/Select';
import { Tag } from './ui/Tag';
import { DiffViewer } from './DiffViewer';
import { StepEditor } from './StepEditor';
import { MarkdownPreview } from './MarkdownPreview';
import { toast } from './ui/Toaster';
import { taskApi, systemApi } from '@/api/task';
import { useTaskStore } from '@/stores/taskStore';
import { useUIStore } from '@/stores/uiStore';
import { STATUS_LABELS, STATUS_COLORS, PRIORITY_COLORS } from '@/lib/taskMeta';
import { ChevronRight, ChevronLeft, Copy, FolderOpen, Send } from 'lucide-react';

export function TaskDrawer() {
  const selectedId = useUIStore((s) => s.selectedTaskId);
  const setSelectedTask = useUIStore((s) => s.setSelectedTask);
  const creatingTask = useUIStore((s) => s.creatingTask);
  const setCreatingTask = useUIStore((s) => s.setCreatingTask);
  const tasks = useTaskStore((s) => s.tasks);
  const update = useTaskStore((s) => s.update);
  const remove = useTaskStore((s) => s.remove);
  const upsert = useTaskStore((s) => s.upsert);
  const create = useTaskStore((s) => s.create);

  const existingTask = tasks.find((t) => t.id === selectedId) ?? null;
  // 创建模式:构造一张空白任务作为初始表单
  const task = creatingTask ? EMPTY_TASK : existingTask;
  const open = !!task;

  function close() {
    if (creatingTask) setCreatingTask(false);
    else setSelectedTask(null);
  }

  return (
    <Drawer
      open={open}
      onClose={close}
      width="80%"
      title={
        task &&
        (creatingTask ? (
          <span className="font-mono text-sm">新建任务</span>
        ) : (
          <span className="flex items-center gap-2">
            <span className="font-mono text-sm">{task.id}</span>
            <Tag color={STATUS_COLORS[task.status]} filled>
              {STATUS_LABELS[task.status]}
            </Tag>
          </span>
        ))
      }
    >
      {task && (
        <TaskDrawerBody
          // 切换创建/编辑或不同任务时,强制重建表单状态
          key={creatingTask ? '__new__' : task.id}
          task={task}
          creating={creatingTask}
          onSave={async (data) => {
            await update(task.id, data);
            toast.success('已保存');
            // 延迟关闭抽屉，确保 toast 能显示出来
            setTimeout(() => setSelectedTask(null), 500);
          }}
          onCreate={async (data) => {
            const created = await create(data);
            toast.success('任务创建成功');
            setCreatingTask(false);
            setSelectedTask(created.id);
          }}
          onDelete={async () => {
            await remove(task.id);
            toast.success('已删除');
            setSelectedTask(null);
          }}
          onApprove={async () => {
            const updated = await taskApi.approve(task.id, { mergeStrategy: 'keep_branch' });
            upsert(updated);
            toast.success('已通过审核');
          }}
          onReject={async (reason) => {
            const updated = await taskApi.reject(task.id, { reason });
            upsert(updated);
            toast.success('已打回');
          }}
        />
      )}
    </Drawer>
  );
}

/** 创建模式下的空白任务模板 */
const EMPTY_TASK: TaskDTO = {
  id: '',
  title: '',
  description: '',
  status: TaskStatus.TODO,
  priority: Priority.P1,
  repoPath: undefined,
  projectName: undefined,
  relatedFiles: [],
  steps: [],
  createdAt: '',
  updatedAt: '',
};

// __CONTINUE_HERE__

interface BodyProps {
  task: TaskDTO;
  creating: boolean;
  onSave: (data: Partial<TaskDTO>) => Promise<void>;
  onCreate: (data: any) => Promise<void>;
  onDelete: () => Promise<void>;
  onApprove: () => Promise<void>;
  onReject: (reason: string) => Promise<void>;
}

function TaskDrawerBody({ task, creating, onSave, onCreate, onDelete, onApprove, onReject }: BodyProps) {
  const [prefix, setPrefix] = useState('WS');
  const [title, setTitle] = useState(task.title);
  const [titleTouched, setTitleTouched] = useState(false);
  const [description, setDescription] = useState(task.description);
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [repoPath, setRepoPath] = useState(task.repoPath || '');
  const [projectName, setProjectName] = useState(task.projectName || '');
  const [steps, setSteps] = useState<TaskStep[]>(task.steps || []);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [pathValid, setPathValid] = useState<boolean | null>(null);
  const [descUploading, setDescUploading] = useState(false);
  const descRef = useRef<HTMLTextAreaElement>(null);

  const isNewTask = creating;

  // 切换任务时同步表单
  useEffect(() => {
    setTitle(task.title);
    setTitleTouched(false);
    setDescription(task.description);
    setStatus(task.status);
    setPriority(task.priority);
    setRepoPath(task.repoPath || '');
    setProjectName(task.projectName || '');
    setSteps(task.steps || []);
    setRejectReason('');
    setPathValid(null);
  }, [task.id]);

  async function wrap(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch {
      // 错误已 toast
    } finally {
      setBusy(false);
    }
  }

  async function checkProjectPath(overridePath?: string) {
    const target = (overridePath ?? repoPath).trim();
    if (!target) {
      setPathValid(null);
      return;
    }

    try {
      const res = await fetch('/api/projects/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: target }),
      });

      const data = await res.json();
      if (data.valid) {
        setProjectName(data.projectName);
        setPathValid(true);
        toast.success('项目路径有效');
      } else {
        setPathValid(false);
        toast.error('路径不是git仓库');
      }
    } catch {
      setPathValid(false);
      toast.error('检查路径失败');
    }
  }

  // 描述区粘贴图片:上传到后端并把 ![](url) 插入到光标位置
  async function handleDescriptionPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData.items;
    let imageFile: File | null = null;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        imageFile = items[i].getAsFile();
        break;
      }
    }
    if (!imageFile) return; // 不是图片,走默认粘贴

    e.preventDefault();
    setDescUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', imageFile);
      const res = await fetch('/api/upload/image', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error(`上传失败: ${res.status}`);
      const data = await res.json();
      // 图片 URL 必须是绝对路径,因为会被 Claude Code 通过 MCP 拉走显示
      const url = `${window.location.origin}${data.url}`;

      // 在光标位置插入 markdown 图片语法
      const textarea = descRef.current;
      const insert = `\n![图片](${url})\n`;
      if (textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const next = description.slice(0, start) + insert + description.slice(end);
        setDescription(next);
        // 光标移到插入文本之后(下一帧再设置,等 React 渲染完)
        requestAnimationFrame(() => {
          textarea.focus();
          textarea.setSelectionRange(start + insert.length, start + insert.length);
        });
      } else {
        setDescription(description + insert);
      }
      toast.success('图片已插入');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '图片上传失败');
    } finally {
      setDescUploading(false);
    }
  }

  // __CONTINUE_HERE__

  const markdown = useMemo(() => {
    const lines = [
      `# ${title || '(无标题)'}`,
      '',
      `**优先级**: ${priority}`,
      `**状态**: ${STATUS_LABELS[status]}`,
    ];

    if (projectName) {
      lines.push(`**项目**: ${projectName}`);
    }
    if (repoPath) {
      lines.push(`**仓库路径**: \`${repoPath}\``);
    }

    lines.push('', '## 描述', '', description || '（无描述）', '');

    if (steps.length > 0) {
      lines.push('## 任务步骤', '');
      // 复用 shared：预览顺序 = 编辑器顺序 = 给 AI 的 Markdown 顺序
      lines.push(stepsToMarkdown(steps));
    }

    return lines.join('\n');
  }, [title, description, priority, status, projectName, repoPath, steps]);

  return (
    <div className="flex h-full gap-4">
      {/* 左侧:编辑区(纵向布局,顶部表单滚动 + 底部操作固定) */}
      <div className={`flex flex-1 flex-col overflow-hidden ${showPreview ? 'pr-2' : ''}`}>
        {/* 顶部:可滚动表单区 */}
        <div className="flex-1 overflow-y-auto pr-1">
          <div className="flex flex-col gap-4 pb-4">
            {isNewTask && (
              <Section label="ID 前缀">
                <Input
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value.toUpperCase())}
                  placeholder="WS / BUG / FEAT"
                />
              </Section>
            )}

          <Section label="标题" required>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setTitleTouched(true)}
              placeholder="任务标题"
              aria-invalid={titleTouched && !title.trim()}
              style={
                titleTouched && !title.trim()
                  ? { borderColor: 'var(--error-8)' }
                  : undefined
              }
            />
            {titleTouched && !title.trim() && (
              <span className="mt-1 text-xs" style={{ color: 'var(--error-8)' }}>
                标题不能为空
              </span>
            )}
          </Section>

          <Section label={descUploading ? '描述(图片上传中…)' : '描述(可直接粘贴图片)'}>
            <Textarea
              ref={descRef}
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onPaste={handleDescriptionPaste}
              placeholder="详细描述...(支持粘贴图片,自动上传并插入 markdown)"
            />
          </Section>

          <div className="grid grid-cols-2 gap-3">
            <Section label="状态">
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
                options={Object.values(TaskStatus).map((s) => ({ label: STATUS_LABELS[s], value: s }))}
              />
            </Section>
            <Section label="优先级">
              <div className="flex items-center gap-2">
                <Select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Priority)}
                  options={Object.values(Priority).map((p) => ({ label: p, value: p }))}
                  style={{ color: PRIORITY_COLORS[priority], fontWeight: 600 }}
                />
                <Tag color={PRIORITY_COLORS[priority]} filled>
                  {priority}
                </Tag>
              </div>
            </Section>
          </div>

          <Section label="项目路径(可选)">
            <div className="flex gap-2">
              <Input
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                onBlur={() => checkProjectPath()}
                placeholder="点「浏览」选择,或直接粘贴路径"
              />
              <button
                type="button"
                onClick={async () => {
                  try {
                    const { path } = await systemApi.selectDirectory();
                    if (path) {
                      setRepoPath(path);
                      await checkProjectPath();
                    }
                  } catch (error) {
                    toast.error('打开文件夹选择器失败');
                  }
                }}
                className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-3 py-2 text-sm transition-fast hover:opacity-80"
                style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-2)' }}
                title="打开系统文件选择器"
              >
                <FolderOpen size={14} />
                浏览…
              </button>
              {pathValid === true && <span className="self-center text-green-600">✓</span>}
              {pathValid === false && <span className="self-center text-red-600">✗</span>}
            </div>
            {projectName && (
              <div className="mt-1 text-xs" style={{ color: 'var(--text-3)' }}>
                项目名: {projectName}
              </div>
            )}
          </Section>

          {/* 隐藏的文件夹选择器 */}
          <input
            id="folder-picker-input"
            type="file"
            /* @ts-ignore */
            webkitdirectory=""
            directory=""
            multiple
            style={{ display: 'none' }}
            onChange={async (e) => {
              const files = e.target.files;
              if (!files || files.length === 0) return;

              // 从第一个文件提取文件夹名
              const firstFile = files[0] as any;
              const relativePath = firstFile.webkitRelativePath || '';
              const folderName = relativePath.split('/')[0];

              if (!folderName) {
                toast.error('无法识别选择的目录');
                return;
              }

              try {
                const res = await fetch('/api/projects/resolve-path', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ folderName }),
                });
                if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
                const { path } = await res.json();
                setRepoPath(path);
                checkProjectPath(path);
              } catch (err: any) {
                toast.error(`路径解析失败: ${err.message}`);
              }
            }}
          />

          <Section label="任务步骤">
            <StepEditor steps={steps} onChange={setSteps} />
          </Section>

          {/* 审查闭环:仅 review 状态显示(留在滚动区内,DiffViewer 体积大) */}
          {!isNewTask && task.status === TaskStatus.REVIEW && (
            <div className="mt-2 border-t pt-4" style={{ borderColor: 'var(--border-primary)' }}>
              <h4 className="mb-2 text-sm font-semibold">代码审查</h4>
              <DiffViewer taskId={task.id} />
              <div className="mt-3 flex flex-col gap-2">
                <Input
                  placeholder="打回理由(打回时必填)"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button variant="primary" disabled={busy} onClick={() => wrap(onApprove)}>
                    通过(→ 完成)
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      if (!rejectReason.trim()) {
                        toast.error('请填写打回理由');
                        return;
                      }
                      wrap(() => onReject(rejectReason));
                    }}
                  >
                    打回(→ 待办)
                  </Button>
                </div>
              </div>
            </div>
          )}
          </div>
        </div>

        {/* 底部:常驻操作栏(不被滚动条隐藏) */}
        <div
          className="flex shrink-0 gap-2 border-t px-1 py-3"
          style={{ borderColor: 'var(--border-primary)', background: 'var(--bg-lower)' }}
        >
          {isNewTask ? (
            <Button
              variant="primary"
              disabled={busy || !title.trim()}
              onClick={() => {
                if (!title.trim()) {
                  setTitleTouched(true);
                  toast.error('标题不能为空');
                  return;
                }
                if (!/^[A-Z][A-Z0-9]*$/.test(prefix)) {
                  toast.error('ID 前缀须为大写字母开头(可含数字),如 WS、BUG');
                  return;
                }
                wrap(() =>
                  onCreate({
                    prefix,
                    title,
                    description,
                    priority,
                    repoPath: repoPath || undefined,
                    projectName: projectName || undefined,
                    steps,
                  })
                );
              }}
            >
              创建任务
            </Button>
          ) : (
            <>
              <Button
                variant="primary"
                disabled={busy || !title.trim()}
                onClick={() => {
                  if (!title.trim()) {
                    setTitleTouched(true);
                    toast.error('标题不能为空');
                    return;
                  }
                  wrap(() =>
                    onSave({
                      title,
                      description,
                      status: TaskStatus.TODO, // 编辑任务后自动回到待办状态
                      priority,
                      repoPath: repoPath || undefined,
                      projectName: projectName || undefined,
                      steps,
                    })
                  );
                }}
              >
                保存
              </Button>
              {status === TaskStatus.TODO && repoPath && (
                <Button
                  variant="secondary"
                  disabled={busy || !title.trim()}
                  onClick={async () => {
                    if (!title.trim()) {
                      setTitleTouched(true);
                      toast.error('标题不能为空');
                      return;
                    }

                    // 确认弹窗
                    if (!confirm(`确认派发任务 ${task.id}？\n\n将执行以下操作：\n1. 保存当前修改\n2. 创建独立的 git worktree\n3. 自动打开终端并运行 claude\n4. 自动复制派发指令到剪贴板\n\n是否继续？`)) {
                      return;
                    }

                    // 先保存
                    try {
                      await onSave({
                        title,
                        description,
                        status: TaskStatus.TODO,
                        priority,
                        repoPath: repoPath || undefined,
                        projectName: projectName || undefined,
                        steps,
                      });
                      // 再派发
                      const dispatch = useTaskStore.getState().dispatch;
                      await dispatch(task.id);
                      toast.success('派发成功！终端已打开，请在 Claude 窗口 Ctrl+V 粘贴指令');
                    } catch (err: any) {
                      toast.error(`派发失败: ${err.message || '未知错误'}`);
                    }
                  }}
                >
                  <Send size={14} />
                  保存并派发
                </Button>
              )}
              <Button
                variant="secondary"
                disabled={busy}
                onClick={async () => {
                  const prompt = buildClaudeCodePrompt(task);
                  try {
                    await navigator.clipboard.writeText(prompt);
                    toast.success('派发指令已复制,粘贴给 Claude Code 即可开工');
                  } catch {
                    toast.error('复制失败,请检查浏览器权限');
                  }
                }}
                title="复制一段提示词,粘贴给 Claude Code 让它通过 MCP 拉取任务并开始执行"
              >
                <Copy size={14} />
                复制派发指令
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => {
                  if (confirm(`确认删除任务 ${task.id}?`)) wrap(onDelete);
                }}
              >
                删除
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 右侧:预览区 */}
      {showPreview && (
        <div className="fade-in w-[40%] overflow-y-auto border-l pl-4 transition-smooth" style={{ borderColor: 'var(--border-primary)' }}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">预览</h3>
            <button onClick={() => setShowPreview(false)} className="text-xs hover:opacity-70 transition-fast" style={{ color: 'var(--text-3)' }}>
              <ChevronRight size={16} />
            </button>
          </div>
          <MarkdownPreview markdown={markdown} />
        </div>
      )}

      {/* 展开预览按钮 */}
      {!showPreview && (
        <button
          onClick={() => setShowPreview(true)}
          className="fade-in absolute right-4 top-16 rounded p-1 hover:opacity-70 transition-fast"
          style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-2)' }}
        >
          <ChevronLeft size={16} />
        </button>
      )}
    </div>
  );
}

function Section({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
        {label}
        {required && <span className="ml-0.5" style={{ color: 'var(--error-8)' }}>*</span>}
      </span>
      {children}
    </div>
  );
}
