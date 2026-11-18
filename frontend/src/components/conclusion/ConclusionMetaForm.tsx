import { useState } from 'react';
import type { Conclusion } from '@ai-task-flow/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface ConclusionMetaValue {
  scope: 'project' | 'personal';
  project?: string;
  version?: string;
  title: string;
  tags?: string[];
}

interface Props {
  initial: Conclusion;
  projects: string[];
  onSubmit: (value: ConclusionMetaValue) => Promise<void>;
  onCancel: () => void;
}

export function ConclusionMetaForm({ initial, projects, onSubmit, onCancel }: Props) {
  const [scope, setScope] = useState<'project' | 'personal'>(initial.scope);
  const [project, setProject] = useState(initial.project ?? '');
  const [version, setVersion] = useState(initial.version ?? '');
  const [title, setTitle] = useState(initial.title);
  const [tags, setTags] = useState((initial.tags ?? []).join(', '));
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await onSubmit({
        scope,
        project: scope === 'project' ? project.trim() : undefined,
        version: scope === 'project' ? version.trim() || undefined : undefined,
        title: title.trim(),
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-card space-y-3 rounded-lg border p-4">
      <div className="flex gap-2">
        <Button size="sm" variant={scope === 'project' ? 'secondary' : 'ghost'} onClick={() => setScope('project')}>项目问题</Button>
        <Button size="sm" variant={scope === 'personal' ? 'secondary' : 'ghost'} onClick={() => setScope('personal')}>个人问题</Button>
      </div>
      {scope === 'project' && (
        <div className="grid grid-cols-2 gap-2">
          <Input list="conclusion-meta-projects" placeholder="项目名" value={project} onChange={(e) => setProject(e.target.value)} />
          <datalist id="conclusion-meta-projects">
            {projects.map((name) => <option key={name} value={name} />)}
          </datalist>
          <Input placeholder="版本（可选）" value={version} onChange={(e) => setVersion(e.target.value)} />
        </div>
      )}
      <Input placeholder="标题" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Input placeholder="标签（逗号分隔）" value={tags} onChange={(e) => setTags(e.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" disabled={saving} onClick={() => void submit()}>
          {saving ? '保存中…' : '保存信息'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>取消</Button>
      </div>
    </div>
  );
}
