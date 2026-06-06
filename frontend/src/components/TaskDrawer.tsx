// frontend/src/components/TaskDrawer.tsx
import { useState, useEffect } from 'react';
import { TaskStatus, Priority, type TaskDTO } from '@ai-task-flow/shared';
import { Drawer } from './ui/Drawer';
import { Button } from './ui/Button';
import { Input, Textarea } from './ui/Input';
import { Select } from './ui/Select';
import { Tag } from './ui/Tag';
import { DiffViewer } from './DiffViewer';
import { toast } from './ui/Toaster';
import { taskApi } from '@/api/task';
import { useTaskStore } from '@/stores/taskStore';
import { useUIStore } from '@/stores/uiStore';
import { STATUS_LABELS, STATUS_COLORS } from '@/lib/taskMeta';

export function TaskDrawer() {
  const selectedId = useUIStore((s) => s.selectedTaskId);
  const setSelectedTask = useUIStore((s) => s.setSelectedTask);
  const tasks = useTaskStore((s) => s.tasks);
  const update = useTaskStore((s) => s.update);
  const remove = useTaskStore((s) => s.remove);
  const upsert = useTaskStore((s) => s.upsert);

  const task = tasks.find((t) => t.id === selectedId) ?? null;
  const open = !!task;

  return (
    <Drawer
      open={open}
      onClose={() => setSelectedTask(null)}
      title={
        task && (
          <span className="flex items-center gap-2">
            <span className="font-mono text-sm">{task.id}</span>
            <Tag color={STATUS_COLORS[task.status]} filled>
              {STATUS_LABELS[task.status]}
            </Tag>
          </span>
        )
      }
    >
      {task && (
        <TaskDrawerBody
          task={task}
          onSave={async (data) => {
            await update(task.id, data);
            toast.success('已保存');
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

interface BodyProps {
  task: TaskDTO;
  onSave: (data: Partial<TaskDTO>) => Promise<void>;
  onDelete: () => Promise<void>;
  onApprove: () => Promise<void>;
  onReject: (reason: string) => Promise<void>;
}

function TaskDrawerBody({ task, onSave, onDelete, onApprove, onReject }: BodyProps) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);

  // 切换任务时同步表单
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description);
    setStatus(task.status);
    setPriority(task.priority);
    setRejectReason('');
  }, [task.id, task.title, task.description, task.status, task.priority]);

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

  return (
    <div className="flex flex-col gap-4">
      <Section label="标题">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Section>
      <Section label="描述">
        <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
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

      {task.acceptanceCriteria.length > 0 && (
        <Section label="验收标准">
          <ul className="list-decimal pl-5 text-sm" style={{ color: 'var(--text-muted)' }}>
            {task.acceptanceCriteria.map((ac, i) => (
              <li key={i}>{ac}</li>
            ))}
          </ul>
        </Section>
      )}

      {task.worktree && (
        <Section label="Worktree">
          <div className="rounded-lg border p-2 font-mono text-xs" style={{ borderColor: 'var(--border)' }}>
            <div>分支:{task.worktree.branch}</div>
            <div className="truncate">路径:{task.worktree.path}</div>
          </div>
        </Section>
      )}

      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => wrap(() => onSave({ title, description, status, priority }))}
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
      </div>

      {/* 审查闭环:仅 review 状态显示 */}
      {task.status === TaskStatus.REVIEW && (
        <div className="mt-2 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
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
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      {children}
    </div>
  );
}
