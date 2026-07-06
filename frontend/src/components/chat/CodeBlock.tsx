// frontend/src/components/chat/CodeBlock.tsx
// 代码块:语法高亮 + 复制按钮。
import { useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Check, Copy } from 'lucide-react';

interface CodeBlockProps {
  code: string;
  lang: string;
}

export function CodeBlock({ code, lang }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

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
      <SyntaxHighlighter
        language={lang}
        style={oneDark}
        customStyle={{ margin: 0, fontSize: '12px', padding: '12px' }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
