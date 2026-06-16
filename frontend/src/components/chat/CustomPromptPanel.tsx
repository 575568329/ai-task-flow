// frontend/src/components/chat/CustomPromptPanel.tsx
import React, { useEffect, useState } from 'react';
import { ChevronRight, Sparkles, Check } from 'lucide-react';
import './CustomPromptPanel.css';

interface CustomPromptPanelProps {
  /** 当前会话已保存的自定义需求 */
  value: string;
  /** 保存(失焦或点保存时触发),返回 Promise 用于显示保存中状态 */
  onSave: (prompt: string) => Promise<void>;
}

/**
 * 自定义需求侧边可折叠面板。
 * 每个对话独立:value 由父组件按当前会话传入,onSave 持久化到后端。
 * 内容会在每轮对话自动随系统提示带给大模型。
 */
export const CustomPromptPanel: React.FC<CustomPromptPanelProps> = ({ value, onSave }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // 切换会话时同步外部值
  useEffect(() => {
    setDraft(value);
    setJustSaved(false);
  }, [value]);

  const dirty = draft !== value;

  const handleSave = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await onSave(draft);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  };

  if (collapsed) {
    return (
      <button
        className="cpp-collapsed"
        onClick={() => setCollapsed(false)}
        title="展开自定义需求"
      >
        <Sparkles size={16} strokeWidth={2} />
      </button>
    );
  }

  return (
    <aside className="cpp-panel">
      <div className="cpp-header">
        <div className="cpp-header-title">
          <Sparkles size={15} strokeWidth={2} />
          <span>自定义需求</span>
        </div>
        <button
          className="cpp-collapse-btn"
          onClick={() => setCollapsed(true)}
          title="收起"
        >
          <ChevronRight size={16} strokeWidth={2} />
        </button>
      </div>

      <p className="cpp-hint">
        在这里写下对回答的固定要求(如语气、格式、侧重点),本对话每次提问都会自动带上。
      </p>

      <textarea
        className="cpp-textarea"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleSave}
        placeholder="例如:回答请用中文,结论先行,关键数据加粗,并给出可执行建议。"
      />

      <button
        className={`cpp-save-btn ${dirty ? 'active' : ''}`}
        onClick={handleSave}
        disabled={!dirty || saving}
      >
        {saving ? '保存中…' : justSaved ? (
          <>
            <Check size={14} strokeWidth={2} /> 已保存
          </>
        ) : '保存需求'}
      </button>
    </aside>
  );
};
