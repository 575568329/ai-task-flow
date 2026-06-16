// frontend/src/components/chat/SourceList.tsx
import React from 'react';
import { ExternalLink } from 'lucide-react';
import type { Source } from '@ai-task-flow/shared';
import './SourceList.css';

interface SourceListProps {
  sources: Source[];
}

/** 安全提取域名:url 畸形(相对路径/空串)时降级显示,绝不抛错拖垮整页 */
function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url || '链接';
  }
}

/** 引用来源列表:展示 assistant 回答引用了哪些资料,可点击跳转 */
export const SourceList: React.FC<SourceListProps> = ({ sources }) => {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="sl-wrapper">
      <div className="sl-title">引用来源 · {sources.length}</div>
      <div className="sl-list">
        {sources.map((s) => (
          <a
            key={s.index}
            className="sl-item"
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            title={s.snippet}
          >
            <span className="sl-index">{s.index}</span>
            <span className="sl-item-body">
              <span className="sl-item-title">{s.title}</span>
              <span className="sl-item-url">
                {s.sourceType === 'arxiv' ? 'arXiv' : safeHostname(s.url)}
                <ExternalLink size={11} strokeWidth={2} />
              </span>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
};
