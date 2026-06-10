// frontend/src/components/AppNav.tsx
import React from 'react';
import { LayoutGrid, MessageSquare } from 'lucide-react';
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

        {/* 右侧操作区（预留，可放用户头像/设置） */}
        <div className="sp-nav-actions">
          {/* 预留 */}
        </div>
      </div>
    </nav>
  );
};
