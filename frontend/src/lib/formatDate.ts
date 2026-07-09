// frontend/src/lib/formatDate.ts
// 相对时间格式化(知识库文件创建/修改日期展示用)。

/** 把 Unix 秒格式化为相对时间(刚刚/N分钟前/昨天/N天前),超过 30 天回退 yyyy-MM-dd */
export function formatRelativeTime(unixSeconds: number): string {
  const then = unixSeconds * 1000;
  const diff = Date.now() - then;
  if (diff < 0) return '刚刚'; // 未来时间兜底
  const min = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;
  if (diff < min) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / min)}分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)}小时前`;
  if (diff < 2 * day) return '昨天';
  if (diff < 30 * day) return `${Math.floor(diff / day)}天前`;
  const d = new Date(then);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dd}`;
}
