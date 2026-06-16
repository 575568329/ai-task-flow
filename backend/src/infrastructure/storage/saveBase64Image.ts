// backend/src/infrastructure/storage/saveBase64Image.ts
// 把网页剪藏抓取的图片落盘到 uploads 目录,返回可被前端/Claude 访问的相对路径
// /api/uploads/<hash>.<ext>。与上传路由(/api/upload 的 multipart 路径)共用同一静态托管目录。
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { uploadsDirPath } from '../../config/dataDir.js';

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

/**
 * 把图片(base64 data URL)落盘到 uploads 目录,
 * 返回可被前端/Claude 访问的相对路径 /api/uploads/<hash>.<ext>。
 *
 * 兼容网页剪藏跨域 fetch 时的异常格式:
 * - 标准 data URL:`data:image/png;base64,...`
 * - 空 / 非 image mime 的 data URL:`data:;base64,...`、`data:application/octet-stream;base64,...`
 *   (跨域 fetch 时服务器常不返回 Content-Type → blob.type 为空 → FileReader 产出空 mime,
 *    旧正则要求 image/* 会把它误判为非法而全部丢弃,导致"采到图但草案无图")
 * mime 不是 image/* 或缺失时按 png 兜底;无 data: 前缀直接抛错
 * (扩展端 FileReader 一定产出 data: 前缀,裸 base64 不在支持范围内)。
 *
 * @param data      data:image/<type>;base64,<payload>(mime 段可空)
 * @param customDir 可选自定义目录(测试注入),默认 uploadsDirPath()
 */
export async function saveBase64Image(data: string, customDir?: string): Promise<string> {
  // 提取 data URL 的 mime(允许为空)与 base64 payload;不是 data:...;base64, 形式直接拒绝。
  // mime 段允许为空(跨域 fetch blob.type 丢失),并跳过 charset 等额外参数。
  const match = /^data:([^;,]*)(?:;[^;,]*)*;base64,(.+)$/is.exec(data);
  if (!match) {
    throw new Error(`Invalid base64 image data URL (前缀: ${data.slice(0, 60)})`);
  }
  const mime = match[1].toLowerCase();
  const payload = match[2].replace(/\s/g, ''); // 清除换行/空白,某些编码器会插入

  if (!payload) {
    throw new Error(`Invalid base64 image: 空 payload (前缀: ${data.slice(0, 60)})`);
  }
  const buffer = Buffer.from(payload, 'base64');
  if (buffer.length === 0) {
    throw new Error(`Invalid base64 image: 解码为空 (前缀: ${data.slice(0, 60)})`);
  }

  const ext = MIME_TO_EXT[mime] ?? 'png';
  const dir = customDir ?? uploadsDirPath();
  await fs.mkdir(dir, { recursive: true });
  const filename = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  await fs.writeFile(path.join(dir, filename), buffer);

  return `/api/uploads/${filename}`;
}
