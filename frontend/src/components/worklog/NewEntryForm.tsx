// frontend/src/components/worklog/NewEntryForm.tsx
// 「+ 记一条」内联表单:版本 / 需求下拉 + 标题 + 详情 + 标签。
// 人工记录默认无 diff/文件引用(可由 AI 用 update_work 后补)。
// 版本/需求必须先存在(由页面显式创建),表单只选择、不再自动建层。
import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { WorkStageSelect } from '@/components/common/WorkStageSelect';
import { toast } from '@/components/ui/toaster';
import type { WorkStage } from '@ai-task-flow/shared';

export interface VersionOption {
  id: string;
  name: string;
  requirements: { id: string; title: string }[];
}

interface NewEntryFormProps {
  versions: VersionOption[];
  defaultVersionId: string;
  defaultRequirementId: string;
  onCreate: (input: {
    versionId: string;
    requirementId: string;
    title: string;
    detail: string;
    tags?: string[];
    stage?: WorkStage;
  }) => Promise<void>;
  onCancel: () => void;
}

export function NewEntryForm({
  versions, defaultVersionId, defaultRequirementId, onCreate, onCancel,
}: NewEntryFormProps) {
  const initialVersion =
    versions.find((v) => v.id === defaultVersionId) ?? versions[0];
  const initialVersionId = initialVersion?.id ?? '';
  const initialRequirements = initialVersion?.requirements ?? [];
  const initialRequirementId =
    initialRequirements.find((r) => r.id === defaultRequirementId)?.id
    ?? initialRequirements[0]?.id
    ?? '';

  const [versionId, setVersionId] = useState(initialVersionId);
  const [requirementId, setRequirementId] = useState(initialRequirementId);
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [stage, setStage] = useState<WorkStage | ''>('');
  const [saving, setSaving] = useState(false);

  const currentRequirements = versions.find((v) => v.id === versionId)?.requirements ?? [];
  const canSubmit = Boolean(versionId && requirementId);

  const submit = async () => {
    if (!versionId) { toast.error('请选择版本（可先在左侧新建版本）'); return; }
    if (!requirementId) { toast.error('请选择需求（可先在左侧新建需求）'); return; }
    if (!title.trim() || !detail.trim()) {
      toast.error('标题与详细说明均不能为空');
      return;
    }
    setSaving(true);
    try {
      const tags = [...new Set(tagsText.split(/[,，]/).map((t) => t.trim()).filter(Boolean))];
      await onCreate({
        versionId,
        requirementId,
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
      {versions.length === 0 && (
        <p className="text-muted-foreground text-xs">
          还没有版本。请先在左侧「＋ 新建版本」并创建需求,再来记一条。
        </p>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs">版本</Label>
        <select
          value={versionId}
          onChange={(e) => {
            const nextId = e.target.value;
            setVersionId(nextId);
            setRequirementId(
              versions.find((v) => v.id === nextId)?.requirements[0]?.id ?? '',
            );
          }}
          className="border-input bg-background h-8 rounded-md border px-2 text-sm"
          aria-label="选择版本"
        >
          {versions.map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">需求</Label>
        <select
          value={requirementId}
          onChange={(e) => setRequirementId(e.target.value)}
          className="border-input bg-background h-8 rounded-md border px-2 text-sm"
          aria-label="选择需求"
        >
          {currentRequirements.map((r) => (
            <option key={r.id} value={r.id}>{r.title}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="nf-title" className="text-xs">标题(一句话功能点)</Label>
        <Input id="nf-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如:登录页加记住密码" className="text-sm font-medium" autoFocus />
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
          <Button size="sm" onClick={submit} disabled={saving || !canSubmit || !title.trim() || !detail.trim()}>
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
