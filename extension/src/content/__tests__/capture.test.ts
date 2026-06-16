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

  it('should read selection inside same-origin iframe (TinyMCE-style editor)', async () => {
    // 顶层无选区，模拟富文本编辑器（TinyMCE）的 iframe 内有选区
    document.body.innerHTML = '<div>顶层无关正文，不应被抓取</div>';
    window.getSelection()?.removeAllRanges();

    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const iframeDoc = iframe.contentDocument!;
    iframeDoc.body.innerHTML = '<p id="sel">这是 iframe 内选中的内容</p><p>iframe 内未选中的其他内容</p>';
    const range = iframeDoc.createRange();
    range.selectNodeContents(iframeDoc.getElementById('sel')!);
    const iframeSel = iframe.contentWindow!.getSelection()!;
    iframeSel.removeAllRanges();
    iframeSel.addRange(range);

    const ctx = await capturePageContext();
    expect(ctx.text).toContain('这是 iframe 内选中的内容');
    expect(ctx.text).not.toContain('未选中');
    expect(ctx.text).not.toContain('顶层无关正文');
  });
});
