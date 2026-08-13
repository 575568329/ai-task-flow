// frontend/src/components/chat/MermaidBlock.tsx
// Mermaid 图表渲染:mermaid 动态 import(P2-23 懒加载,避免 mermaid 库进首屏 bundle)。
// mermaid.render 异步生成 SVG,点击调 lightbox 预览放大。
import { useEffect, useState } from 'react';
import { usePreviewStore } from '@/stores/previewStore';

type MermaidApi = typeof import('mermaid').default;
// 模块级缓存:mermaid 库只加载+初始化一次(多个 MermaidBlock 共享)
let mermaidPromise: Promise<MermaidApi> | null = null;
function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      m.default.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });
      return m.default;
    });
  }
  return mermaidPromise;
}

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
    loadMermaid()
      .then((m) => m.render(id, code))
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
