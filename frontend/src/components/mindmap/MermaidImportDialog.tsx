// frontend/src/components/mindmap/MermaidImportDialog.tsx
// Mermaid 导入对话框：粘贴 flowchart 文本 → 子集 parser 解析 → 追加到当前画布。
// 解析失败（无头行/无节点）时行内提示，不弹 toast 干扰。
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

const EXAMPLE = `flowchart LR
  A[开始] --> B[处理]
  B --> C{判断}
  C -->|是| D[结束]
  C -->|否| B`;

export function MermaidImportDialog({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 返回是否导入成功（失败时对话框保持打开并提示） */
  onImport: (text: string) => boolean;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleImport = () => {
    if (!text.trim()) {
      setError('请粘贴 mermaid 文本');
      return;
    }
    const ok = onImport(text);
    if (ok) {
      setText('');
      setError(null);
      onOpenChange(false);
    } else {
      setError('解析失败：需要 flowchart/graph 头行，且至少包含一个节点');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>导入 Mermaid</DialogTitle>
          <DialogDescription>
            粘贴 flowchart 文本，解析为画布节点追加到当前文档（支持：节点形状文本、链式连线、边标签、环）。
            <button
              className="ml-1 text-primary underline-offset-2 hover:underline"
              onClick={() => setText(EXAMPLE)}
            >
              填入示例
            </button>
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          placeholder={EXAMPLE}
          className="min-h-[180px] font-mono text-xs"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleImport}>导入</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
