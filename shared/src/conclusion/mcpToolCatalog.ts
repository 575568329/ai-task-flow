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
      '记录一张结论卡（主题 → 结论/数据/待办/代码位置）。仅在用户明确要求记录结论时调用，禁止主动捕获。' +
      '不传 cardId 时按当前会话自动 upsert：本会话已有卡则续写新版，没有则新建。' +
      '无需先调用 query_conclusions，也禁止用 keyword 搜索来定位/复用旧卡。' +
      '同一会话后续记录必须提供 changeNote；新建时可省略。' +
      '只有用户明确要求更新另一张指定卡时才传 cardId；显式跨对话更新需 allowCrossConversation=true。' +
      '追加时省略的字段沿用上一版，显式传 "" 或 [] 表示清空。' +
      '建议填写 conversationName（本次对话主题），便于人区分来源；对话 ID 会自动采集。' +
      '禁止记录密钥、令牌、个人敏感信息。' +
      '本工具不记录 diff；代码变更/文件/行号请用 record_work。',
    whenToUse:
      '用户说“把刚才的结论记一下/同步到结论卡/存一张结论卡”，或同一会话继续补充结论时。',
    userPromptExample:
      '把刚才的结论记到 ai-task-flow，项目 ai-task-flow：结论、关键数据、待办、涉及文件。',
  },
  {
    name: 'query_conclusions',
    description:
      '查询结论卡，只有两种用途：' +
      '① 已知 cardId：直接传 cardId，返回该卡最新版完整四节与演进摘要（追加前读取当前进度）；' +
      '② 不知道 cardId 且用户明确要求查找/回看时，才用 keyword 等项目/日期条件做全库搜索，返回摘要用于定位。' +
      '禁止在已知 cardId 时再用 keyword 搜索；keyword 不是写前自动匹配/复用旧卡的手段。' +
      'includeHistory=true 时额外返回全部历史版本全文。',
    whenToUse:
      '已知 cardId 需要读取当前结论；或用户明确要求查找/回看某张卡且上下文没有 cardId。',
    userPromptExample: '把 worklog 全局搜索那张结论卡找出来，看看现在定的是什么。',
  },
];
