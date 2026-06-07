// backend/src/interfaces/http/routes/uploadRoutes.ts
import { FastifyInstance } from 'fastify';
import path from 'path';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import crypto from 'crypto';
import type { UploadImageResponse } from '@ai-task-flow/shared';
import { uploadsDirPath } from '../../../config/dataDir.js';

export async function registerUploadRoutes(fastify: FastifyInstance, customUploadsDir?: string) {
  // 确保上传目录存在(默认数据目录/uploads,与 server.ts 中静态托管路径一致)
  const uploadsDir = customUploadsDir ?? uploadsDirPath();
  await fs.mkdir(uploadsDir, { recursive: true });

  // POST /api/upload/image - 上传图片
  fastify.post('/api/upload/image', async (request, reply) => {
    const data = await request.file();

    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    // 验证文件类型
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedMimeTypes.includes(data.mimetype)) {
      return reply.status(400).send({ error: 'Invalid file type. Only images allowed.' });
    }

    // 生成唯一文件名
    const ext = path.extname(data.filename);
    const hash = crypto.randomBytes(16).toString('hex');
    const filename = `${hash}${ext}`;
    const filepath = path.join(uploadsDir, filename);

    // 保存文件
    await pipeline(data.file, createWriteStream(filepath));

    const response: UploadImageResponse = {
      url: `/api/uploads/${filename}`,
    };

    return reply.status(201).send(response);
  });

  // GET /api/uploads/:filename - 静态文件服务
  fastify.get('/api/uploads/:filename', async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const filepath = path.join(uploadsDir, filename);

    try {
      await fs.access(filepath);
      return reply.sendFile(filename, uploadsDir);
    } catch {
      return reply.status(404).send({ error: 'File not found' });
    }
  });
}
