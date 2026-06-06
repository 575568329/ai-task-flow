// frontend/src/components/CreateTaskModal.tsx
import { useState } from 'react';
import { Priority } from '@ai-task-flow/shared';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Input, Textarea } from './ui/Input';
import { Select } from './ui/Select';
import { toast } from './ui/Toaster';
import { useTaskStore } from '@/stores/taskStore';
import { useUIStore } from '@/stores/uiStore';

const EMPTY = {
  prefix: 'WS',
  title: '',
  description: '',
  priority: Priority.P1,
  projects: '',
  relatedFiles: '',
  acceptanceCriteria: '',
};

export function CreateTaskModal() {
  const open = useUIStore((s) => s.createModalOpen);
  const setOpen = useUIStore((s) => s.setCreateModalOpen);
  const create = useTaskStore((s) => s.create);

  const [form, setForm] = useState({ ...EMPTY });
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setForm({ ...EMPTY });
  }

  async function handleSubmit() {
    if (!/^[A-Z][A-Z0-9]*$/.test(form.prefix)) {
      toast.error('ID 前缀须为大写字母开头(可含数字),如 WS、E2E');
      return;
    }
    if (!form.title.trim()) {
      toast.error('请输入标题');
      return;
    }
    setSubmitting(true);
    try {
      await create({
        prefix: form.prefix,
        title: form.title,
        description: form.description,
        priority: form.priority,
        projects: splitList(form.projects),
        relatedFiles: splitList(form.relatedFiles),
        acceptanceCriteria: form.acceptanceCriteria
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      toast.success('任务创建成功');
      setOpen(false);
      reset();
    } catch {
      // http 层已弹错误
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="新建任务"
      footer={
        <>
          <Button onClick={() => setOpen(false)}>取消</Button>
          <Button variant="primary" disabled={submitting} onClick={handleSubmit}>
            {submitting ? '创建中…' : '创建'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="ID 前缀">
          <Input
            value={form.prefix}
            onChange={(e) => setForm({ ...form, prefix: e.target.value.toUpperCase() })}
            placeholder="WS / BUG / FEAT"
          />
        </Field>
        <Field label="标题">
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="描述">
          <Textarea
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <Field label="优先级">
          <Select
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}
            options={[
              { label: 'P0 - 紧急', value: Priority.P0 },
              { label: 'P1 - 高', value: Priority.P1 },
              { label: 'P2 - 普通', value: Priority.P2 },
            ]}
          />
        </Field>
        <Field label="项目(逗号分隔)">
          <Input
            value={form.projects}
            onChange={(e) => setForm({ ...form, projects: e.target.value })}
          />
        </Field>
        <Field label="相关文件(逗号分隔)">
          <Input
            value={form.relatedFiles}
            onChange={(e) => setForm({ ...form, relatedFiles: e.target.value })}
          />
        </Field>
        <Field label="验收标准(每行一条)">
          <Textarea
            rows={3}
            value={form.acceptanceCriteria}
            onChange={(e) => setForm({ ...form, acceptanceCriteria: e.target.value })}
          />
        </Field>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function splitList(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}
