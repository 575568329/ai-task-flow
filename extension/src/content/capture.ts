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

/** 单个 window 上的文字选区，返回有非空文本的 Range，否则 null */
function readSelectionRange(win: Window): Range | null {
  const sel = win.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  return range.toString().trim() ? range : null;
}

/** 递归深度上限：防止异常/恶意页面无限嵌套 iframe 导致栈溢出 */
const MAX_FRAME_DEPTH = 5;

/**
 * 在 win 及其同源子 iframe 内查找用户选区（深度优先）。
 * selection 跨 frame 隔离——顶层文档看不到 iframe 内选区（如 TinyMCE 编辑区是 iframe），
 * 故需递归遍历同源 iframe；跨域 iframe 访问 contentWindow/document 会抛 SecurityError，跳过。
 * （参考 Skirtle「Selected Text In An Iframe」：同源 iframe 可经 contentWindow 取选区。）
 */
function findSelectionRange(win: Window, depth = 0): Range | null {
  if (depth > MAX_FRAME_DEPTH) return null;
  const own = readSelectionRange(win);
  if (own) return own;
  let iframes: HTMLIFrameElement[];
  try {
    iframes = Array.from(win.document.querySelectorAll('iframe'));
  } catch {
    return null; // 跨域 win 访问 document 抛错
  }
  for (const iframe of iframes) {
    let child: Window | null;
    try {
      child = iframe.contentWindow;
    } catch {
      continue; // 跨域 iframe 访问 contentWindow 抛错
    }
    if (!child) continue;
    try {
      const found = findSelectionRange(child, depth + 1);
      if (found) return found;
    } catch {
      continue; // 递归进入跨域 iframe 时抛错
    }
  }
  return null;
}

export async function capturePageContext(opts: CaptureOptions = {}): Promise<PageContext> {
  const range = findSelectionRange(window);

  let text: string;
  let imageRoot: ParentNode;
  if (range) {
    // cloneContents() 返回选区内的 DocumentFragment（含圈住的 img）
    text = range.toString().trim();
    imageRoot = range.cloneContents();
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
