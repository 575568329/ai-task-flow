import { useState } from 'react';
import type { Conclusion, ConclusionCodeRef } from '@ai-task-flow/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export interface ConclusionFormValue {
  scope: 'project' | 'personal';
  project?: string;
  version?: string;
  title: string;
  tags?: string[];
  decision: string;
  data?: string;
  openItems?: string;
  codeRefs?: ConclusionCodeRef[];
  changeNote?: string;
  expectedRev?: number;
}

interface Props {
  mode: 'create' | 'append';
  initial?: Conclusion;
  projects: string[];
  onSubmit: (value: ConclusionFormValue) => Promise<void>;
  onCancel: () => void;
}

function parseCodeRefs(text: string): ConclusionCodeRef[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [pathPart, note] = line.split('#').map((part) => part.trim());
    const match = pathPart.match(/^(.+?)(?::(\d+)(?:-(\d+))?)?$/);
    if (!match) return { path: line };
    return {
      path: match[1],
      ...(match[2] ? { startLine: Number(match[2]) } : {}),
      ...(match[3] ? { endLine: Number(match[3]) } : {}),
      ...(note ? { note } : {}),
    };
  });
}

function formatCodeRefs(refs?: ConclusionCodeRef[]): string {
  return (refs ?? []).map((ref) => {
    const range = ref.startLine ? `:${ref.startLine}${ref.endLine ? `-${ref.endLine}` : ''}` : '';
    return `${ref.path}${range}${ref.note ? ` # ${ref.note}` : ''}`;
  }).join('\n');
}

export function ConclusionForm({ mode, initial, projects, onSubmit, onCancel }: Props) {
  const latest = initial?.revisions[initial.revisions.length - 1];
  const [scope, setScope] = useState<'project' | 'personal'>(initial?.scope ?? 'project');
  const [project, setProject] = useState(initial?.project ?? '');
  const [version, setVersion] = useState(initial?.version ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '));
  const [decision, setDecision] = useState(latest?.decision ?? '');
  const [data, setData] = useState(latest?.data ?? '');
  const [openItems, setOpenItems] = useState(latest?.openItems ?? '');
  const [codeRefs, setCodeRefs] = useState(formatCodeRefs(latest?.codeRefs));
  const [changeNote, setChangeNote] = useState(mode === 'append' ? '人工修订' : '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await onSubmit({
        scope,
        project: scope === 'project' ? project.trim() : undefined,
        version: scope === 'project' ? version.trim() || undefined : undefined,
        title: title.trim(),
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        decision,
        data,
        openItems,
        codeRefs: parseCodeRefs(codeRefs),
        changeNote: changeNote.trim() || undefined,
        expectedRev: latest?.rev,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-card space-y-3 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <Button
          type="button" size="sm"
          variant={scope === 'project' ? 'secondary' : 'ghost'}
          onClick={() => setScope('project')}
        >项目问题</Button>
        <Button
          type="button" size="sm"
          variant={scope === 'personal' ? 'secondary' : 'ghost'}
          onClick={() => setScope('personal')}
        >个人问题</Button>
      </div>

      {scope === 'project' && (
        <div className="grid grid-cols-2 gap-2">
          <Input list="conclusion-projects" placeholder="项目名" value={project} onChange={(e) => setProject(e.target.value)} />
          <datalist id="conclusion-projects">
            {projects.map((name) => <option key={name} value={name} />)}
          </datalist>
          <Input placeholder="版本（可选）" value={version} onChange={(e) => setVersion(e.target.value)} />
        </div>
      )}

      <Input placeholder="标题" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Input placeholder="标签（逗号分隔）" value={tags} onChange={(e) => setTags(e.target.value)} />

      <label className="block text-xs font-semibold">结论/决策 + 理由（必填）</label>
      <Textarea rows={4} value={decision} onChange={(e) => setDecision(e.target.value)} />

      <label className="block text-xs font-semibold">关键数据/命令结果</label>
      <Textarea rows={3} value={data} onChange={(e) => setData(e.target.value)} />

      <label className="block text-xs font-semibold">待办/未决问题</label>
      <Textarea rows={2} value={openItems} onChange={(e) => setOpenItems(e.target.value)} />

      <label className="block text-xs font-semibold">代码/文件位置（每行 `路径:起始行-结束行 # 说明`）</label>
      <Textarea rows={2} className="font-mono text-xs" value={codeRefs} onChange={(e) => setCodeRefs(e.target.value)} />

      <Input
        placeholder={mode === 'append' ? '变更说明（必填）' : '变更说明（可选）'}
        value={changeNote}
        onChange={(e) => setChangeNote(e.target.value)}
      />

      <div className="flex gap-2">
        <Button size="sm" disabled={saving} onClick={() => void handleSubmit()}>
          {saving ? '保存中…' : mode === 'append' ? '追加新版' : '创建'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>取消</Button>
      </div>
    </div>
  );
}
