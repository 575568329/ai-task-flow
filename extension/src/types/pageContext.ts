import type { ClipImage } from '@ai-task-flow/shared';

/**
 * 抓取到的页面上下文（扩展内部类型，剪藏/对话视图共用）。
 * 不入 shared 契约——它是扩展的采集产物，宿主后端只消费其中的 ClipRequest 子集。
 */
export interface PageContext {
  sourceUrl: string;    // location.href
  title: string;        // document.title
  text: string;         // 选区文本 或 Readability 正文（末尾附图片清单）
  images?: ClipImage[]; // wantImages 时为 img-1..N 的 base64
}
