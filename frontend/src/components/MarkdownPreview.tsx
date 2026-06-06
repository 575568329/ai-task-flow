// frontend/src/components/MarkdownPreview.tsx
import ReactMarkdown from 'react-markdown';

interface MarkdownPreviewProps {
  markdown: string;
}

export function MarkdownPreview({ markdown }: MarkdownPreviewProps) {
  return (
    <div
      className="prose prose-sm max-w-none rounded-lg border p-4"
      style={{
        borderColor: 'var(--border-primary)',
        backgroundColor: 'var(--surface-1)',
        color: 'var(--text-1)',
      }}
    >
      <ReactMarkdown
        components={{
          h1: ({ children }) => (
            <h1 className="mb-3 text-xl font-bold" style={{ color: 'var(--text-1)' }}>
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-4 text-lg font-semibold" style={{ color: 'var(--text-1)' }}>
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-2 mt-3 text-base font-semibold" style={{ color: 'var(--text-1)' }}>
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="mb-2" style={{ color: 'var(--text-2)' }}>
              {children}
            </p>
          ),
          code: ({ children }) => (
            <code
              className="rounded px-1 py-0.5 font-mono text-xs"
              style={{ backgroundColor: 'var(--surface-2)', color: 'var(--primary-8)' }}
            >
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre
              className="my-2 overflow-x-auto rounded-lg p-3 font-mono text-xs"
              style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-2)' }}
            >
              {children}
            </pre>
          ),
          ul: ({ children }) => (
            <ul className="ml-4 list-disc" style={{ color: 'var(--text-2)' }}>
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="ml-4 list-decimal" style={{ color: 'var(--text-2)' }}>
              {children}
            </ol>
          ),
          img: ({ src, alt }) => (
            <img
              src={src}
              alt={alt}
              className="my-2 max-h-64 rounded border"
              style={{ borderColor: 'var(--border-primary)' }}
            />
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
