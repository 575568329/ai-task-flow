// backend/src/infrastructure/storage/__tests__/saveBase64Image.test.ts
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { saveBase64Image } from '../saveBase64Image.js';

describe('saveBase64Image', () => {
  let uploadsDir: string;

  beforeEach(() => {
    // 用临时目录覆盖,避免污染真实 uploads;通过 customDir 参数显式注入
    uploadsDir = path.join(os.tmpdir(), `test-uploads-${Date.now()}`);
  });

  afterEach(async () => {
    try { await fs.rm(uploadsDir, { recursive: true, force: true }); } catch {}
  });

  it('should save png base64 and return /api/uploads url', async () => {
    // 1x1 透明 png 的 base64
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
    const url = await saveBase64Image(dataUrl, uploadsDir);
    expect(url).toMatch(/^\/api\/uploads\/[a-f0-9]+\.png$/);
    const filename = url.replace('/api/uploads/', '');
    const stat = await fs.stat(path.join(uploadsDir, filename));
    expect(stat.size).toBeGreaterThan(0);
  });

  it('should throw on invalid data url', async () => {
    await expect(saveBase64Image('not-a-data-url', uploadsDir)).rejects.toThrow(/Invalid base64/);
  });
});
