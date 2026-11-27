// backend/src/interfaces/http/routes/knowledgeRoutes.ts
// 知识库 REST API
import { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { KnowledgeService } from '../../../application/knowledge/KnowledgeService.js';
import { importKnowledgeFiles } from '../../../application/knowledge/KnowledgeImportService.js';
import { exportKnowledge } from '../../../application/knowledge/KnowledgeExportService.js';
import { isLocalAccess } from '../../../utils/localAccess.js';
import type {
  KnowledgeCreateRequest,
  KnowledgeSaveRequest,
  KnowledgeDocMetaUpdateRequest,
  KnowledgeAssociation,
  KnowledgeImportFile,
} from '@ai-task-flow/shared';

/** 选择文件导入的上限:单文件 5MB(文本与二进制同口径)、单批 500 篇(整体 body 另有 25MB 上限) */
const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_FILES = 500;

/** 可导入的文件类型:文本 + 知识库能预览/下载的二进制(与导出保持对称) */
const IMPORT_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.json', '.csv', '.html', '.htm', '.yml', '.yaml',
  '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.docx',
]);

/** 把 unknown 异常收窄成可展示文案(不向调用方暴露内部对象) */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 导出文件名时间戳(ASCII,避免 Content-Disposition 中文编码问题) */
function exportStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}`
  );
}

/** 关联字段白名单:只接受字符串(undefined=不清空/保持缺省),统一 trim;旧 requirementId 忽略 */
const ASSOCIATION_KEYS = ['versionId', 'projectId', 'stage'] as const;

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
    } catch (err) {
      return reply.status(500).send({ error: `生成 manifest 失败: ${errorText(err)}` });
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
    } catch (err) {
      if (errorText(err).includes('路径越界')) {
        return reply.status(403).send({ error: errorText(err) });
      }
      return reply.status(400).send({ error: `读取文档失败: ${errorText(err)}` });
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
    } catch (err) {
      if (errorText(err).includes('路径越界')) {
        return reply.status(403).send({ error: errorText(err) });
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
    } catch (err) {
      if (errorText(err).includes('路径越界')) {
        return reply.status(403).send({ error: errorText(err) });
      }
      return reply.status(400).send({ error: `删除失败: ${errorText(err)}` });
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
    } catch (err) {
      if (errorText(err).includes('路径越界')) {
        return reply.status(403).send({ error: errorText(err) });
      }
      return reply.status(400).send({ error: `创建失败: ${errorText(err)}` });
    }
  });

  // GET /api/knowledge/export - 导出整个知识库为 zip
  // 保持相对路径与文件原样,解压后可直接用「选择文件夹」导回。
  fastify.get('/api/knowledge/export', async (request, reply) => {
    if (!isLocalAccess(request.ip)) {
      return reply.status(403).send({ error: '仅允许本机导出' });
    }

    try {
      const { buffer, fileCount } = await exportKnowledge(knowledgeService.getRoot());
      if (fileCount === 0) {
        return reply.status(404).send({ error: '知识库还没有文档,没有可导出的内容' });
      }
      return reply
        .type('application/zip')
        .header('Content-Disposition', `attachment; filename="knowledge-base-${exportStamp(new Date())}.zip"`)
        .send(buffer);
    } catch (err) {
      return reply.status(400).send({ error: `导出失败: ${errorText(err)}` });
    }
  });

  // POST /api/knowledge/import/files - 用户从「选择文件/选择文件夹」导入文本
  // 只接受内容,不接受 sourceDir;路径在服务层归一化并做越界校验。
  fastify.post<{ Body: { files?: unknown } }>('/api/knowledge/import/files', async (request, reply) => {
    if (!isLocalAccess(request.ip)) {
      return reply.status(403).send({ error: '仅允许本机调用导入' });
    }
    const rawFiles = request.body?.files;
    if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
      return reply.status(400).send({ error: 'files 必须是非空数组' });
    }
    if (rawFiles.length > MAX_IMPORT_FILES) {
      return reply.status(400).send({ error: `单次最多导入 ${MAX_IMPORT_FILES} 个文件` });
    }

    const files: KnowledgeImportFile[] = [];
    for (const item of rawFiles) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return reply.status(400).send({ error: 'files 中每一项必须为对象' });
      }
      const record = item as Record<string, unknown>;
      if (typeof record.path !== 'string' || !record.path.trim()) {
        return reply.status(400).send({ error: '每个文件必须包含 path' });
      }
      if (typeof record.content !== 'string') {
        return reply.status(400).send({ error: `${record.path} 的 content 必须为字符串` });
      }
      // 编码:缺省 utf8;二进制(图片/PDF/docx)走 base64
      const encoding = record.encoding ?? 'utf8';
      if (encoding !== 'utf8' && encoding !== 'base64') {
        return reply.status(400).send({ error: `${record.path} 的 encoding 只支持 utf8/base64` });
      }
      // 类型白名单放服务端:前端过滤只是体验,HTTP 直调不能绕过
      const ext = path.extname(record.path).toLowerCase();
      if (!IMPORT_EXTENSIONS.has(ext)) {
        return reply.status(400).send({ error: `${record.path} 不支持的文件类型` });
      }
      const byteLength =
        encoding === 'base64'
          ? Buffer.byteLength(record.content, 'base64')
          : Buffer.byteLength(record.content, 'utf8');
      if (byteLength > MAX_IMPORT_FILE_BYTES) {
        return reply.status(400).send({ error: `${record.path} 超过 5MB,已跳过整批导入` });
      }
      files.push({ path: record.path.trim(), content: record.content, encoding });
    }

    try {
      const report = await importKnowledgeFiles(knowledgeService.getRoot(), files);
      await knowledgeService.refreshManifest();
      return report;
    } catch (err) {
      return reply.status(400).send({ error: `导入失败: ${errorText(err)}` });
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
    } catch (err) {
      if (errorText(err).includes('路径越界')) {
        return reply.status(403).send({ error: errorText(err) });
      }
      if (errorText(err) === '文件不存在') {
        return reply.status(404).send({ error: errorText(err) });
      }
      return reply.status(400).send({ error: `保存失败: ${errorText(err)}` });
    }
  });

  // PUT /api/knowledge/doc/meta - 编辑三项关联(版本/项目/阶段)
  // body: { path, versionId?, projectId?, stage? };空串/缺省=清除,其他 frontmatter 键保留
  fastify.put<{
    Body: KnowledgeDocMetaUpdateRequest;
  }>('/api/knowledge/doc/meta', async (request, reply) => {
    // 运行时校验:类型错误直接 400,避免把内部 TypeError 文案透给前端
    const body = (request.body ?? {}) as unknown as Record<string, unknown>;
    const relPath = body.path;
    if (typeof relPath !== 'string' || relPath.trim() === '') {
      return reply.status(400).send({ error: '缺少 path 参数或 path 不是字符串' });
    }

    const association: KnowledgeAssociation = {};
    for (const key of ASSOCIATION_KEYS) {
      const value = body[key];
      if (value === undefined) continue;
      if (typeof value !== 'string') {
        return reply.status(400).send({ error: `${key} 必须是字符串` });
      }
      association[key] = value.trim();
    }

    try {
      const result = await knowledgeService.updateDocMeta(relPath, association);
      return { ok: true, path: result.path };
    } catch (err) {
      if (errorText(err).includes('路径越界')) {
        return reply.status(403).send({ error: errorText(err) });
      }
      if (errorText(err) === '文件不存在') {
        return reply.status(404).send({ error: errorText(err) });
      }
      return reply.status(400).send({ error: `更新关联失败: ${errorText(err)}` });
    }
  });
}
