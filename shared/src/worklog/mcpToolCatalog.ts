// shared/src/worklog/mcpToolCatalog.ts
// worklog MCP 工具元数据——单一来源:MCP server 注册工具名/描述、前端「AI 使用指南」
// 视图渲染均从此取,杜绝说明与实现漂移。
// 注意:inputSchema 不在此定义(手写于 backend 各工具文件,含类型细节)。

export interface WorklogToolMeta {
  /** 工具名(MCP 注册名,snake_case) */
  name: string;
  /** 工具描述(MCP ListTools 返回给 AI 的 description,同源) */
  description: string;
  /** 什么时候用(指南页:场景说明) */
  whenToUse: string;
  /** 用户示例话术(指南页:教用户怎么对 AI 说) */
  userPromptExample: string;
}

// ---------------------------------------------------------------------------
// detail(详细说明)写作规范——AI 工具描述与指南页共用此单一来源。
// 要求:结构化分条(1.2.3.)、内容完善可追溯(文件/版本号/数字属实)、写完自查防瞎写。
// ---------------------------------------------------------------------------

/** Bug 修复类记录模板 */
export const WORKLOG_DETAIL_TEMPLATE_BUG =
  '### 问题\n' +
  '<什么场景下出了什么现象:报错信息/错误行为/影响范围>\n' +
  '\n' +
  '### 原因\n' +
  '<根因,一两句说清楚>\n' +
  '\n' +
  '### 解决\n' +
  '1. <改动点:文件/模块 + 做了什么>\n' +
  '2. <…每条一个独立改动>\n' +
  '\n' +
  '### 验证\n' +
  '<怎么验证的 + 结果(测试/复现步骤通过)>';

/** 任务/功能类记录模板 */
export const WORKLOG_DETAIL_TEMPLATE_TASK =
  '### 需求\n' +
  '<任务要求是什么,验收标准>\n' +
  '\n' +
  '### 方案\n' +
  '<怎么设计的:结构/选型/关键决策及原因>\n' +
  '\n' +
  '### 实现\n' +
  '1. <步骤/模块:文件 + 做了什么>\n' +
  '2. <…每条一个独立改动>\n' +
  '\n' +
  '### 验证\n' +
  '<怎么验证的 + 结果(测试全绿/页面可查)>';

/** 写作与自查规则(AI 调用 record_work 前的硬性要求) */
export const WORKLOG_DETAIL_RULES = [
  '分条编号(1.2.3.),禁止大段流水账——人要一眼看懂',
  'Bug 修复按「问题 → 原因 → 解决 → 验证」;任务按「需求 → 方案 → 实现 → 验证」',
  '内容完善可追溯:文件路径/版本号/数字必须属实,不确定就去查,禁止臆造',
  '提交前自查一遍:有没有写错、前后矛盾或漏了关键改动,再落库',
];

export const WORKLOG_TOOL_CATALOG: WorklogToolMeta[] = [
  {
    name: 'record_work',
    description:
      '记录一条工作内容(版本 → 需求 → 功能点条目)。版本与需求必须由用户在页面创建,AI 只传 id;不要尝试创建或猜名称——id 不存在时会报错并列出可选值。' +
      '记录前先调 list_versions / list_requirements 拿到 versionId 与 requirementId。' +
      'files 从 git status/diff 取改动文件路径与行号,diff 附 git diff 原文;' +
      'project 传本次实际改动的项目名(可选,不传按路径归属);relatedProjects 传同时涉及的其他项目名;记录时自动带上当前工作目录用于路径归属。' +
      'detail 必须结构化分条,禁止大段流水账:Bug 修复按「### 问题(现象+报错)→### 原因→### 解决(1.2.3.分点)→### 验证」;' +
      '任务功能按「### 需求→### 方案→### 实现(1.2.3.分点)→### 验证」。' +
      '内容要完善可追溯:文件路径/版本号/数字必须属实,禁止臆造。' +
      '提交前自查一遍:有无写错/矛盾/遗漏,确认无误再调用。' +
      'stage 必填且唯一:req 获取需求 / design 设计文档与实施计划 / dev 开发 / self-test 自测 / ' +
      'review 代码评审 / coverage 覆盖度测试 / release 上线 / retro 复盘；缺陷修改用 tags 的 fix 表示,不占 stage。' +
      '本工具只记录代码变更(diff/文件/行号);讨论结论、决策理由、关键数据请用 record_conclusion。',
    whenToUse: 'AI 完成一波代码修改、准备汇报时——先记录再汇报,别让成果只留在对话里。',
    userPromptExample: '「把这次改动记录到 V8.0.8 的澳门底层数据建设需求下,带上 diff 和改动文件,Bug 按问题/原因/解决/验证 格式写清楚」',
  },
  {
    name: 'query_work',
    description:
      '回溯查询工作记录。entryId 按条目 id 精确查询(页面上复制的 e_xxx),传入时忽略其他过滤条件;' +
      '其余支持 versionId / requirementId 精确过滤(先 list_versions / list_requirements 获取)、项目(project)精确过滤、' +
      '关联项目(relatedProject)过滤、关键词模糊(标题/详情/文件路径,不区分大小写)、标签、阶段(stage)、日期范围(dateFrom/dateTo)。' +
      '结果每条都带 ID:xxx 与所属版本名/需求名,可用于后续 update_work/delete_work。' +
      'diff 默认不返回,includeDiff:true 时携带。',
    whenToUse: '用户问"上次怎么改的/上周做了什么/某个 bug 怎么修的",或直接给出记录 id 时,先查记录再回答。',
    userPromptExample: '「查一下 V8.0.8 澳门底层数据建设需求下上周的改动记录」',
  },
  {
    name: 'list_projects',
    description:
      '列出项目字典(项目 id、名称、路径尾段、关联条目数)。新模型下项目只是条目属性与路径归属字典,不再承载版本树;' +
      '版本/需求请用 list_versions / list_requirements 获取 id。本工具只读,路径绑定请让用户在页面操作。',
    whenToUse: '记录前不确定项目名,或想确认项目 id 与路径绑定情况时,先调它看一眼再 record_work。',
    userPromptExample: '「看下工作记录里已经有哪些项目、id 是什么、有没有绑定路径」',
  },
  {
    name: 'list_programs',
    description:
      '列出建设主题(id、名称、版本数、条目数)。只读,用于让 AI 获取 programId;' +
      '主题只能由用户在页面创建,AI 不得创建或猜名称。',
    whenToUse: '想确认当前有哪些建设主题、各自规模,或需要 programId 过滤版本时。',
    userPromptExample: '「看下现在有哪些建设主题,各自多少版本、多少条目」',
  },
  {
    name: 'list_versions',
    description:
      '列出所有版本(id、名称、所属主题、需求数、条目数、首末日期)。只读,用于让 AI 获取 versionId;' +
      '可按 programId 过滤(先 list_programs 获取),输出主题名。版本只能由用户在页面创建,AI 不得创建或猜名称。',
    whenToUse: '记录前拿 versionId,或用户问"现在有哪些版本/版本 id 是什么"时。',
    userPromptExample: '「看下现在有哪些版本,各自的 id 是什么」',
  },
  {
    name: 'list_requirements',
    description:
      '列出需求(id、标题、所属版本、关联项目、条目数)。只读,用于让 AI 获取 requirementId;' +
      '传 versionId 只看该版本,不传则列全部。需求只能由用户在页面创建,AI 不得创建或猜名称。',
    whenToUse: '拿到 versionId 后找需求 id,或用户问"某版本下有哪些需求"时。',
    userPromptExample: '「V8.0.8 下面有哪些需求,把 id 给我」',
  },
  {
    name: 'update_work',
    description:
      '部分更新一条记录(只改传入的字段:title/detail/tags/stage/files/diff/date/relatedProjects)。' +
      'relatedProjects 传空数组表示清空关联;不支持挪版本(条目所属版本/需求由用户决定)。' +
      '补写 detail 时遵循与 record_work 相同的结构化模板与自查规则。',
    whenToUse: '记录写错了要改、要补充内容或调整关联项目时。',
    userPromptExample: '「把刚才那条记录的标题改准确一点,diff 也补上」',
  },
  {
    name: 'delete_work',
    description: '删除单条工作记录(执行前自动快照备份,可从备份恢复)。',
    whenToUse: '某条记录重复了或记错了要作废时。',
    userPromptExample: '「把刚才记重的那条删掉」',
  },
  {
    name: 'delete_version',
    description:
      '按 versionId 删除整个版本及其全部需求与条目,可删非空版本(执行前自动快照备份)。versionId 用 list_versions 获取。',
    whenToUse: '某个迭代/版本整体作废时。',
    userPromptExample: '「v0.9 那个废弃版本整个删掉」',
  },
  {
    name: 'delete_project',
    description: '从项目字典移除该项目,不删除历史条目(项目名快照保留;执行前自动快照备份)。',
    whenToUse: '项目不再跟进、要从项目字典清理时。',
    userPromptExample: '「demo-project 不做了,从项目字典里删掉」',
  },
  {
    name: 'rename_version',
    description:
      '按 versionId 重命名版本(执行前自动快照备份)。新名与既有版本重名会报错且不改动。versionId 用 list_versions 获取。',
    whenToUse: '版本名写错(如 v1.2 写成 1.2)要纠正时。',
    userPromptExample: '「把 1.2 那个版本名改成 v1.2.0」',
  },
  {
    name: 'rename_project',
    description: '重命名项目(执行前自动快照备份)。新名与既有项目重名会报错且不改动。',
    whenToUse: '项目改名时。',
    userPromptExample: '「项目名从 old-app 改成 new-app」',
  },
];
