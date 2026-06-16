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
import { StorageManager } from './StorageManager';
import { llmConfigApi } from '@/api/llmConfig';
import { toast } from './ui/Toaster';
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
  const [settingsTab, setSettingsTab] = useState<'llm' | 'storage'>('llm');
  const [testing, setTesting] = useState(false);

  const config = useLlmConfigStore((s) => s.config);
  const fetchConfig = useLlmConfigStore((s) => s.fetchConfig);
  const saveConfig = useLlmConfigStore((s) => s.saveConfig);
  const saving = useLlmConfigStore((s) => s.saving);

  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const localAccess = useUIStore((s) => s.localAccess);
  const storageWarn = useUIStore((s) => s.storageWarn);

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

  // 测试连接:用当前表单填的 baseURL/key/model 发最小请求验证。key 留空时后端复用已保存的 key。
  const handleTest = async () => {
    if (!baseURL.trim() || !model.trim()) {
      toast.error('请先填写 API 地址和模型名称');
      return;
    }
    setTesting(true);
    try {
      const result = await llmConfigApi.test({ baseURL, apiKey, model });
      if (result.success) toast.success(result.message);
      else toast.error(result.message);
    } catch {
      // http 封装已 toast,无需重复
    } finally {
      setTesting(false);
    }
  };

  // 实时检测协议(与后端 createProvider 逻辑一致):设置页直观展示当前走 OpenAI 还是 Anthropic
  const isAnthropicProtocol = /\/anthropic(\/|$)/i.test(baseURL.trim());

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
        {localAccess && (
          <button
            className="sp-sn-foot-btn"
            onClick={() => {
              // 有存储告警时直接跳到存储管理 Tab
              setSettingsTab(storageWarn ? 'storage' : 'llm');
              handleOpenSettings();
            }}
            title={collapsed ? (storageWarn ? '设置(有存储告警)' : '设置') : undefined}
            style={{ position: 'relative' }}
          >
            <Settings size={18} strokeWidth={2} />
            {!collapsed && <span>设置</span>}
            {storageWarn && <span className="sp-sn-badge" title="存储占用超阈值" />}
          </button>
        )}
      </div>

      {/* 设置 Modal:LLM 配置 + 存储管理(双 Tab)。非本机访问时不渲染入口,整组屏蔽 */}
      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="设置"
        width={560}
        footer={
          settingsTab === 'llm' ? (
            <>
              <button
                className="sp-btn sp-btn--secondary"
                onClick={handleTest}
                disabled={testing || saving}
                title="用当前填写的地址/模型发一个最小请求,验证是否可用(不会保存)"
              >
                {testing ? '测试中...' : '测试连接'}
              </button>
              <button className="sp-btn sp-btn--secondary" onClick={() => setSettingsOpen(false)}>
                取消
              </button>
              <button className="sp-btn sp-btn--primary" onClick={handleSave} disabled={saving}>
                {saving ? '保存中...' : '保存'}
              </button>
            </>
          ) : (
            <button className="sp-btn sp-btn--secondary" onClick={() => setSettingsOpen(false)}>
              关闭
            </button>
          )
        }
      >
        {/* Tab 头 */}
        <div
          className="sp-settings-tabs"
          style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-primary)', marginBottom: 16 }}
        >
          <button
            className={`sp-settings-tab${settingsTab === 'llm' ? ' active' : ''}`}
            onClick={() => setSettingsTab('llm')}
            style={{
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 500,
              color: settingsTab === 'llm' ? 'var(--primary-6)' : 'var(--text-3)',
              borderBottom: settingsTab === 'llm' ? '2px solid var(--primary-6)' : '2px solid transparent',
            }}
          >
            LLM 配置
          </button>
          <button
            className={`sp-settings-tab${settingsTab === 'storage' ? ' active' : ''}`}
            onClick={() => setSettingsTab('storage')}
            style={{
              position: 'relative',
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 500,
              color: settingsTab === 'storage' ? 'var(--primary-6)' : 'var(--text-3)',
              borderBottom: settingsTab === 'storage' ? '2px solid var(--primary-6)' : '2px solid transparent',
            }}
          >
            存储管理
            {storageWarn && <span className="sp-sn-badge" style={{ top: 6, right: 4 }} />}
          </button>
        </div>

        {settingsTab === 'llm' ? (
          <div className="sp-settings-form">
            <label className="sp-field">
              <span className="sp-field-label">API 地址</span>
              <input
                className="sp-input"
                value={baseURL}
                onChange={(e) => setBaseURL(e.target.value)}
                placeholder="https://open.bigmodel.cn/api/paas/v4 或 .../api/anthropic"
              />
              {baseURL.trim() && (
                <span className="sp-field-hint" style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 10,
                      fontSize: 11,
                      fontWeight: 600,
                      backgroundColor: isAnthropicProtocol ? 'var(--primary-3)' : 'var(--surface-2)',
                      color: isAnthropicProtocol ? 'var(--primary-9)' : 'var(--text-2)',
                    }}
                  >
                    {isAnthropicProtocol ? 'Anthropic 协议' : 'OpenAI 兼容协议'}
                  </span>
                  <span style={{ opacity: 0.7 }}>
                    {isAnthropicProtocol ? '/v1/messages · 智谱 Coding Plan / Claude 官方' : '/chat/completions · paas/v4 / DeepSeek / OpenAI 等'}
                  </span>
                </span>
              )}
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
        ) : (
          <StorageManager />
        )}
      </Modal>
    </aside>
  );
};
