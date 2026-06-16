// frontend/src/components/AppNav.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { LayoutGrid, MessageSquare, Settings } from 'lucide-react';
import { Modal } from './ui/Modal';
import { useLlmConfigStore } from '@/stores/llmConfigStore';
import './AppNav.css';

type View = 'kanban' | 'chat';

interface AppNavProps {
  currentView: View;
  onViewChange: (view: View) => void;
}

/**
 * 应用级导航栏
 * 符合 Spark-design B 端页面框架规范：56px 高度，白底，Tabs 切换
 */
export const AppNav: React.FC<AppNavProps> = ({ currentView, onViewChange }) => {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const config = useLlmConfigStore((s) => s.config);
  const fetchConfig = useLlmConfigStore((s) => s.fetchConfig);
  const saveConfig = useLlmConfigStore((s) => s.saveConfig);
  const saving = useLlmConfigStore((s) => s.saving);

  // 表单状态
  const [baseURL, setBaseURL] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');

  // 打开设置时加载配置
  const handleOpenSettings = useCallback(() => {
    fetchConfig().then(() => setSettingsOpen(true));
  }, [fetchConfig]);

  // config 加载后初始化表单
  useEffect(() => {
    if (config && settingsOpen) {
      setBaseURL(config.baseURL);
      setApiKey(''); // 不回填 apiKey，仅显示占位
      setModel(config.model);
    }
  }, [config, settingsOpen]);

  const handleSave = async () => {
    const ok = await saveConfig({ baseURL, apiKey, model });
    if (ok) setSettingsOpen(false);
  };

  return (
    <nav className="sp-app-nav">
      <div className="sp-nav-container">
        {/* Logo / 品牌区 */}
        <div className="sp-nav-brand">
          <div className="sp-brand-icon">AI</div>
          <span className="sp-brand-name">Task Flow</span>
        </div>

        {/* Tab 切换区 */}
        <div className="sp-nav-tabs">
          <button
            className={`sp-nav-tab ${currentView === 'kanban' ? 'active' : ''}`}
            onClick={() => onViewChange('kanban')}
          >
            <LayoutGrid size={18} strokeWidth={2} />
            <span>任务看板</span>
          </button>
          <button
            className={`sp-nav-tab ${currentView === 'chat' ? 'active' : ''}`}
            onClick={() => onViewChange('chat')}
          >
            <MessageSquare size={18} strokeWidth={2} />
            <span>资料调研</span>
          </button>
        </div>

        {/* 右侧操作区 */}
        <div className="sp-nav-actions">
          <button
            className="sp-settings-btn"
            onClick={handleOpenSettings}
            title="LLM 设置"
          >
            <Settings size={18} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* LLM 设置 Modal */}
      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="LLM 配置"
        footer={
          <>
            <button className="sp-btn sp-btn--secondary" onClick={() => setSettingsOpen(false)}>
              取消
            </button>
            <button
              className="sp-btn sp-btn--primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </>
        }
        width={480}
      >
        <div className="sp-settings-form">
          <label className="sp-field">
            <span className="sp-field-label">API 地址</span>
            <input
              className="sp-input"
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
              placeholder="https://open.bigmodel.cn/api/paas/v4"
            />
          </label>

          <label className="sp-field">
            <span className="sp-field-label">
              API Key
              {config?.apiKeySet && (
                <span className="sp-field-hint">（已设置：{config.apiKeyMasked}，留空则不修改）</span>
              )}
            </span>
            <input
              className="sp-input"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={config?.apiKeySet ? '留空保持原值' : '输入 API Key'}
            />
          </label>

          <label className="sp-field">
            <span className="sp-field-label">模型名称</span>
            <input
              className="sp-input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="glm-4-plus"
            />
          </label>
        </div>
      </Modal>
    </nav>
  );
};
