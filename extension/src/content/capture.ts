// extension/src/content/capture.ts
import { Readability } from '@mozilla/readability';
import type { ClipImage } from '@ai-task-flow/shared';
import type { PageContext } from '../types/pageContext.js';
import { collectImages } from './images.js';

export interface CaptureOptions {
  wantImages?: boolean;
}

/**
 * 页面上下文采集（在页面上下文执行，不依赖 chrome API，便于 jsdom 测试）。
 * 划词优先：有选区取选区文本 + 选区内图片；否则 Readability 提取正文 + 全页图片。
 *
 * 注：用 Range.toString() 取选区文本而非 Selection.toString()——jsdom 对后者支持不可靠，
 * Range.toString() 是标准 DOM API，返回 range 内文本，行为一致。
 */
export async function capturePageContext(opts: CaptureOptions = {}): Promise<PageContext> {
  const selection = window.getSelection();
  const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
  const selectedText = range?.toString().trim() ?? '';
  const hasSelection = selectedText.length > 0;

  let text: string;
  let imageRoot: ParentNode;
  if (hasSelection) {
    // cloneContents() 返回选区内的 DocumentFragment（含圈住的 img）
    text = selectedText;
    imageRoot = range!.cloneContents();
  } else {
    // Readability 在页面克隆文档上解析，避免污染原 DOM
    const article = new Readability(document.cloneNode(true) as Document).parse();
    text = (article?.textContent ?? document.body?.textContent ?? '').trim();
    imageRoot = document.body ?? document.documentElement;
  }

  const images: ClipImage[] | undefined = opts.wantImages ? await collectImages(imageRoot) : undefined;

  // 末尾附图片清单，供 LLM 按 img-N 名称引用（设计 §5）
  const manifest = images && images.length > 0
    ? `\n\n（本页含图片：${images.map((i) => i.name).join('、')}）`
    : '';

  return {
    sourceUrl: location.href,
    title: document.title,
    text: manifest ? `${text}${manifest}` : text,
    images,
  };
}
