// backend/src/infrastructure/utils/safePath.ts
// 路径穿越防护:确保解析后的路径仍在 root 内
import path from 'node:path';

/**
 * 安全解析路径:root + sub,校验结果必须在 root 内(防止 ../ 越权)
 * @param root 根目录(绝对路径)
 * @param sub 子路径(相对路径,可选)
 * @returns 解析后的绝对路径
 * @throws Error 如果解析后路径在 root 外
 */
export function safeResolve(root: string, sub?: string): string {
  const normRoot = path.resolve(root);
  const abs = path.resolve(normRoot, sub ?? '.');

  // 允许等于 root 本身,或以 root + sep 开头
  if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) {
    throw new Error('路径越界,禁止访问 root 之外的文件');
  }

  return abs;
}

/**
 * 把绝对路径转回相对 root 的 posix 风格相对路径(前端用 / 拼接)
 */
export function toRelativePosix(root: string, abs: string): string {
  const normRoot = path.resolve(root);
  const rel = path.relative(normRoot, abs);
  // Windows 的 \ 转 /
  return rel.split(path.sep).join('/');
}
