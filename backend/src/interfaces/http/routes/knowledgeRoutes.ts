// backend/src/interfaces/http/routes/knowledgeRoutes.ts
// 知识库 REST API
import { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { KnowledgeService } from '../../../application/knowledge/KnowledgeService.js';

export async function registerKnowledgeRoutes(
  fastify: FastifyInstance,
  knowledgeService: KnowledgeService,
) {
  // GET /api/knowledge/manifest - 获取完整 manifest(目录树 + 索引)
  fastify.get('/api/knowledge/manifest', async (request, reply) => {
    try {
      // 强制刷新:每次请求都重新扫描(简单方案,避免缓存过期)
      const manifest = await knowledgeService.refreshManifest();
      return manifest;
    } catch (err: any) {
      return reply.status(500).send({ error: `生成 manifest 失败: ${err.message}` });
    }
  });

  // GET /api/knowledge/doc?path=xxx - 读取单个文档
  fastify.get<{
    Querystring: { path?: string };
  }>('/api/knowledge/doc', async (request, reply) => {
    const { path } = request.query;
    if (!path) {
      return reply.status(400).send({ error: '缺少 path 参数' });
    }

    try {
      const doc = await knowledgeService.getDoc(path);
      return doc;
    } catch (err: any) {
      if (err.message.includes('路径越界')) {
        return reply.status(403).send({ error: err.message });
      }
      return reply.status(400).send({ error: `读取文档失败: ${err.message}` });
    }
  });

  // GET /api/knowledge/raw?path=xxx - 原始文件(pdf/img/html/docx)
  fastify.get<{
    Querystring: { path?: string };
  }>('/api/knowledge/raw', async (request, reply) => {
    const { path: relPath } = request.query;
    if (!relPath) {
      return reply.status(400).send({ error: '缺少 path 参数' });
    }

    try {
      const absPath = knowledgeService.getRawPath(relPath);
      // 检查文件是否存在
      await fs.access(absPath);

      // 设置正确的 Content-Type
      const ext = path.extname(absPath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.html': 'text/html',
        '.htm': 'text/html',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };

      const contentType = mimeTypes[ext] || 'application/octet-stream';

      // 读取文件并发送
      const content = await fs.readFile(absPath);
      return reply.type(contentType).send(content);
    } catch (err: any) {
      if (err.message?.includes('路径越界')) {
        return reply.status(403).send({ error: err.message });
      }
      return reply.status(404).send({ error: '文件不存在' });
    }
  });

  // DELETE /api/knowledge/doc?path=xxx - 删除文档
  fastify.delete<{
    Querystring: { path?: string };
  }>('/api/knowledge/doc', async (request, reply) => {
    const { path } = request.query;
    if (!path) {
      return reply.status(400).send({ error: '缺少 path 参数' });
    }

    try {
      await knowledgeService.deleteDoc(path);
      return { ok: true };
    } catch (err: any) {
      if (err.message.includes('路径越界')) {
        return reply.status(403).send({ error: err.message });
      }
      return reply.status(400).send({ error: `删除失败: ${err.message}` });
    }
  });
}
