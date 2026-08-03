// frontend/src/components/ClaudeProfilePanel.tsx
// 设置弹窗的一个 Tab:Claude Code settings.json 多套配置快照 + 一键切换。
//
// 列目标 → 选 profile → 点切换(备份后覆盖写入)。
// ⚠️ settings 原文含 ANTHROPIC_AUTH_TOKEN:后端返回的 profile 已脱敏,本面板不接触明文。
// 导入走「从目标文件导入」—— 后端正读文件、全程明文不经过前端。
import { useEffect, useState, useCallback } from 'react';
import { Loader2, Plus, Download, Trash2, Check, RefreshCw, AlertTriangle } from 'lucide-react';
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
} from '@ai-task-flow/shared';

/** 新建/编辑 profile 的弹窗(粘贴整份 settings JSON) */
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

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      // 回填完整 settings JSON,方便用户精细调整模型/key 等字段
      setJsonText(JSON.stringify(editing.settings, null, 2));
    } else {
      setName('');
      setJsonText('');
    }
    setSaving(false);
  }, [open, editing]);

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
        await claudeProfileApi.update(editing.id, { name: name.trim(), settings });
      } else {
        if (!settings) {
          toast.error('请粘贴 settings.json 内容');
          setSaving(false);
          return;
        }
        await claudeProfileApi.create({ name: name.trim(), settings });
      }
      toast.success(editing ? '已更新' : '已创建');
      onSaved();
    } catch (error) {
      // http wrapper 已弹 toast,这里不再重复
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? '编辑配置' : '新建配置'}</DialogTitle>
          <DialogDescription>
            {editing
              ? '修改名称或直接编辑下方 JSON 内容,保存后覆盖原有快照。'
              : '粘贴完整的 settings.json 内容保存为快照。推荐用下方的「从目标导入」替代手动粘贴。'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-name">名称</Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如:DeepSeek V4 Pro"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-json">settings.json 内容 {editing && '(留空仅改名)'}</Label>
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

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
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
                    isActive && 'border-primary/40 bg-primary/5',
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
