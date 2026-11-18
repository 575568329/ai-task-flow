export interface ConclusionToolMeta {
  name: string;
  description: string;
  whenToUse: string;
  userPromptExample: string;
}

export const CONCLUSION_TOOL_CATALOG: ConclusionToolMeta[] = [
  {
    name: 'record_conclusion',
    description:
      '记录或更新一张结论卡（主题 → 结论/数据/待办/代码位置）。' +
      '仅在用户明确要求记录结论时调用，禁止主动捕获。' +
      '追加时先调 query_conclusions({cardId}) 读取最新版；省略的字段沿用上一版，' +
      '显式传 "" 或 [] 表示清空。追加必须提供 changeNote，建议带 expectedRev。' +
      '禁止记录密钥、令牌、个人敏感信息。',
    whenToUse:
      '用户说“把刚才的结论记一下/存一张结论卡/更新某张结论卡”，' +
      '或一次讨论明确了决策、关键数据、待办时（由用户触发）。',
    userPromptExample:
      '把刚才的结论记到 ai-task-flow，项目 ai-task-flow：结论、关键数据、待办、涉及文件。',
  },
  {
    name: 'query_conclusions',
    description:
      '查询结论卡。不传 cardId 时按条件搜索，返回摘要用于定位；' +
      '传 cardId 时返回该卡最新版完整四节与演进摘要，供更新前读取当前进度。' +
      'includeHistory=true 时额外返回全部历史版本全文。',
    whenToUse:
      '用户说“更新刚才那个结论”但上下文没有 cardId，或需要回看某张卡当前结论时。',
    userPromptExample: '把 worklog 全局搜索那张结论卡找出来，看看现在定的是什么。',
  },
];
