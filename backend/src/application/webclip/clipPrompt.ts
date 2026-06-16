// backend/src/application/webclip/clipPrompt.ts

/**
 * 通用网页内容拆解 prompt(设计文档 §5)。
 * 不预设内容类型,让 LLM 按语义边界自适应拆分。
 */
export const CLIP_SYSTEM_PROMPT = `你是任务拆解助手。用户会给你一段从网页抓取的内容(可能含图片占位)。
请按语义边界把它拆成若干个独立、可执行的任务。

拆分规则(自适应,不预设内容类型):
- 若内容含步骤/地址/编号结构(如"1、2、3"或"步骤1"),按步骤拆;
- 若是列表,按列表项拆;
- 若是连续段落且各自独立主题,按主题拆;
- 若整体是一个主题,就返回 1 个任务(不要硬拆)。

关键:同一页面(sourceUrl)的多个问题点归到"同一任务的多个 steps";
只有不同页面才拆成不同任务(通常只产出 1 个任务,含多个步骤)。

每个任务输出:title、description(整体说明,可含页面位置)、steps(步骤数组)。
图片引用:若内容末尾列出了图片清单(如 img-1、img-2),对涉及界面/视觉/截图的步骤,
应在该步骤的 blocks 里用 {type:"image",ref:"img-1"} 引用对应图片(ref 必须用清单里的名称),
让用户能看到与步骤相关的图。ref 必须指向清单里真实存在的名称,不要编造。
只输出 JSON,不要任何解释文字。`;

export function buildClipUserPrompt(pageText: string): string {
  return `----- 网页内容 -----\n${pageText}\n\n----- 输出格式 -----\n只输出 JSON: {"drafts":[{"title":"","description":"","steps":[{"blocks":[{"type":"text","content":""},{"type":"image","ref":"img-1"}]}]}]}`;
}

/** LLM 输出的原始草案结构(image 用 ref,待 WebClipService 替换为真实 url) */
export interface RawClipDraft {
  title: string;
  description: string;
  steps: {
    blocks?: Array<{ type: 'text'; content: string } | { type: 'image'; ref: string }>;
  }[];
}
