// frontend/src/components/worklog/NewEntryForm.tsx
// 「+ 记一条」内联表单:项目/版本下拉(支持新建)+ 标题 + 详情 + 标签。
// 人工记录默认无 diff/文件引用(可由 AI 用 update_work 后补)。
import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface NewEntryFormProps {
  projects: { name: string; versions: string[] }[];
  defaultProject: string;
  defaultVersion: string;
  onCreate: (input: { project: string; version: string; title: string; detail: string; tags?: string[] }) => Promise<void>;
  onCancel: () => void;
}

const NEW_OPTION = '__new__';

export function NewEntryForm({ projects, defaultProject, defaultVersion, onCreate, onCancel }: NewEntryFormProps) {
  const [project, setProject] = useState(defaultProject || projects[0]?.name || '');
  const [projectText, setProjectText] = useState('');
  const [version, setVersion] = useState(defaultVersion || projects[0]?.versions[0] || '');
  const [versionText, setVersionText] = useState('');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [saving, setSaving] = useState(false);

  const currentVersions = projects.find((p) => p.name === project)?.versions ?? [];

  const submit = async () => {
    if (!title.trim() || !detail.trim()) return;
    setSaving(true);
    try {
      const finalProject = project === NEW_OPTION ? projectText.trim() : project;
      const finalVersion = version === NEW_OPTION ? versionText.trim() : version;
      if (!finalProject || !finalVersion) return;
      const tags = tagsText.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
      await onCreate({ project: finalProject, version: finalVersion, title: title.trim(), detail, tags });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-card border-primary/40 rounded-lg border p-4 space-y-2 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={project}
          onChange={(e) => {
            setProject(e.target.value);
            const next = projects.find((p) => p.name === e.target.value);
            setVersion(next?.versions[0] ?? NEW_OPTION);
            setVersionText('');
          }}
          className="bg-background border rounded-md px-2 py-1.5 text-sm"
        >
          {projects.map((p) => (
            <option key={p.name} value={p.name}>{p.name}</option>
          ))}
          <option value={NEW_OPTION}>＋ 新建项目…</option>
        </select>
        {project === NEW_OPTION && (
          <Input value={projectText} onChange={(e) => setProjectText(e.target.value)} placeholder="项目名" className="w-36 text-sm" autoFocus />
        )}
        <select
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          className="bg-background border rounded-md px-2 py-1.5 text-sm"
        >
          {currentVersions.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
          <option value={NEW_OPTION}>＋ 新建版本…</option>
        </select>
        {version === NEW_OPTION && (
          <Input value={versionText} onChange={(e) => setVersionText(e.target.value)} placeholder="版本名,如 v1.3.0" className="w-36 text-sm" />
        )}
      </div>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="一句话功能点(标题)" className="text-sm font-medium" autoFocus={project !== NEW_OPTION} />
      <Textarea value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="详细改动说明(markdown):改了什么/为什么/影响面" rows={5} className="text-sm" />
      <div className="flex items-center gap-2">
        <Input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="标签,逗号分隔(feat/fix/refactor/docs)" className="text-sm" />
        <Button size="sm" onClick={submit} disabled={saving || !title.trim() || !detail.trim()}>
          <Check className="size-4" /> 保存
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <X className="size-4" /> 取消
        </Button>
      </div>
    </div>
  );
}
