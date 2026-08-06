// frontend/src/components/ClaudeProfilePanel.tsx
// 设置弹窗的一个 Tab:Claude Code settings.json 多套配置快照 + 一键切换。
//
// 列目标 → 选 profile → 点切换(备份后覆盖写入)。
// ⚠️ settings 原文含 ANTHROPIC_AUTH_TOKEN:后端返回的 profile 已脱敏,本面板不接触明文。
// 导入走「从目标文件导入」—— 后端正读文件、全程明文不经过前端。
import { useEffect, useState, useCallback, useMemo } from 'react';
import { Loader2, Plus, Download, Trash2, Check, RefreshCw, AlertTriangle, Pencil, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useConfirm } from '@/components/ui/confirm';
import { toast } from '@/components/ui/toaster';
import { claudeProfileApi } from '@/api/claudeProfile';
import { cn } from '@/lib/utils';
import type {
  ClaudeSettingsTarget,
  ClaudeProfileSummary,
  ClaudeProfileApplyResponse,
  ClaudeApiPreset,
} from '@ai-task-flow/shared';

/** 脱敏 API key:首尾各 4 位 */
function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}${'*'.repeat(Math.min(key.length - 8, 8))}${key.slice(-4)}`;
}

/** 从 settings JSON 读取字符串字段(路径形如 env.ANTHROPIC_AUTH_TOKEN) */
function readSettingsField(settings: Record<string, unknown>, ...path: string[]): string {
  let cursor: unknown = settings;
  for (const seg of path) {
    if (cursor === null || typeof cursor !== 'object') return '';
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return typeof cursor === 'string' ? cursor : '';
}

/** 将 preset 的 model/baseURL/apiKey 写入 settings,返回新的 settings 对象(不修改原对象) */
function applyPresetToSettings(
  settings: Record<string, unknown>,
  preset: ClaudeApiPreset,
): Record<string, unknown> {
  const next = { ...settings };
  if (preset.model) next.model = preset.model;
  const env = { ...((next.env as Record<string, unknown>) ?? {}) };
  if (preset.baseURL) env.ANTHROPIC_BASE_URL = preset.baseURL;
  if (preset.apiKey) env.ANTHROPIC_AUTH_TOKEN = preset.apiKey;
  next.env = env;
  return next;
}

/** 新增/编辑 API 预设的微型弹窗 */
function PresetFormDialog({
  open,
  preset,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null = 新建; 有值 = 编辑 */
  preset: ClaudeApiPreset | null;
  onClose: () => void;
  onSaved: (preset: ClaudeApiPreset) => void;
}) {
  const [label, setLabel] = useState('');
  const [model, setModel] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (preset) {
      setLabel(preset.label);
      setModel(preset.model);
      setBaseURL(preset.baseURL);
      setApiKey(preset.apiKey);
    } else {
      setLabel('');
      setModel('');
      setBaseURL('');
      setApiKey('');
    }
    setShowKey(false);
  }, [open, preset]);

  const handleSave = () => {
    if (!label.trim()) { toast.error('标签不能为空'); return; }
    onSaved({
      id: preset?.id ?? crypto.randomUUID(),
      label: label.trim(),
      model: model.trim(),
      baseURL: baseURL.trim(),
      apiKey: apiKey.trim(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{preset ? '编辑 API 预设' : '新增 API 预设'}</DialogTitle>
          <DialogDescription>
            {preset ? '修改预设的标签、模型、地址和 Key。' : '填写一组 API 配置,保存后可通过 Select 快速切换。'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="preset-label">标签</Label>
            <Input id="preset-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="如: GLM-4V" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="preset-model">模型</Label>
            <Input id="preset-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="如: glm-4v" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="preset-url">API 地址</Label>
            <Input id="preset-url" value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="如: https://open.bigmodel.cn" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="preset-key">API Key</Label>
            <div className="flex gap-1">
              <Input
                id="preset-key"
                className="flex-1 font-mono text-xs"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="API Key"
              />
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? '隐藏 Key' : '显示 Key'}
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 新建/编辑 profile 的弹窗:名称 + API 预设管理(Select+增删) + JSON 手动编辑 */
function ProfileEditDialog({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null = 新建;有值 = 编辑(改名 + 换内容) */
  editing: ClaudeProfileSummary | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [jsonText, setJsonText] = useState('');
  const [saving, setSaving] = useState(false);

  // API 预设状态
  const [presets, setPresets] = useState<ClaudeApiPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  // 预设编辑弹窗
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [editingPreset, setEditingPreset] = useState<ClaudeApiPreset | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setJsonText(JSON.stringify(editing.settings, null, 2));
      setPresets(editing.apiPresets ?? []);
      // 自动选中与当前 settings 匹配的 preset
      const currentModel = readSettingsField(editing.settings, 'model');
      const currentURL = readSettingsField(editing.settings, 'env', 'ANTHROPIC_BASE_URL');
      const matched = (editing.apiPresets ?? []).find(
        (p) => p.model === currentModel && p.baseURL === currentURL,
      );
      setActivePresetId(matched?.id ?? null);
    } else {
      setName('');
      setJsonText('');
      setPresets([]);
      setActivePresetId(null);
    }
    setSaving(false);
  }, [open, editing]);

  // 当前选中的 preset 详情
  const activePreset = useMemo(
    () => presets.find((p) => p.id === activePresetId) ?? null,
    [presets, activePresetId],
  );

  // 选中 preset → 单向同步到 JSON
  const handleSelectPreset = (presetId: string) => {
    setActivePresetId(presetId);
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;
    try {
      const settings = JSON.parse(jsonText) as Record<string, unknown>;
      const updated = applyPresetToSettings(settings, preset);
      setJsonText(JSON.stringify(updated, null, 2));
    } catch {
      // JSON 解析失败时不做同步,保持 JSON 原样
    }
  };

  // 预设 CRUD
  const handlePresetSaved = (preset: ClaudeApiPreset) => {
    setPresets((prev) => {
      const idx = prev.findIndex((p) => p.id === preset.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = preset;
        return next;
      }
      return [...prev, preset];
    });
    // 新增预设后自动选中
    if (!editingPreset) setActivePresetId(preset.id);
    setPresetDialogOpen(false);
    setEditingPreset(null);
  };

  const handleDeletePreset = (presetId: string) => {
    setPresets((prev) => prev.filter((p) => p.id !== presetId));
    if (activePresetId === presetId) setActivePresetId(null);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('名称不能为空');
      return;
    }
    let settings: Record<string, unknown> | undefined;
    if (jsonText.trim()) {
      try {
        settings = JSON.parse(jsonText);
      } catch {
        toast.error('JSON 格式无效');
        return;
      }
    }

    setSaving(true);
    try {
      if (editing) {
        await claudeProfileApi.update(editing.id, {
          name: name.trim(),
          settings,
          apiPresets: presets,
        });
      } else {
        if (!settings) {
          toast.error('请粘贴 settings.json 内容');
          setSaving(false);
          return;
        }
        await claudeProfileApi.create({ name: name.trim(), settings });
        // 新建时 apiPresets 随 settings 一起保存需要二次 update
        if (presets.length > 0) {
          toast.success('已创建,正在保存 API 预设…');
          const created = await claudeProfileApi.list().then((r) =>
            r.profiles.find((p) => p.name === name.trim()),
          );
          if (created) {
            await claudeProfileApi.update(created.id, { apiPresets: presets });
          }
        }
      }
      toast.success(editing ? '已更新' : '已创建');
      onSaved();
    } catch {
      // http wrapper 已弹 toast
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>{editing ? '编辑配置' : '新建配置'}</DialogTitle>
          <DialogDescription>
            {editing
              ? '管理 API 预设或手动编辑 JSON。选中预设自动同步到 JSON。'
              : '粘贴完整的 settings.json 内容保存为快照。'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 overflow-y-auto min-h-0">
          {/* 名称 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-name">名称</Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如:GLM 配置"
            />
          </div>

          {/* API 预设区(仅编辑模式) */}
          {editing && (
            <div className="flex flex-col gap-2 rounded-md border p-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">API 预设</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-xs"
                  onClick={() => { setEditingPreset(null); setPresetDialogOpen(true); }}
                >
                  <Plus className="size-3" /> 新增
                </Button>
              </div>

              {presets.length > 0 && (
                <>
                  {/* Select + 当前详情 */}
                  <select
                    className="border-input bg-background rounded-md border px-2 py-1.5 text-xs shadow-xs outline-none"
                    value={activePresetId ?? ''}
                    onChange={(e) => e.target.value && handleSelectPreset(e.target.value)}
                  >
                    <option value="">选择预设…</option>
                    {presets.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>

                  {activePreset && (
                    <div className="bg-muted/30 rounded border px-2 py-1.5 font-mono text-[11px] space-y-0.5">
                      <div>model: {activePreset.model || <span className="text-muted-foreground">(空)</span>}</div>
                      <div>url:   {activePreset.baseURL || <span className="text-muted-foreground">(空)</span>}</div>
                      <div>key:   {activePreset.apiKey ? maskApiKey(activePreset.apiKey) : <span className="text-muted-foreground">(空)</span>}</div>
                    </div>
                  )}

                  {/* 全部预设列表 */}
                  <div className="flex flex-col gap-1">
                    {presets.map((p) => (
                      <div key={p.id} className={cn(
                        'flex items-center gap-2 rounded px-1.5 py-1 text-xs',
                        p.id === activePresetId && 'bg-primary/5',
                      )}>
                        <span className="flex-1 truncate">{p.label}</span>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => { setEditingPreset(p); setPresetDialogOpen(true); }}
                          title="编辑"
                        >
                          <Pencil className="size-3" />
                        </button>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => handleDeletePreset(p.id)}
                          title="删除"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {presets.length === 0 && (
                <div className="text-muted-foreground py-2 text-center text-xs">
                  暂无预设。点击「新增」添加 API 配置。
                </div>
              )}
            </div>
          )}

          {/* JSON 手动编辑 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-json">
              settings.json {editing && '(选中预设会自动更新此处)'}
            </Label>
            <textarea
              id="profile-json"
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 rounded-md border px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:ring-[3px]"
              rows={10}
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder='粘贴 JSON 内容,如:&#10;{&#10;  "env": {...},&#10;  "model": "claude-sonnet-5"&#10;}'
            />
          </div>
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* 预设编辑弹窗 */}
      <PresetFormDialog
        open={presetDialogOpen}
        preset={editingPreset}
        onClose={() => { setPresetDialogOpen(false); setEditingPreset(null); }}
        onSaved={handlePresetSaved}
      />
    </Dialog>
  );
}

export function ClaudeProfilePanel() {
  const [targets, setTargets] = useState<ClaudeSettingsTarget[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ClaudeProfileSummary[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  // 新建/编辑弹窗状态
  const [editOpen, setEditOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ClaudeProfileSummary | null>(null);
  // 导入名称输入
  const [importName, setImportName] = useState('');
  const [importing, setImporting] = useState(false);

  const { confirm } = useConfirm();

  /** 加载目标列表,选第一个 */
  const loadTargets = useCallback(async () => {
    try {
      const list = await claudeProfileApi.listTargets();
      setTargets(list);
      if (list.length > 0 && !selectedTarget) {
        setSelectedTarget(list[0].key);
      }
    } catch {
      // http wrapper 已 toast
    }
  }, [selectedTarget]);

  /** 目标变化时重新拉 profile 列表 */
  const loadProfiles = useCallback(async () => {
    if (!selectedTarget) return;
    setLoading(true);
    try {
      const res = await claudeProfileApi.list(selectedTarget);
      setProfiles(res.profiles);
      setActiveProfileId(res.activeProfileId);
      // 保持 target 信息与后端最新一致(切换后 exists 会变)
      setTargets((prev) =>
        prev.map((t) => (t.key === res.target.key ? res.target : t)),
      );
    } catch {
      // http wrapper 已 toast
    } finally {
      setLoading(false);
    }
  }, [selectedTarget]);

  useEffect(() => {
    void loadTargets();
  }, [loadTargets]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  /** 一键切换 */
  const handleApply = async (profile: ClaudeProfileSummary) => {
    if (!selectedTarget) return;
    // 切换前强提示:覆盖不可逆,新开终端生效
    if (
      !(await confirm({
        title: `切换到「${profile.name}」`,
        description:
          `将覆盖 ${getTargetLabel(targets, selectedTarget)} 的 settings.json,覆盖前会备份。\n\n⚠️ 已打开的 Claude Code 不会立即生效,需要新开终端。`,
        confirmText: '确认切换',
        variant: 'destructive',
      }))
    ) {
      return;
    }

    setApplyingId(profile.id);
    try {
      const res: ClaudeProfileApplyResponse = await claudeProfileApi.apply(profile.id, selectedTarget);
      setActiveProfileId(profile.id);
      const hint = res.rewrittenPaths > 0
        ? `(${res.rewrittenPaths} 处 Windows 路径已转为 /mnt 形态)`
        : '';
      toast.success(`已切换${hint},新开终端生效`);
      // 刷新当前生效状态
      void loadProfiles();
    } catch {
      // http wrapper 已 toast
    } finally {
      setApplyingId(null);
    }
  };

  /** 从当前目标导入:后端直接读文件,明文不经前端 */
  const handleImport = async () => {
    if (!selectedTarget) return;
    if (!importName.trim()) {
      toast.error('请输入配置名称');
      return;
    }
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

  const handleDelete = async (profile: ClaudeProfileSummary) => {
    if (
      !(await confirm({
        title: `删除「${profile.name}」`,
        description: '仅删除快照,不影响已写入的 settings.json。确认删除?',
        confirmText: '删除',
        variant: 'destructive',
      }))
    ) {
      return;
    }
    try {
      await claudeProfileApi.remove(profile.id);
      toast.success('已删除');
      void loadProfiles();
    } catch {
      // http wrapper 已 toast
    }
  };

  const currentTarget = targets.find((t) => t.key === selectedTarget);

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
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
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

      {/* 导入区:从目标文件导入(推荐) */}
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

      {/* Profile 卡片列表 */}
      {loading && (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
          <Loader2 className="size-4 animate-spin" /> 加载中…
        </div>
      )}

      {!loading && profiles.length === 0 && (
        <div className="text-muted-foreground py-8 text-center text-sm">
          暂无配置。请从目标文件导入或粘贴 JSON 新建。
        </div>
      )}

      {!loading && profiles.length > 0 && (
        <ScrollArea className="max-h-60 pr-3">
          <div className="flex flex-col gap-2">
            {profiles.map((profile) => {
              const isActive = profile.id === activeProfileId;
              const isApplying = profile.id === applyingId;
              return (
                <div
                  key={profile.id}
                  className={cn(
                    'flex items-center gap-3 rounded-md border p-2 text-sm',
                    isActive && 'border-primary border-l-4 border-l-primary bg-primary/5',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium truncate">{profile.name}</span>
                      {isActive && (
                        <Badge variant="default" className="px-1 py-0 text-[10px]">
                          <Check className="size-3 mr-0.5" /> 生效中
                        </Badge>
                      )}
                    </div>
                    <div className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                      {profile.model && <span>模型: {profile.model}</span>}
                      {profile.baseURL && (
                        <span className="truncate max-w-[200px]">
                          API: {profile.baseURL}
                        </span>
                      )}
                      {profile.authTokenMasked && <span>Token: {profile.authTokenMasked}</span>}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant={isActive ? 'default' : 'outline'}
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={() => void handleApply(profile)}
                      disabled={isApplying || !selectedTarget}
                    >
                      {isApplying ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                      切换
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-1.5"
                      onClick={() => { setEditingProfile(profile); setEditOpen(true); }}
                    >
                      编辑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-1.5 text-destructive hover:text-destructive"
                      onClick={() => void handleDelete(profile)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}

      {/* 新建按钮(粘贴 JSON) */}
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setEditingProfile(null); setEditOpen(true); }}
        >
          <Plus className="size-4" />
          粘贴 JSON 新建
        </Button>
      </div>

      {/* 新建/编辑弹窗 */}
      <ProfileEditDialog
        open={editOpen}
        editing={editingProfile}
        onClose={() => { setEditOpen(false); setEditingProfile(null); }}
        onSaved={() => { setEditOpen(false); setEditingProfile(null); void loadProfiles(); }}
      />
    </div>
  );
}

function getTargetLabel(targets: ClaudeSettingsTarget[], key: string): string {
  return targets.find((t) => t.key === key)?.label ?? key;
}
