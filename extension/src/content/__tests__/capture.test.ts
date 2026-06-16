// extension/src/content/__tests__/capture.test.ts
import { describe, it, expect } from 'vitest';
import { capturePageContext } from '../capture.js';

describe('capturePageContext', () => {
  it('should return selection text when there is a selection', async () => {
    document.body.innerHTML =
      '<div><p id="a">审核判定页面文本未国际化</p><p>其他无关内容</p></div>';
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('a')!);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const ctx = await capturePageContext();
    expect(ctx.text).toContain('审核判定页面文本未国际化');
    expect(ctx.text).not.toContain('其他无关内容');
    expect(ctx.sourceUrl).toBe(location.href);
  });

  it('should fall back to body text when no selection', async () => {
    document.body.innerHTML =
      '<article><h1>标题</h1><p>这是一段正文内容用于回退提取。</p></article>';
    window.getSelection()?.removeAllRanges();

    const ctx = await capturePageContext();
    // Readability 提取；若 jsdom 下 Readability 返回空则回退 body.textContent。两者都应含正文关键词。
    expect(ctx.text).toContain('正文内容');
  });
});
