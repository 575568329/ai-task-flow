// frontend/src/components/worklog/NewEntryForm.tsx
// 「+ 记一条」内联表单:项目/版本下拉(支持新建)+ 标题 + 详情 + 标签。
// 人工记录默认无 diff/文件引用(可由 AI 用 update_work 后补)。
// P0 修复:版本初值按「当前选中项目」解析(原取 projects[0] 会在跨项目时静默裂树),
// 哨兵选项必须配上合法文本才可提交。
import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { WorkStageSelect } from '@/components/common/WorkStageSelect';
import { toast } from '@/components/ui/toaster';
import type { WorkStage } from '@ai-task-flow/shared';

interface NewEntryFormProps {
  projects: { name: string; versions: string[] }[];
  defaultProject: string;
  defaultVersion: string;
  onCreate: (input: { project: string; version: string; title: string; detail: string; tags?: string[]; stage?: WorkStage }) => Promise<void>;
  onCancel: () => void;
}

const NEW_OPTION = '__new__';

export function NewEntryForm({ projects, defaultProject, defaultVersion, onCreate, onCancel }: NewEntryFormProps) {
  // 初值:优先当前选中项目;它无版本或不存在时 → 新建版本选项(P0 修复,绝不跨项目取值)
  const initialProject = defaultProject || projects[0]?.name || NEW_OPTION;
  const initialProjectVersions = projects.find((p) => p.name === initialProject)?.versions ?? [];
  const initialVersion =
    defaultVersion && initialProjectVersions.includes(defaultVersion)
      ? defaultVersion
      : initialProjectVersions[0] ?? NEW_OPTION;

  const [project, setProject] = useState(initialProject);
  const [projectText, setProjectText] = useState('');
  const [version, setVersion] = useState(initialVersion);
  const [versionText, setVersionText] = useState('');
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [stage, setStage] = useState<WorkStage | ''>('');
  const [saving, setSaving] = useState(false);

  const currentVersions = projects.find((p) => p.name === project)?.versions ?? [];

  const submit = async () => {
    const finalProject = project === NEW_OPTION ? projectText.trim() : project;
    const finalVersion = version === NEW_OPTION ? versionText.trim() : version;
    if (!finalProject) { toast.error('请输入项目名'); return; }
    if (!finalVersion) { toast.error('请输入版本名'); return; }
    if (!title.trim() || !detail.trim()) {
      toast.error('标题与详细说明均不能为空');
      return;
    }
    setSaving(true);
    try {
      const tags = [...new Set(tagsText.split(/[,，]/).map((t) => t.trim()).filter(Boolean))];
      await onCreate({
        project: finalProject,
        version: finalVersion,
        title: title.trim(),
        detail,
        tags,
        ...(stage ? { stage } : {}),
      });
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); }
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  };

  return (
    <div className="bg-card border-primary/40 rounded-lg border p-4 space-y-3 shadow-sm" onKeyDown={onKeyDown}>
      <div className="space-y-1.5">
        <Label className="text-xs">项目</Label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
              const next = projects.find((p) => p.name === e.target.value);
              setVersion(next?.versions[0] ?? NEW_OPTION);
              setVersionText('');
            }}
            className="border-input bg-background h-8 rounded-md border px-2 text-sm"
            aria-label="选择项目"
          >
            {projects.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
            <option value={NEW_OPTION}>＋ 新建项目…</option>
          </select>
          {project === NEW_OPTION && (
            <Input value={projectText} onChange={(e) => setProjectText(e.target.value)} placeholder="项目名" className="w-36 text-sm" autoFocus />
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">版本</Label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            className="border-input bg-background h-8 rounded-md border px-2 text-sm"
            aria-label="选择版本"
          >
            {currentVersions.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
            <option value={NEW_OPTION}>＋ 新建版本…</option>
          </select>
          {version === NEW_OPTION && (
            <Input value={versionText} onChange={(e) => setVersionText(e.target.value)} placeholder="版本名,如 v1.3.0" className="w-44 text-sm" />
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="nf-title" className="text-xs">标题(一句话功能点)</Label>
        <Input id="nf-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如:登录页加记住密码" className="text-sm font-medium" autoFocus={project !== NEW_OPTION} />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">阶段（唯一标签；缺陷修改用 fix 标签）</Label>
        <WorkStageSelect value={stage} onChange={(value) => setStage(value as WorkStage | '')} className="w-56" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="nf-detail" className="text-xs">详细说明(Bug→问题/原因/解决/验证;任务→需求/方案/实现/验证,分条 1.2.3.)</Label>
        <Textarea
          id="nf-detail" value={detail} onChange={(e) => setDetail(e.target.value)} rows={8} className="text-sm"
          placeholder={'例(Bug):\n### 问题\n某页面打开白屏,控制台报 xx 未定义\n\n### 原因\n…\n\n### 解决\n1. 改了什么(文件+行为)\n\n### 验证\n…(完整模板见左上「AI 使用指南」)'}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="nf-tags" className="text-xs">标签(逗号分隔:feat/fix/refactor/docs)</Label>
        <div className="flex items-center gap-2">
          <Input id="nf-tags" value={tagsText} onChange={(e) => setTagsText(e.target.value)} className="text-sm" />
          <Button size="sm" onClick={submit} disabled={saving || !title.trim() || !detail.trim()}>
            <Check className="size-4" /> 保存
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            <X className="size-4" /> 取消
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          人工记录默认不带 diff/文件引用,可由 AI 用 update_work 后补。Ctrl+Enter 保存,Esc 取消。
        </p>
      </div>
    </div>
  );
}
