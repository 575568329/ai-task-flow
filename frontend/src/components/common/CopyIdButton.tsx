// 数据 id 复制按钮:结论卡 c_xxx / 工作记录 e_xxx。
// 复制后可直接在 AI 对话里粘贴,让 AI 用 query_conclusions({cardId}) / query_work({entryId}) 精确定位。
import { Copy } from 'lucide-react';
import { toast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

interface Props {
  /** 完整数据 id(c_xxx / e_xxx),不是短 id */
  id: string;
  /** 前缀文案,默认「ID」 */
  label?: string;
  className?: string;
}

export function CopyIdButton({ id, label = 'ID', className }: Props) {
  const copy = async () => {
    if (!navigator.clipboard) {
      toast.error('当前环境不支持复制');
      return;
    }
    try {
      await navigator.clipboard.writeText(id);
      toast.success('ID 已复制');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`复制失败：${message}`);
    }
  };

  return (
    <button
      type="button"
      className={cn('hover:text-foreground inline-flex items-center gap-1 font-mono', className)}
      title={`复制 ${id}`}
      onClick={() => void copy()}
    >
      {label} {id}
      <Copy className="size-3" />
    </button>
  );
}
