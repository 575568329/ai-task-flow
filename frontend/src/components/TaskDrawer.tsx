// frontend/src/components/TaskDrawer.tsx
import { useState, useEffect, useMemo } from 'react';
import { TaskStatus, Priority, type TaskDTO, type TaskStep } from '@ai-task-flow/shared';
import { Drawer } from './ui/Drawer';
import { Button } from './ui/Button';
import { Input, Textarea } from './ui/Input';
import { Select } from './ui/Select';
import { Tag } from './ui/Tag';
import { DiffViewer } from './DiffViewer';
import { StepEditor } from './StepEditor';
import { MarkdownPreview } from './MarkdownPreview';
import { toast } from './ui/Toaster';
import { taskApi } from '@/api/task';
import { useTaskStore } from '@/stores/taskStore';
import { useUIStore } from '@/stores/uiStore';
import { STATUS_LABELS, STATUS_COLORS } from '@/lib/taskMeta';
import { ChevronRight, ChevronLeft } from 'lucide-react';

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

  const isNewTask = creating;

  // 切换任务时同步表单
  useEffect(() => {
    setTitle(task.title);
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

  async function checkProjectPath() {
    if (!repoPath.trim()) {
      setPathValid(null);
      return;
    }

    try {
      const res = await fetch('http://localhost:3000/api/projects/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: repoPath }),
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
      steps.forEach((step, index) => {
        lines.push(`### 步骤 ${index + 1}`, '');
        if (step.imageUrl) {
          lines.push(`![步骤${index + 1}图片](${step.imageUrl})`, '');
        }
        lines.push(step.description, '');
      });
    }

    return lines.join('\n');
  }, [title, description, priority, status, projectName, repoPath, steps]);

  return (
    <div className="flex h-full gap-4">
      {/* 左侧:编辑区 */}
      <div className={`flex-1 overflow-y-auto ${showPreview ? 'pr-2' : ''}`}>
        <div className="flex flex-col gap-4">
          {isNewTask && (
            <Section label="ID 前缀">
              <Input
                value={prefix}
                onChange={(e) => setPrefix(e.target.value.toUpperCase())}
                placeholder="WS / BUG / FEAT"
              />
            </Section>
          )}

          <Section label="标题">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="任务标题" />
          </Section>

          <Section label="描述">
            <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="详细描述..." />
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
              <Select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                options={Object.values(Priority).map((p) => ({ label: p, value: p }))}
              />
            </Section>
          </div>

          <Section label="项目路径(可选)">
            <div className="flex gap-2">
              <Input
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                onBlur={checkProjectPath}
                placeholder="/path/to/repo"
              />
              {pathValid === true && <span className="text-green-600">✓</span>}
              {pathValid === false && <span className="text-red-600">✗</span>}
            </div>
            {projectName && (
              <div className="mt-1 text-xs" style={{ color: 'var(--text-3)' }}>
                项目名: {projectName}
              </div>
            )}
          </Section>

          <Section label="任务步骤">
            <StepEditor steps={steps} onChange={setSteps} />
          </Section>

          <div className="flex gap-2">
            {isNewTask ? (
              <Button
                variant="primary"
                disabled={busy || !title.trim()}
                onClick={() => {
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
                  disabled={busy}
                  onClick={() =>
                    wrap(() =>
                      onSave({
                        title,
                        description,
                        status,
                        priority,
                        repoPath: repoPath || undefined,
                        projectName: projectName || undefined,
                        steps,
                      })
                    )
                  }
                >
                  保存
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

          {/* 审查闭环:仅 review 状态显示 */}
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
          className="fade-in absolute right-4 top-4 rounded p-1 hover:opacity-70 transition-fast"
          style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-2)' }}
        >
          <ChevronLeft size={16} />
        </button>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
        {label}
      </span>
      {children}
    </div>
  );
}
