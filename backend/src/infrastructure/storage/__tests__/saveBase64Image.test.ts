// backend/src/infrastructure/storage/__tests__/saveBase64Image.test.ts
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { saveBase64Image } from '../saveBase64Image.js';

describe('saveBase64Image', () => {
  let uploadsDir: string;
  // 1x1 透明 png 的 base64(不含 data: 前缀),各用例复用
  const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

  beforeEach(() => {
    // 用临时目录覆盖,避免污染真实 uploads;通过 customDir 参数显式注入
    uploadsDir = path.join(os.tmpdir(), `test-uploads-${Date.now()}`);
  });

  afterEach(async () => {
    try { await fs.rm(uploadsDir, { recursive: true, force: true }); } catch {}
  });

  it('should save png base64 and return /api/uploads url', async () => {
    const url = await saveBase64Image(`data:image/png;base64,${PNG_BASE64}`, uploadsDir);
    expect(url).toMatch(/^\/api\/uploads\/[a-f0-9]+\.png$/);
    const filename = url.replace('/api/uploads/', '');
    const stat = await fs.stat(path.join(uploadsDir, filename));
    expect(stat.size).toBeGreaterThan(0);
  });

  it('should throw on invalid data url', async () => {
    await expect(saveBase64Image('not-a-data-url', uploadsDir)).rejects.toThrow(/Invalid base64/);
  });

  it('should accept empty mime data url (cross-origin fetch loses Content-Type)', async () => {
    // 跨域 fetch 时 blob.type 为空 → FileReader 产出 data:;base64,...;必须接受并按 png 兜底,
    // 否则"采到图但草案无图"。这是网页剪藏扩展最常踩的坑(见 docs/20260617020000_踩坑记录.md)。
    const url = await saveBase64Image(`data:;base64,${PNG_BASE64}`, uploadsDir);
    expect(url).toMatch(/^\/api\/uploads\/[a-f0-9]+\.png$/);
  });

  it('should fall back to png ext for non-image mime', async () => {
    const url = await saveBase64Image(`data:application/octet-stream;base64,${PNG_BASE64}`, uploadsDir);
    expect(url).toMatch(/^\/api\/uploads\/[a-f0-9]+\.png$/);
  });
});
