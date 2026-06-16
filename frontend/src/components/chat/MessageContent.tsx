// frontend/src/components/chat/MessageContent.tsx
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Source } from '@ai-task-flow/shared';
import './MessageContent.css';

interface MessageContentProps {
  /** assistant 正文,含 [n] 引用标记;支持 Markdown */
  content: string;
  /** 引用来源,用于把 [n] 渲染成可点角标 */
  sources?: Source[];
}

/**
 * 引用角标渲染:react-markdown 不支持自定义裸文本节点,
 * 故在块级元素(p/li/td/strong/em 等)的 children 上递归遍历,
 * 把字符串里的 [n] 替换为可点 sup 角标。
 * 递归是关键:[n] 可能嵌在加粗、斜体、链接等子元素内部,
 * 只处理直接字符串子节点会漏掉这些情况。
 */
function renderTextWithCitations(
  text: string,
  sources: Source[],
): React.ReactNode {
  if (sources.length === 0 || !text.includes('[')) return text;

  const citationRegex = /\[(\d+)\]/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = citationRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const num = parseInt(match[1], 10);
    const source = sources[num - 1];
    if (source) {
      parts.push(
        <sup
          key={`c-${key++}`}
          className="mc-citation"
          title={source.title}
          onClick={() => window.open(source.url, '_blank', 'noopener')}
        >
          {num}
        </sup>,
      );
    } else {
      parts.push(match[0]);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

/**
 * 递归处理 children:
 * - 字符串:正则替换 [n] → 角标
 * - React 元素:钻进它的 children 继续处理(保留元素本身的 props)
 * - 其他(数字/null 等):原样返回
 */
function processChildren(children: React.ReactNode, sources: Source[]): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === 'string') {
      return renderTextWithCitations(child, sources);
    }
    if (React.isValidElement(child)) {
      const element = child as React.ReactElement<{ children?: React.ReactNode }>;
      // 没有 children 的元素(如 <br/>、<img/>)直接返回,避免无意义克隆
      if (element.props.children == null) return child;
      return React.cloneElement(
        element,
        undefined,
        processChildren(element.props.children, sources),
      );
    }
    return child;
  });
}

/**
 * 消息正文渲染:Markdown 富文本 + 可点引用角标。
 * 可复用组件,UI 与业务解耦,后续可抽入组件库。
 */
export const MessageContent: React.FC<MessageContentProps> = ({ content, sources = [] }) => {
  // 统一的引用处理渲染器:在文本容器上递归替换 [n] → 角标
  const cite = (children: React.ReactNode) => processChildren(children, sources);

  return (
    <div className="mc-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 所有可能承载正文的元素都走引用处理(递归会继续钻入子元素)
          p: ({ children }) => <p>{cite(children)}</p>,
          li: ({ children }) => <li>{cite(children)}</li>,
          td: ({ children }) => <td>{cite(children)}</td>,
          th: ({ children }) => <th>{cite(children)}</th>,
          h1: ({ children }) => <h1>{cite(children)}</h1>,
          h2: ({ children }) => <h2>{cite(children)}</h2>,
          h3: ({ children }) => <h3>{cite(children)}</h3>,
          h4: ({ children }) => <h4>{cite(children)}</h4>,
          blockquote: ({ children }) => <blockquote>{cite(children)}</blockquote>,
          // 外链统一新标签打开
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
