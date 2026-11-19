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
