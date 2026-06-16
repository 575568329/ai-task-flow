// backend/src/infrastructure/storage/saveBase64Image.ts
// 把 base64 data URL(网页剪藏抓取的图片)落盘到 uploads 目录,
// 返回可被前端/Claude 访问的相对路径 /api/uploads/<hash>.<ext>。
// 与上传路由(/api/upload 的 multipart 路径)共用同一静态托管目录。
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { uploadsDirPath } from '../../config/dataDir.js';

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/**
 * 把 base64 data URL(如 data:image/png;base64,...)落盘到 uploads 目录,
 * 返回可被前端/Claude 访问的相对路径 /api/uploads/<hash>.<ext>。
 *
 * @param dataUrl    data:image/<type>;base64,<payload>
 * @param customDir  可选自定义目录(测试注入),默认 uploadsDirPath()
 */
export async function saveBase64Image(dataUrl: string, customDir?: string): Promise<string> {
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) {
    throw new Error('Invalid base64 image data URL');
  }
  const mime = match[1].toLowerCase();
  const ext = MIME_TO_EXT[mime] ?? 'png';
  const buffer = Buffer.from(match[2], 'base64');

  const dir = customDir ?? uploadsDirPath();
  await fs.mkdir(dir, { recursive: true });
  const filename = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  await fs.writeFile(path.join(dir, filename), buffer);

  return `/api/uploads/${filename}`;
}
