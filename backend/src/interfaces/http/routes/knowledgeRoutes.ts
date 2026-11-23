// backend/src/interfaces/http/routes/knowledgeRoutes.ts
// 知识库 REST API
import { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { KnowledgeService } from '../../../application/knowledge/KnowledgeService.js';
import { importKnowledge } from '../../../application/knowledge/KnowledgeImportService.js';
import { isLocalAccess } from '../../../utils/localAccess.js';
import type { KnowledgeCreateRequest, KnowledgeSaveRequest } from '@ai-task-flow/shared';

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

  // POST /api/knowledge/doc - 创建文档(文件名由服务端按命名规则生成,调用方无法干预)
  fastify.post<{
    Body: KnowledgeCreateRequest;
  }>('/api/knowledge/doc', async (request, reply) => {
    const body = request.body;
    if (!body || !body.title?.trim()) {
      return reply.status(400).send({ error: '标题不能为空' });
    }
    if (body.content == null) {
      return reply.status(400).send({ error: '缺少 content' });
    }

    try {
      const result = await knowledgeService.createDoc(body);
      return reply.status(201).send(result);
    } catch (err: any) {
      if (err.message.includes('路径越界')) {
        return reply.status(403).send({ error: err.message });
      }
      return reply.status(400).send({ error: `创建失败: ${err.message}` });
    }
  });

  // POST /api/knowledge/import - 一次性导入旧知识库(源目录固定为仓库内 knowledge-base)
  // 安全:刻意不接受 body 中的 sourceDir。后端 CORS 为 * 且 text/plain 可当 JSON 解析,
  // 任意网页都能发简单请求;若允许外部指定路径,回环 IP gate 挡不住,会把本机任意目录
  // 复制进知识库再经 manifest/raw 读出(跨站本地文件外泄)。源目录只由服务层按仓库位置解析。
  fastify.post('/api/knowledge/import', async (request, reply) => {
    if (!isLocalAccess(request.ip)) {
      return reply.status(403).send({ error: '仅允许本机调用导入' });
    }

    try {
      const report = await importKnowledge({ targetDir: knowledgeService.getRoot() });
      // 导入后刷新 manifest,前端随后拉取即可看到新文档
      await knowledgeService.refreshManifest();
      return report;
    } catch (err: any) {
      return reply.status(400).send({ error: `导入失败: ${err.message}` });
    }
  });

  // PUT /api/knowledge/doc?path=xxx - 覆盖更新已有文档(content 即完整 md 正文)
  fastify.put<{
    Querystring: { path?: string };
    Body: KnowledgeSaveRequest;
  }>('/api/knowledge/doc', async (request, reply) => {
    const { path } = request.query;
    if (!path) {
      return reply.status(400).send({ error: '缺少 path 参数' });
    }
    if (request.body?.content == null) {
      return reply.status(400).send({ error: '缺少 content' });
    }

    try {
      const result = await knowledgeService.saveDoc(path, request.body.content);
      return { ok: true, path: result.path };
    } catch (err: any) {
      if (err.message.includes('路径越界')) {
        return reply.status(403).send({ error: err.message });
      }
      if (err.message === '文件不存在') {
        return reply.status(404).send({ error: err.message });
      }
      return reply.status(400).send({ error: `保存失败: ${err.message}` });
    }
  });
}
