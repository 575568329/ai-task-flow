// backend/src/interfaces/http/routes/fileRoutes.ts
// 项目文件浏览:列目录(仅目录 + md 文件) + 读 md 内容 + 写回 md(项目文件编辑保存)。
// 安全核心:所有路径解析后必须仍在 root 内,拒绝 ../ 越权。
import { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_READ_BYTES = 2 * 1024 * 1024; // 单文件读取上限 2MB,避免误读巨型文件

/** 解析 root + sub 为绝对路径,并校验仍在 root 内 */
function safeResolve(root: string, sub?: string): string {
  const normRoot = path.resolve(root);
  const abs = path.resolve(normRoot, sub ?? '.');
  if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) {
    throw new Error('路径越界,禁止访问 root 之外的文件');
  }
  return abs;
}

function isMarkdown(name: string): boolean {
  return /\.(md|markdown)$/i.test(name);
}

/** 把绝对路径转回相对 root 的 posix 风格相对路径(前端用 / 拼接) */
function toRel(root: string, abs: string): string {
  const normRoot = path.resolve(root);
  const rel = path.relative(normRoot, abs).split(path.sep).join('/');
  return rel;
}

export async function registerFileRoutes(fastify: FastifyInstance) {
  // POST /api/files/list — 列一层:返回子目录 + md 文件
  fastify.post<{
    Body: { root: string; sub?: string };
  }>('/api/files/list', async (request, reply) => {
    const { root, sub } = request.body ?? {};
    if (!root) return reply.status(400).send({ error: '缺少 root' });

    let abs: string;
    try {
      abs = safeResolve(root, sub);
    } catch (e: any) {
      return reply.status(403).send({ error: e.message });
    }

    try {
      const entries = await fs.readdir(abs, { withFileTypes: true });
      const result = entries
        .filter((d) => d.isDirectory() || (d.isFile() && isMarkdown(d.name)))
        .map((d) => ({
          name: d.name,
          type: d.isDirectory() ? ('dir' as const) : ('file' as const),
          path: toRel(root, path.join(abs, d.name)),
        }))
        // 目录在前,文件在后,各自按名字排序
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      return { root: path.resolve(root), sub: sub ?? '', entries: result };
    } catch (e: any) {
      return reply.status(400).send({ error: `读取目录失败: ${e.message}` });
    }
  });

  // POST /api/files/read — 读单个 md 文件内容
  fastify.post<{
    Body: { root: string; path: string };
  }>('/api/files/read', async (request, reply) => {
    const { root, path: relPath } = request.body ?? {};
    if (!root || !relPath) return reply.status(400).send({ error: '缺少 root 或 path' });
    if (!isMarkdown(relPath)) return reply.status(400).send({ error: '仅支持读取 .md/.markdown 文件' });

    let abs: string;
    try {
      abs = safeResolve(root, relPath);
    } catch (e: any) {
      return reply.status(403).send({ error: e.message });
    }

    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile()) return reply.status(400).send({ error: '目标不是文件' });
      if (stat.size > MAX_READ_BYTES) {
        return reply.status(400).send({ error: `文件过大(${Math.round(stat.size / 1024)}KB),上限 2MB` });
      }
      const content = await fs.readFile(abs, 'utf-8');
      return { path: relPath, content };
    } catch (e: any) {
      return reply.status(400).send({ error: `读取文件失败: ${e.message}` });
    }
  });

  // POST /api/files/write — 写回单个 md 文件内容(项目文件编辑保存)
  fastify.post<{
    Body: { root: string; path: string; content: string };
  }>('/api/files/write', async (request, reply) => {
    const { root, path: relPath, content } = request.body ?? {};
    if (!root || !relPath) return reply.status(400).send({ error: '缺少 root 或 path' });
    if (!isMarkdown(relPath)) return reply.status(400).send({ error: '仅支持写入 .md/.markdown 文件' });

    let abs: string;
    try {
      abs = safeResolve(root, relPath);
    } catch (e: any) {
      return reply.status(403).send({ error: e.message });
    }

    try {
      // 仅允许覆盖已存在的文件,杜绝通过 write 在 root 内任意创建新文件
      const stat = await fs.stat(abs);
      if (!stat.isFile()) return reply.status(400).send({ error: '目标不是文件' });
      if (Buffer.byteLength(content, 'utf-8') > MAX_READ_BYTES) {
        return reply.status(400).send({ error: '内容过大,上限 2MB' });
      }
      await fs.writeFile(abs, content, 'utf-8');
      return { path: relPath, saved: true };
    } catch (e: any) {
      return reply.status(400).send({ error: `写入文件失败: ${e.message}` });
    }
  });
}
