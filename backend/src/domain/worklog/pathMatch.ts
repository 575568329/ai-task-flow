import fs from 'node:fs/promises';
import path from 'node:path';

/** WSL 挂载路径 → Windows 盘符:仅识别 /mnt/<单个字母>(/mnt/data、/mnt/wsl 等不动) */
const WSL_DRIVE_PATH = /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/;

/**
 * 归一化为比较键:反斜杠转正斜杠、折叠重复分隔符、WSL↔Windows 盘符互认、去尾分隔符、Windows 转小写。
 * WSL 侧 cwd(/mnt/d/xunfei/...)与页面绑定的 D:\xunfei\... 归一化后必须相等,
 * 否则同一条记录在两种宿主下归属判定结果不同。
 */
export function normalizePath(input: string): string {
  let value = input.trim().replace(/\\/g, '/');
  value = value.replace(/\/{2,}/g, '/');
  const wsl = WSL_DRIVE_PATH.exec(value);
  if (wsl) value = `${wsl[1].toLowerCase()}:/${wsl[2] ?? ''}`;
  if (value.length > 1 && !/^[a-zA-Z]:\/$/.test(value)) {
    value = value.replace(/\/+$/, '');
  }
  if (/^[a-zA-Z]:/.test(value)) value = value.toLowerCase();
  return value;
}

/** candidate 是否位于 parent 之内(按路径分隔符边界,避免 /a 匹配 /ab) */
export function isPathWithin(parent: string, candidate: string): boolean {
  const p = normalizePath(parent);
  const c = normalizePath(candidate);
  // 空父路径(含纯空白)归一化后为空串,不得被当作根 '/' 而匹配所有绝对路径
  if (!p) return false;
  if (p === c) return true;
  return c.startsWith(p.endsWith('/') ? p : `${p}/`);
}

export interface ProjectPathRef {
  projectId: string;
  path: string;
}

/** 返回最长前缀命中的 projectId;无命中返回 undefined */
export function findOwningProject(refs: ProjectPathRef[], candidate: string): string | undefined {
  let best: { projectId: string; length: number } | undefined;
  for (const ref of refs) {
    if (!isPathWithin(ref.path, candidate)) continue;
    const length = normalizePath(ref.path).length;
    if (!best || length > best.length) best = { projectId: ref.projectId, length };
  }
  return best?.projectId;
}

/** realpath 解析;目录已删除/网络盘/无权限时降级 path.resolve,绝不抛错 */
export async function resolveMatchPath(input: string): Promise<string> {
  try {
    return await fs.realpath(input);
  } catch {
    return path.resolve(input);
  }
}
