// extension/src/content/__tests__/images.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { collectImages } from '../images.js';

beforeEach(() => {
  // mock fetch → 返回 Blob，供 FileReader 转 base64
  global.fetch = vi.fn(async () => ({
    blob: async () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }),
  })) as unknown as typeof fetch;
});

describe('collectImages', () => {
  it('should convert images to base64 and name them img-1..N in DOM order', async () => {
    document.body.innerHTML = '<img src="https://a.com/1.png" /><img src="https://a.com/2.png" />';
    const images = await collectImages(document.body);
    expect(images).toHaveLength(2);
    expect(images[0].name).toBe('img-1');
    expect(images[1].name).toBe('img-2');
    expect(images[0].base64).toMatch(/^data:image\/png;base64,/);
  });

  it('should skip images whose fetch fails (CORS) without aborting', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      throw new Error('CORS blocked');
    });
    document.body.innerHTML = '<img src="https://a.com/bad.png" /><img src="https://a.com/ok.png" />';
    const images = await collectImages(document.body);
    // 第一张失败被跳过，第二张仍按原 DOM 序号命名 img-2（保证 manifest 不误导 LLM）
    expect(images).toHaveLength(1);
    expect(images[0].name).toBe('img-2');
    expect(images[0].base64).toMatch(/^data:/);
  });

  it('should dedupe identical srcs', async () => {
    document.body.innerHTML = '<img src="https://a.com/dup.png" /><img src="https://a.com/dup.png" />';
    const images = await collectImages(document.body);
    expect(images).toHaveLength(1);
    expect(images[0].name).toBe('img-1');
  });
});
