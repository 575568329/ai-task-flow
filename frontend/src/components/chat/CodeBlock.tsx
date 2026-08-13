// frontend/src/components/chat/CodeBlock.tsx
// 代码块:语法高亮 + 复制按钮。SyntaxHighlighter 动态 import(P2-23 懒加载,避免
// react-syntax-highlighter 进首屏 bundle;加载中用纯文本占位保持布局)。
import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { Check, Copy } from 'lucide-react';

type SHComp = typeof import('react-syntax-highlighter').Prism;
interface SHLoaded {
  Comp: SHComp;
  style: Record<string, CSSProperties>;
}

// 模块级缓存:SyntaxHighlighter + oneDark 主题只加载一次
let shPromise: Promise<SHLoaded> | null = null;
function loadSH(): Promise<SHLoaded> {
  if (!shPromise) {
    shPromise = Promise.all([
      import('react-syntax-highlighter'),
      import('react-syntax-highlighter/dist/esm/styles/prism'),
    ]).then(([sh, styles]) => ({
      Comp: sh.Prism,
      style: (styles as { oneDark: Record<string, CSSProperties> }).oneDark,
    }));
  }
  return shPromise;
}

interface CodeBlockProps {
  code: string;
  lang: string;
}

export function CodeBlock({ code, lang }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [sh, setSH] = useState<SHLoaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadSH().then((loaded) => {
      if (!cancelled) setSH(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板被浏览器拒绝时静默(用户可手动复制)
    }
  };

  return (
    <div className="group relative my-2 overflow-hidden rounded-md border">
      <div className="bg-muted text-muted-foreground flex items-center justify-between px-3 py-1 text-xs">
        <span>{lang}</span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 transition-colors hover:text-foreground"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      {sh ? (
        <sh.Comp
          language={lang}
          style={sh.style}
          customStyle={{ margin: 0, fontSize: '12px', padding: '12px' }}
        >
          {code}
        </sh.Comp>
      ) : (
        // 高亮库加载中:纯文本占位(保持布局,避免 CLS)
        <pre className="bg-muted/30 overflow-x-auto p-3 text-xs">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
