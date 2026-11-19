/** 结论卡正文的阅读排版：填满左栏、行高、列表缩进、标题间距。 */
export const CONCLUSION_MARKDOWN_CLASS =
  'w-full text-[15px] leading-7 ' +
  '[&_p]:my-2 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 ' +
  '[&_li]:my-1 [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:border-b [&_h2]:pb-1 ' +
  '[&_h3]:mt-3 [&_h3]:mb-1';

/**
 * 卡片/时间线已经渲染了「结论/决策」「关键数据」「待办」节标题，
 * AI 正文若自带同名标题会造成重复，这里防御性去掉开头的一条。
 */
export function stripSectionHeading(content: string): string {
  return content.replace(
    /^\s*#{1,4}\s*(?:结论\/决策|结论|决策|关键数据|数据|待办\/未决|待办)\s*\n+/i,
    '',
  );
}

/**
 * 旧卡/旧提示词留下的内联排版：①②③ 串段、`; 2.` 串行、`★` 夹在段落中。
 * 只在展示层归一化，不改落库内容；新内容应直接写成标准 Markdown 列表。
 */
export function normalizeLegacyMarkdown(content: string): string {
  let text = stripSectionHeading(content);
  // 星标小标题：先断行，再转成三级标题。
  text = text.replace(/([^\n])\s*★/g, '$1\n\n★');
  text = text.replace(/^★\s*/gm, '### ');
  // 内联圆圈编号 → 独立行 + 列表项。
  text = text.replace(/([^\n])\s*([①-⑳])/g, '$1\n\n$2');
  text = text.replace(/^([①-⑳])\s*/gm, '- $1 ');
  // `; 2.` / `；2.` 这类内联编号 → 新行，让 Markdown 识别为有序列表。
  text = text.replace(/[;；]\s*(?=\d+\.)/g, '\n');
  // `2.**加粗**` / `3.真要` 数字后缺空格，Markdown 不识别；补一个空格。
  text = text.replace(/^(\d+)\.(?=\S)/gm, '$1. ');
  return text;
}

/** 折叠态预览：通用实现，worklog/结论卡共用。 */
export { plainTextExcerpt } from '@/lib/markdownText';
