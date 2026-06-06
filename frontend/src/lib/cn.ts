// frontend/src/lib/cn.ts
/** 极简 className 合并(过滤 falsy 并 join) */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
