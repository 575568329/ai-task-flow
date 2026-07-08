// frontend/src/components/LlmConfigPanel.tsx
// 设置弹窗的一个 Tab:LLM 模型配置(baseURL / apiKey / model)+ 测试连接 + 保存。
// 复用现有 llmConfigStore(fetchConfig/saveConfig)与 llmConfigApi(test)。
// apiKey 留空保存表示"保持原值不变"(后端 LlmConfigService.saveConfig 已处理)。
import { useEffect, useState } from 'react';
import { Loader2, Plug, Save } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useLlmConfigStore } from '@/stores/llmConfigStore';
import { llmConfigApi } from '@/api/llmConfig';
import { toast } from '@/components/ui/Toaster';

/** 已配置 key 时输入框的占位(不回填明文,避免泄露) */
const KEY_PLACEHOLDER = '••••••••••••';

export function LlmConfigPanel() {
  const config = useLlmConfigStore((s) => s.config);
  const fetchConfig = useLlmConfigStore((s) => s.fetchConfig);
  const saveConfig = useLlmConfigStore((s) => s.saveConfig);

  const [baseURL, setBaseURL] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  // 挂载时拉脱敏配置(open 弹窗 → 条件渲染本组件 → mount 触发)
  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  // 配置回来后填表单;apiKey 始终留空(表示"不改",保存时后端保持原值)
  useEffect(() => {
    if (!config) return;
    setBaseURL(config.baseURL);
    setModel(config.model);
    setApiKey('');
  }, [config]);

  const handleTest = async () => {
    if (!baseURL.trim() || !model.trim()) {
      toast.error('请填写 API 地址和模型名称');
      return;
    }
    setTesting(true);
    try {
      const res = await llmConfigApi.test({ baseURL, apiKey, model });
      if (res.success) toast.success(res.message);
      else toast.error(res.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '测试连接失败');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const ok = await saveConfig({ baseURL, apiKey, model });
      if (ok) setApiKey(''); // 保存成功后清空输入,回到"保持原值"态
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 py-1">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="llm-baseurl">API 地址</Label>
        <Input
          id="llm-baseurl"
          value={baseURL}
          onChange={(e) => setBaseURL(e.target.value)}
          placeholder="https://open.bigmodel.cn/api/paas/v4"
        />
        <p className="text-muted-foreground text-xs">
          含 <code className="text-foreground">/anthropic</code> 走 Anthropic 协议,否则 OpenAI 兼容。
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="llm-key">
          API Key
          {config?.apiKeySet && (
            <span className="text-muted-foreground text-xs font-normal">(已配置)</span>
          )}
        </Label>
        <Input
          id="llm-key"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={config?.apiKeySet ? KEY_PLACEHOLDER : '粘贴你的 API Key'}
        />
        <p className="text-muted-foreground text-xs">留空保存表示保持原值不变。</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="llm-model">模型</Label>
        <Input
          id="llm-model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="glm-5.2"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => void handleTest()} disabled={testing || saving}>
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
