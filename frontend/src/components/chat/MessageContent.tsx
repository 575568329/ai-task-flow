// frontend/src/components/chat/MessageContent.tsx
// Markdown 渲染:代码块→CodeBlock,mermaid→MermaidBlock,其余标签自覆盖样式(不依赖 typography 插件)。
// 图片点击触发全局预览蒙版(previewStore)。
import { Children, isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
// 渲染文档内嵌的 HTML(如翻译文案里的 <br>);本工具内容来自本地任务/文档/AI,风险可接受
import rehypeRaw from 'rehype-raw';
import type { Components } from 'react-markdown';
import { CodeBlock } from './CodeBlock';
import { MermaidBlock } from './MermaidBlock';
import { usePreviewStore } from '@/stores/previewStore';
import { cn } from '@/lib/utils';

interface MessageContentProps {
  content: string;
}

const components: Components = {
  // fenced code 在 pre 收口:react-markdown v9 移除了 code 组件的 inline prop,无法在 code 内
  // 区分块级/行内;而裸围栏(无 language 标注)的 code 没有 className,会落到行内分支,导致
  // 多行内容(如文件树、数据流图)被浏览器折叠空白压成一段乱码。改由 pre 提取子 code 的语言
  // 与文本,统一分流到 CodeBlock / MermaidBlock;code 组件只负责行内样式。
  pre: ({ children }) => {
    const child = Children.toArray(children)[0];
    if (!isValidElement(child)) {
      return <pre>{children}</pre>;
    }
    const { className, children: codeChildren } = child.props as unknown as {
      className?: string;
      children?: ReactNode;
    };
    const match = /language-(\w+)/.exec(className ?? '');
    const lang = match?.[1] ?? '';
    const code = String(codeChildren ?? '').replace(/\n$/, '');
    if (lang === 'mermaid') return <MermaidBlock code={code} />;
    return <CodeBlock code={code} lang={lang} />;
  },
  code: ({ className, children }) => (
    <code className={cn('bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]', className)}>
      {children}
    </code>
  ),
  p: ({ children }) => <p className="mb-2 leading-relaxed last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="mb-2 text-lg font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 text-base font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1.5 text-sm font-semibold">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-1 text-sm font-semibold">{children}</h4>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 pl-3 italic text-muted-foreground">
      {children}
    </blockquote>
  ),
  a: ({ children, ...props }) => (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2"
    >
      {children}
    </a>
  ),
  img: ({ src, alt }) => (
    <img
      src={src ?? ''}
      alt={alt ?? ''}
      className="max-w-full cursor-zoom-in rounded"
      onClick={() => {
        if (src) usePreviewStore.getState().open(src);
      }}
    />
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-border border px-2 py-1 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-border border px-2 py-1 align-top">{children}</td>
  ),
  hr: () => <hr className="my-3 border-t" />,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
};

export function MessageContent({ content }: MessageContentProps) {
  return (
    <div className="text-sm break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        remarkRehypeOptions={{ allowDangerousHtml: true }}
        rehypePlugins={[rehypeRaw]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
