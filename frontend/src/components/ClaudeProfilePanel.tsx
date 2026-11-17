// frontend/src/components/ClaudeProfilePanel.tsx
// Claude Code settings.json 多套配置快照 + 一键切换。
// Step7(worklog 转型)单面板化重做:功能清单与后端契约不变(目标选择/导入/快照 CRUD/
// API 预设/掩码/切换自动备份),交互全部内联——卡片展开编辑、应用与删除两段确认,
// 零二级弹窗(原 ProfileEditDialog/PresetFormDialog 已移除)。
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, Download, Eye, EyeOff,
  Loader2, Pencil, Plus, RefreshCw, Trash2, X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { claudeProfileApi } from '@/api/claudeProfile';
import type {
  ClaudeApiPreset,
  ClaudeProfileApplyResponse,
  ClaudeProfileSummary,
  ClaudeSettingsTarget,
} from '@ai-task-flow/shared';

// ---------------------------------------------------------------------------
// 工具函数(自原面板保留)
// ---------------------------------------------------------------------------

function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 12) return key.slice(0, 2) + '****';
  return key.slice(0, 8) + '…' + key.slice(-4);
}

function readSettingsField(settings: Record<string, unknown>, ...path: string[]): string {
  let cur: unknown = settings;
  for (const seg of path) {
    if (typeof cur !== 'object' || cur === null) return '';
    cur = (cur as Record<string, unknown>)[seg];
  }
  return typeof cur === 'string' ? cur : '';
}

/** 把预设应用到 settings(仅覆盖 model/env 三项,不碰其余字段) */
function applyPresetToSettings(
  settings: Record<string, unknown>,
  preset: ClaudeApiPreset,
): Record<string, unknown> {
  const next = structuredClone(settings);
  if (preset.model) next.model = preset.model;
  next.env = {
    ...(typeof next.env === 'object' && next.env !== null ? next.env : {}),
    ...(preset.baseURL ? { ANTHROPIC_BASE_URL: preset.baseURL } : {}),
    ...(preset.apiKey ? { ANTHROPIC_AUTH_TOKEN: preset.apiKey } : {}),
  };
  return next;
}

function getTargetLabel(targets: ClaudeSettingsTarget[], key: string): string {
  return targets.find((t) => t.key === key)?.label ?? key;
}

// ---------------------------------------------------------------------------
// 内联预设编辑行(替代原 PresetFormDialog 弹窗)
// ---------------------------------------------------------------------------

function PresetInlineEditor({
  initial, onSave, onCancel,
}: {
  initial: ClaudeApiPreset | null;
  onSave: (preset: ClaudeApiPreset) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [baseURL, setBaseURL] = useState(initial?.baseURL ?? '');
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? '');
  const [showKey, setShowKey] = useState(false);

  const submit = () => {
    if (!label.trim()) { toast.error('预设名称不能为空'); return; }
    onSave({
      id: initial?.id ?? `preset_${Date.now().toString(36)}`,
      label: label.trim(), model: model.trim(), baseURL: baseURL.trim(), apiKey: apiKey.trim(),
    });
  };

  return (
    <div className="bg-muted/40 flex flex-col gap-1.5 rounded-md border p-2">
      <div className="grid grid-cols-2 gap-1.5">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="预设名,如 GLM" className="h-7 text-xs" autoFocus />
        <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="模型,如 glm-4.6" className="h-7 text-xs" />
        <Input value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="ANTHROPIC_BASE_URL" className="h-7 font-mono text-xs" />
        <div className="relative">
          <Input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            type={showKey ? 'text' : 'password'}
            placeholder="ANTHROPIC_AUTH_TOKEN"
            className="h-7 pr-7 font-mono text-xs"
          />
          <button type="button" onClick={() => setShowKey((v) => !v)} className="text-muted-foreground absolute top-1.5 right-1.5">
            {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        </div>
      </div>
      <div className="flex justify-end gap-1.5">
        <Button size="sm" className="h-6 px-2 text-xs" onClick={submit}>
          <Check className="size-3" /> 保存预设
        </Button>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={onCancel}>
          <X className="size-3" /> 取消
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 内联 Profile 编辑区(替代原 ProfileEditDialog 弹窗)
// ---------------------------------------------------------------------------

function ProfileInlineEditor({
  profile, onSaved, onCancel,
}: {
  /** null = 新建(粘贴 JSON);有值 = 编辑 */
  profile: ClaudeProfileSummary | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(profile?.name ?? '');
  const [jsonText, setJsonText] = useState(
    profile ? JSON.stringify(profile.settings, null, 2) : '',
  );
  const [presets, setPresets] = useState<ClaudeApiPreset[]>(profile?.apiPresets ?? []);
  const [activePresetId, setActivePresetId] = useState<string | null>(() => {
    if (!profile) return null;
    const model = readSettingsField(profile.settings, 'model');
    const url = readSettingsField(profile.settings, 'env', 'ANTHROPIC_BASE_URL');
    return (profile.apiPresets ?? []).find((p) => p.model === model && p.baseURL === url)?.id ?? null;
  });
  const [jsonMode, setJsonMode] = useState(!profile); // 新建默认开 JSON(要粘贴);编辑默认预设模式
  const [presetEditing, setPresetEditing] = useState<ClaudeApiPreset | null | 'new'>(null);
  const [saving, setSaving] = useState(false);

  const handleSelectPreset = (presetId: string) => {
    setActivePresetId(presetId);
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;
    try {
      const settings = JSON.parse(jsonText || '{}') as Record<string, unknown>;
      setJsonText(JSON.stringify(applyPresetToSettings(settings, preset), null, 2));
    } catch {
      toast.error('JSON 无效,无法同步预设(可展开高级模式修正)');
    }
  };

  const handleSave = async () => {
    if (!name.trim()) { toast.error('名称不能为空'); return; }
    let settings: Record<string, unknown> | undefined;
    if (jsonText.trim()) {
      try {
        settings = JSON.parse(jsonText) as Record<string, unknown>;
      } catch {
        toast.error('JSON 格式无效');
        return;
      }
    }
    setSaving(true);
    try {
      if (profile) {
        await claudeProfileApi.update(profile.id, { name: name.trim(), settings, apiPresets: presets });
        toast.success('已更新');
      } else {
        if (!settings) { toast.error('请粘贴 settings.json 内容'); return; }
        await claudeProfileApi.create({ name: name.trim(), settings, apiPresets: presets });
        toast.success('已创建');
      }
      onSaved();
    } catch {
      // http wrapper 已弹 toast
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-muted/20 flex flex-col gap-2.5 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <Label className="shrink-0 text-xs">名称</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如:GLM 配置" className="h-7 flex-1 text-sm" autoFocus={!profile} />
      </div>

      {/* API 预设管理(全部内联) */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Label className="shrink-0 text-xs">API 预设</Label>
          <select
            value={activePresetId ?? ''}
            onChange={(e) => e.target.value && handleSelectPreset(e.target.value)}
            className="border-input bg-background h-7 flex-1 rounded-md border px-2 text-xs"
          >
            <option value="">选择预设同步到配置…</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>{p.label}({p.model || '未设模型'})</option>
            ))}
          </select>
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setPresetEditing('new')}>
            <Plus className="size-3" /> 新增
          </Button>
        </div>

        {presets.map((p) => (
          <div key={p.id} className="flex items-center gap-2 text-xs">
            <span className="flex-1 truncate">
              <span className="font-medium">{p.label}</span>
              <span className="text-muted-foreground"> · {p.model || '未设模型'} · {maskApiKey(p.apiKey ?? '')}</span>
            </span>
            <Button variant="ghost" size="sm" className="size-6 p-0" onClick={() => setPresetEditing(p)}>
              <Pencil className="size-3" />
            </Button>
            <Button
              variant="ghost" size="sm" className="text-destructive size-6 p-0"
              onClick={() => {
                setPresets((prev) => prev.filter((x) => x.id !== p.id));
                if (activePresetId === p.id) setActivePresetId(null);
              }}
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
        ))}

        {presetEditing !== null && (
          <PresetInlineEditor
            initial={presetEditing === 'new' ? null : presetEditing}
            onSave={(preset) => {
              setPresets((prev) => {
                const idx = prev.findIndex((p) => p.id === preset.id);
                if (idx >= 0) { const next = [...prev]; next[idx] = preset; return next; }
                return [...prev, preset];
              });
              if (presetEditing === 'new') setActivePresetId(preset.id);
              setPresetEditing(null);
            }}
            onCancel={() => setPresetEditing(null)}
          />
        )}
      </div>

      {/* JSON 高级模式(折叠,新建时默认展开) */}
      <div>
        <button
          type="button"
          onClick={() => setJsonMode((v) => !v)}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
        >
          {jsonMode ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          JSON 高级模式{jsonMode ? '' : '(编辑原始 settings.json)'}
        </button>
        {jsonMode && (
          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            rows={8}
            spellCheck={false}
            placeholder='粘贴完整的 settings.json 内容…'
            className="border-input bg-background mt-1 w-full rounded-md border p-2 font-mono text-xs"
          />
        )}
      </div>

      <div className="flex items-center justify-end gap-1.5">
        <span className="text-muted-foreground mr-auto text-xs">切换前后端会自动备份 settings.json</span>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          保存
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <X className="size-4" /> 取消
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 主面板:目标选择 + 导入 + 卡片列表(点击切换/展开编辑/两段确认删除)
// ---------------------------------------------------------------------------

export function ClaudeProfilePanel() {
  const [targets, setTargets] = useState<ClaudeSettingsTarget[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ClaudeProfileSummary[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  // 内联编辑状态:null=关闭;'new'=新建;profile 对象=编辑该卡
  const [editing, setEditing] = useState<ClaudeProfileSummary | null | 'new'>(null);
  // 两段确认:确认应用 / 确认删除 的 profile id
  const [confirmApplyId, setConfirmApplyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [importName, setImportName] = useState('');
  const [importing, setImporting] = useState(false);

  const loadTargets = useCallback(async () => {
    try {
      const list = await claudeProfileApi.listTargets();
      setTargets(list);
      if (list.length > 0 && !selectedTarget) setSelectedTarget(list[0].key);
    } catch {
      // http wrapper 已 toast
    }
  }, [selectedTarget]);

  const loadProfiles = useCallback(async () => {
    if (!selectedTarget) return;
    setLoading(true);
    try {
      const res = await claudeProfileApi.list(selectedTarget);
      setProfiles(res.profiles);
      setActiveProfileId(res.activeProfileId);
      setTargets((prev) => prev.map((t) => (t.key === res.target.key ? res.target : t)));
    } catch {
      // http wrapper 已 toast
    } finally {
      setLoading(false);
    }
  }, [selectedTarget]);

  useEffect(() => { void loadTargets(); }, [loadTargets]);
  useEffect(() => { void loadProfiles(); }, [loadProfiles]);

  /** 应用(两段确认后执行):覆盖前自动备份 */
  const doApply = async (profile: ClaudeProfileSummary) => {
    if (!selectedTarget) return;
    setConfirmApplyId(null);
    setApplyingId(profile.id);
    try {
      const res: ClaudeProfileApplyResponse = await claudeProfileApi.apply(profile.id, selectedTarget);
      setActiveProfileId(profile.id);
      const hint = res.rewrittenPaths > 0 ? `(${res.rewrittenPaths} 处 Windows 路径已转 /mnt)` : '';
      toast.success(`已切换到「${profile.name}」${hint},新开终端生效`);
      void loadProfiles();
    } catch {
      // http wrapper 已 toast
    } finally {
      setApplyingId(null);
    }
  };

  const doDelete = async (profile: ClaudeProfileSummary) => {
    setConfirmDeleteId(null);
    try {
      await claudeProfileApi.remove(profile.id);
      toast.success('已删除快照(不影响已写入的 settings.json)');
      void loadProfiles();
    } catch {
      // http wrapper 已 toast
    }
  };

  const handleImport = async () => {
    if (!selectedTarget) return;
    if (!importName.trim()) { toast.error('请输入配置名称'); return; }
    setImporting(true);
    try {
      await claudeProfileApi.importFromTarget({ name: importName.trim(), targetKey: selectedTarget });
      toast.success('已从目标文件导入');
      setImportName('');
      void loadProfiles();
    } catch {
      // http wrapper 已 toast
    } finally {
      setImporting(false);
    }
  };

  const currentTarget = targets.find((t) => t.key === selectedTarget);
  const applyingProfile = useMemo(() => profiles.find((p) => p.id === applyingId) ?? null, [profiles, applyingId]);

  return (
    <div className="flex flex-col gap-3 py-1">
      {/* 目标选择器 */}
      <div className="flex items-center gap-2">
        <Label className="text-nowrap text-sm">目标:</Label>
        <select
          value={selectedTarget ?? ''}
          onChange={(e) => setSelectedTarget(e.target.value)}
          className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 flex-1 rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
        >
          {targets.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
        <Button variant="outline" size="sm" onClick={loadProfiles} disabled={loading}>
          <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
        </Button>
      </div>

      {currentTarget && !currentTarget.exists && (
        <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <AlertTriangle className="size-3.5 text-amber-500" />
          该目标尚无 settings.json,切换时将自动创建。
        </div>
      )}

      {/* 导入区 */}
      <div className="flex items-end gap-2 rounded-md border p-2">
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="import-name" className="text-xs">从目标文件导入</Label>
          <Input
            id="import-name"
            value={importName}
            onChange={(e) => setImportName(e.target.value)}
            placeholder="配置名称,如:公司内网版"
            className="h-8 text-sm"
          />
        </div>
        <Button size="sm" onClick={() => void handleImport()} disabled={importing || !selectedTarget}>
          {importing ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          导入
        </Button>
      </div>

      {/* 列表 */}
      {loading && (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
          <Loader2 className="size-4 animate-spin" /> 加载中…
        </div>
      )}

      {!loading && profiles.length === 0 && editing !== 'new' && (
        <div className="text-muted-foreground py-8 text-center text-sm">
          暂无配置。请从目标文件导入,或「粘贴 JSON 新建」。
        </div>
      )}

      <ScrollArea className="max-h-[52vh] pr-3">
        <div className="flex flex-col gap-2">
          {/* 内联新建卡 */}
          {editing === 'new' && (
            <ProfileInlineEditor
              profile={null}
              onSaved={() => { setEditing(null); void loadProfiles(); }}
              onCancel={() => setEditing(null)}
            />
          )}

          {!loading && profiles.map((profile) => {
            const isActive = profile.id === activeProfileId;
            const isEditing = editing === profile;
            const isApplying = profile.id === applyingId;
            return (
              <div key={profile.id} className="flex flex-col gap-0">
                <div
                  className={cn(
                    'flex items-center gap-3 rounded-md border p-2 text-sm',
                    isActive && 'border-primary border-l-4 border-l-primary bg-primary/5',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{profile.name}</span>
                      {isActive && (
                        <Badge variant="default" className="px-1 py-0 text-[10px]">
                          <Check className="mr-0.5 size-3" /> 生效中
                        </Badge>
                      )}
                    </div>
                    <div className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                      {profile.model && <span>模型: {profile.model}</span>}
                      {profile.baseURL && (
                        <span className="max-w-[200px] truncate">API: {profile.baseURL}</span>
                      )}
                      {profile.authTokenMasked && <span>Token: {profile.authTokenMasked}</span>}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {confirmApplyId === profile.id ? (
                      <>
                        <Button
                          size="sm" className="h-7 gap-1 px-2 text-xs"
                          onClick={() => void doApply(profile)}
                          disabled={isApplying}
                          title={`覆盖 ${getTargetLabel(targets, selectedTarget ?? '')} 的 settings.json(自动备份);已开终端需新开才生效`}
                        >
                          {isApplying ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                          确认切换
                        </Button>
                        <Button variant="ghost" size="sm" className="size-7 p-0" onClick={() => setConfirmApplyId(null)}>
                          <X className="size-3.5" />
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant={isActive ? 'default' : 'outline'}
                        className="h-7 gap-1 px-2 text-xs"
                        onClick={() => setConfirmApplyId(profile.id)}
                        disabled={isApplying || !selectedTarget}
                      >
                        {isApplying ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : applyingProfile?.id === profile.id ? (
                          <Check className="size-3.5" />
                        ) : (
                          <RefreshCw className="size-3.5" />
                        )}
                        切换
                      </Button>
                    )}
                    <Button
                      size="sm" variant="ghost" className="h-7 px-1.5"
                      onClick={() => setEditing(isEditing ? null : profile)}
                    >
                      <Pencil className="mr-0.5 size-3.5" /> 编辑
                    </Button>
                    {confirmDeleteId === profile.id ? (
                      <>
                        <Button variant="destructive" size="sm" className="h-7 px-2 text-xs" onClick={() => void doDelete(profile)}>
                          <Check className="size-3.5" /> 确认删除
                        </Button>
                        <Button variant="ghost" size="sm" className="size-7 p-0" onClick={() => setConfirmDeleteId(null)}>
                          <X className="size-3.5" />
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm" variant="ghost"
                        className="text-destructive hover:text-destructive h-7 px-1.5"
                        onClick={() => setConfirmDeleteId(profile.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* 内联编辑区(卡片下方展开,替代编辑弹窗) */}
                {isEditing && (
                  <div className="pt-2">
                    <ProfileInlineEditor
                      profile={profile}
                      onSaved={() => { setEditing(null); void loadProfiles(); }}
                      onCancel={() => setEditing(null)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* 新建入口(内联展开,替代弹窗) */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setEditing(editing === 'new' ? null : 'new')}>
          <Plus className="size-4" />
          粘贴 JSON 新建
        </Button>
      </div>
    </div>
  );
}
