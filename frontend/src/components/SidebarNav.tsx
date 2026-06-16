// frontend/src/components/SidebarNav.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  LayoutGrid,
  MessageSquare,
  FileText,
  Settings,
  Moon,
  Sun,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { Modal } from './ui/Modal';
import { useLlmConfigStore } from '@/stores/llmConfigStore';
import { useUIStore } from '@/stores/uiStore';
import './SidebarNav.css';

export type View = 'kanban' | 'chat' | 'docs';

interface SidebarNavProps {
  currentView: View;
  onViewChange: (view: View) => void;
}

interface NavItem {
  key: View;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'kanban', label: '任务看板', icon: <LayoutGrid size={18} strokeWidth={2} /> },
  { key: 'chat', label: '资料调研', icon: <MessageSquare size={18} strokeWidth={2} /> },
  { key: 'docs', label: '任务文档', icon: <FileText size={18} strokeWidth={2} /> },
];

const COLLAPSE_KEY = 'ai-task-flow-sidebar-collapsed';

/**
 * 左侧全局导航栏（竖向，常驻，可收起）
 * 符合 Spark-design B 端规范：展开 240px / 收起 64px(仅图标)
 */
export const SidebarNav: React.FC<SidebarNavProps> = ({ currentView, onViewChange }) => {
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem(COLLAPSE_KEY) === '1',
  );
  const [settingsOpen, setSettingsOpen] = useState(false);

  const config = useLlmConfigStore((s) => s.config);
  const fetchConfig = useLlmConfigStore((s) => s.fetchConfig);
  const saveConfig = useLlmConfigStore((s) => s.saveConfig);
  const saving = useLlmConfigStore((s) => s.saving);

  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  // LLM 设置表单
  const [baseURL, setBaseURL] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');

  const handleOpenSettings = useCallback(() => {
    fetchConfig().then(() => setSettingsOpen(true));
  }, [fetchConfig]);

  useEffect(() => {
    if (config && settingsOpen) {
      setBaseURL(config.baseURL);
      setApiKey('');
      setModel(config.model);
    }
  }, [config, settingsOpen]);

  const handleSave = async () => {
    const ok = await saveConfig({ baseURL, apiKey, model });
    if (ok) setSettingsOpen(false);
  };

  return (
    <aside className={`sp-sidebar-nav${collapsed ? ' collapsed' : ''}`}>
      {/* 品牌区 + 收起按钮 */}
      <div className="sp-sn-brand">
        <div className="sp-sn-logo">AI</div>
        {!collapsed && <span className="sp-sn-brand-name">Task Flow</span>}
        <button
          className="sp-sn-collapse"
          onClick={toggleCollapse}
          title={collapsed ? '展开导航' : '收起导航'}
        >
          {collapsed ? <PanelLeftOpen size={18} strokeWidth={2} /> : <PanelLeftClose size={18} strokeWidth={2} />}
        </button>
      </div>

      {/* 导航项 */}
      <nav className="sp-sn-items">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            className={`sp-sn-item ${currentView === item.key ? 'active' : ''}`}
            onClick={() => onViewChange(item.key)}
            title={collapsed ? item.label : undefined}
          >
            <span className="sp-sn-item-icon">{item.icon}</span>
            {!collapsed && <span className="sp-sn-item-label">{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* 底部功能区 */}
      <div className="sp-sn-footer">
        <button
          className="sp-sn-foot-btn"
          onClick={toggleTheme}
          title={collapsed ? (theme === 'dark' ? '切到浅色' : '切到深色') : undefined}
        >
          {theme === 'dark' ? <Sun size={18} strokeWidth={2} /> : <Moon size={18} strokeWidth={2} />}
          {!collapsed && <span>{theme === 'dark' ? '浅色' : '深色'}</span>}
        </button>
        <button
          className="sp-sn-foot-btn"
          onClick={handleOpenSettings}
          title={collapsed ? 'LLM 设置' : undefined}
        >
          <Settings size={18} strokeWidth={2} />
          {!collapsed && <span>LLM 设置</span>}
        </button>
      </div>

      {/* LLM 设置 Modal（逻辑自原 AppNav 迁移） */}
      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="LLM 配置"
        footer={
          <>
            <button className="sp-btn sp-btn--secondary" onClick={() => setSettingsOpen(false)}>
              取消
            </button>
            <button className="sp-btn sp-btn--primary" onClick={handleSave} disabled={saving}>
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
    </aside>
  );
};
