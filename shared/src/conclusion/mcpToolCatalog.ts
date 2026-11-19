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
      '默认新建：用户说“记一下/同步到结论卡/存一张”但没有明确指向某张已有卡时，不要传 cardId，' +
      '也不要先用 keyword 搜索相似卡；直接新建。' +
      '只有用户明确说“更新/继续/追加刚才那张卡”或直接给出 cardId 时才追加：直接按 cardId 调 ' +
      'query_conclusions 读取最新版，再带 cardId 追加，禁止用关键字搜索定位要更新的卡。' +
      '追加时省略的字段沿用上一版，显式传 "" 或 [] 表示清空；必须提供 changeNote，建议带 expectedRev。' +
      '建议填写 conversationName（本次对话主题），便于人区分来源；对话 ID 会自动采集。' +
      '默认一对话一卡：来源对话与卡片归属不同会被拒绝；只有用户明确要求跨对话续写时才传 allowCrossConversation=true。' +
      '禁止记录密钥、令牌、个人敏感信息。' +
      '本工具不记录 diff；代码变更/文件/行号请用 record_work。',
    whenToUse:
      '用户说“把刚才的结论记一下/同步到结论卡/存一张结论卡”，或明确说“更新/继续刚才那张结论卡”。',
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
