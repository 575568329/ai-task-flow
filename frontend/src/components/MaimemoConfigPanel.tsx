// frontend/src/components/MaimemoConfigPanel.tsx
// 设置弹窗的一个 Tab:墨墨背单词 token 配置 + 测试连接 + 保存。
// 复用 maimemoStore。token 留空保存表示「保持原值不变」(后端 saveConfig 已处理)。
import { useEffect, useState } from 'react';
import { Loader2, Plug, Save } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useMaimemoStore } from '@/stores/maimemoStore';

/** 已配置 token 时输入框的占位(不回填明文) */
const TOKEN_PLACEHOLDER = '••••••••••••';

export function MaimemoConfigPanel() {
  const config = useMaimemoStore((s) => s.config);
  const fetchConfig = useMaimemoStore((s) => s.fetchConfig);
  const saveConfig = useMaimemoStore((s) => s.saveConfig);
  const testing = useMaimemoStore((s) => s.testing);
  const saving = useMaimemoStore((s) => s.saving);
  const testConnection = useMaimemoStore((s) => s.testConnection);

  const [token, setToken] = useState('');

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  // 配置回来后清空 token 输入(留空=不改);展示脱敏值供核对
  useEffect(() => {
    setToken('');
  }, [config]);

  const handleSave = async () => {
    await saveConfig(token);
    setToken('');
  };

  return (
    <div className="flex flex-col gap-4 py-1">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="maimemo-token">
          开放 API Token
          {config?.tokenSet && (
            <span className="text-muted-foreground text-xs font-normal">
              (已配置 {config.tokenMasked})
            </span>
          )}
        </Label>
        <Input
          id="maimemo-token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={config?.tokenSet ? TOKEN_PLACEHOLDER : '粘贴墨墨开放 API token'}
        />
        <p className="text-muted-foreground text-xs">
          获取:墨墨 App → 我的 → 更多设置 → 实验功能 → 开放 API → 生成密钥。留空保存表示保持原值不变。
        </p>
      </div>

      {config?.lastNotepadSyncAt && (
        <p className="text-muted-foreground text-xs">
          上次云词本同步:{new Date(config.lastNotepadSyncAt).toLocaleString()}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => void testConnection()}
          disabled={testing || saving || !config?.tokenSet && !token.trim()}
        >
          {testing ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
          测试连接
        </Button>
        <Button onClick={() => void handleSave()} disabled={saving || testing}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          保存
        </Button>
      </div>
    </div>
  );
}
