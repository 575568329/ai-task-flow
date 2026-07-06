// frontend/src/components/chat/MermaidBlock.tsx
// Mermaid 图表渲染:mermaid.render 异步生成 SVG。
import { useEffect, useState } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });

// 运行时递增的图表 id(mermaid 要求唯一)
let diagramSeq = 0;

interface MermaidBlockProps {
  code: string;
}

export function MermaidBlock({ code }: MermaidBlockProps) {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-diagram-${++diagramSeq}`;
    mermaid
      .render(id, code)
      .then(({ svg: rendered }) => {
        if (!cancelled) setSvg(rendered);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return <pre className="text-destructive my-2 text-xs">图表渲染失败:{error}</pre>;
  }
  if (!svg) {
    return <div className="text-muted-foreground my-2 text-xs">渲染图表中…</div>;
  }
  return (
    <div
      className="my-2 overflow-x-auto rounded-md border p-2"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
