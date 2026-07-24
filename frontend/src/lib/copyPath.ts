// frontend/src/lib/copyPath.ts
// 复制磁盘绝对路径到剪贴板:三个文档查看器(知识库/任务文档/项目文件)共用。
// 路径统一正斜杠——与 shared/utils/prompt.ts 把 taskFilePath 反斜杠转正斜杠的约定一致,
// Claude Read / VSCode / bash 均接受,跨平台一致。
import { toast } from '@/components/ui/toaster';

/**
 * 复制磁盘绝对路径到剪贴板,归一为正斜杠并去尾部分隔符。
 * 失败不静默——clipboard 不可用时 toast 提示。
 */
export async function copyDiskPath(raw: string): Promise<void> {
  if (!raw) {
    toast.error('路径为空');
    return;
  }
  const normalized = raw.replace(/\\/g, '/').replace(/\/+$/, '');
  try {
    await navigator.clipboard.writeText(normalized);
    toast.success('已复制路径');
  } catch {
    toast.error('复制失败,请手动选择路径');
  }
}
