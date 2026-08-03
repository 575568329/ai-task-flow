// frontend/src/components/chat/MermaidBlock.tsx
// Mermaid 图表渲染:mermaid.render 异步生成 SVG,点击可调用已有 lightbox 预览放大。
import { useEffect, useState } from 'react';
import mermaid from 'mermaid';
import { usePreviewStore } from '@/stores/previewStore';

mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });

// 运行时递增的图表 id(mermaid 要求唯一)
let diagramSeq = 0;

interface MermaidBlockProps {
  code: string;
}

export function MermaidBlock({ code }: MermaidBlockProps) {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const openPreview = usePreviewStore((s) => s.open);

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
  const dataUrl = svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : '';

  return (
    <div
      className="my-2 cursor-zoom-in overflow-x-auto rounded-md border p-2"
      dangerouslySetInnerHTML={{ __html: svg }}
      onClick={() => dataUrl && openPreview(dataUrl)}
    />
  );
}
