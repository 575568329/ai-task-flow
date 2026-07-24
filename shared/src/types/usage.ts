// shared/src/types/usage.ts
// Claude Code 终端会话 Token 用量统计类型(C 方向:扫 ~/.claude/projects/*.jsonl 聚合)。
//
// 数据流:ClaudeSessionScanner 解析 jsonl 行级 message.usage,按模型累加成 SessionUsage
//        → UsageService 按维度(项目/任务/模型/天/会话)聚合成 UsageSummary → 前端「用量」面板。
// 注意:Claude Code 直连 Anthropic,不走我们后端 LLM,故 token 唯一非侵入观测点是 jsonl 日志。

/** 原子用量块(可累加)。
 *  Anthropic 的 input_tokens / cache_creation_input_tokens / cache_read_input_tokens
 *  三者互斥(每条 assistant usage,三者加起来才是该条输入侧总量),故分别累加、不重复计。 */
export interface TokenUsage {
  inputTokens: number;           // 普通输入(非缓存)
  outputTokens: number;          // 输出
  cacheCreation5mTokens: number; // 5min 缓存写入(计费 1.25×)
  cacheCreation1hTokens: number; // 1h 缓存写入(计费 2×)
  cacheReadTokens: number;       // 缓存命中读取(计费 0.1×)
}

/** 单模型累加块(TokenUsage + 该模型的 assistant 消息数,供精确 requestCount) */
export interface ModelAccum extends TokenUsage {
  requests: number;
}

/** 单个 Claude 会话(jsonl)按模型累加的用量 */
export interface SessionUsage {
  byModel: Record<string, ModelAccum>; // 按 message.model 分组(一会话可能切模型,记请求数)
  byDay: Record<string, Record<string, ModelAccum>>; // 按本地日期 → 按模型累加(支持跨天会话精确按天 cost)
  total: TokenUsage;                   // 会话总计(各模型之和)
  assistantCount: number;              // assistant 消息条数(≈ 请求数)
  /** 关联任务(get_task 返回 markdown 埋的标记扫出);一会话多任务时取出现最多的主任务 */
  taskId?: string;
}

/** 单模型聚合行 */
export interface UsageModelRow extends TokenUsage {
  model: string;
  cost: number;        // USD(单价表未命中为 0)
  requestCount: number;
}

/** 单任务聚合行 */
export interface UsageTaskRow extends TokenUsage {
  taskId: string;
  cost: number;
  requestCount: number;
  sessionCount: number;
}

/** 单项目聚合行(project = repoPath,与看板任务 projectName 天然对应) */
export interface UsageProjectRow extends TokenUsage {
  project: string;
  cost: number;
  requestCount: number;
  sessionCount: number;
}

/** 单日聚合行(本地日期 YYYY-MM-DD) */
export interface UsageDayRow extends TokenUsage {
  date: string;
  cost: number;
  requestCount: number;
}

/** 单会话聚合行(面板「会话」维度,每行可挂 WSL/Win 小标签) */
export interface UsageSessionRow extends TokenUsage {
  sessionId: string;
  title: string;
  taskId?: string;
  source?: 'windows' | 'wsl';
  lastActiveAt: string; // ISO
  cost: number;
  requestCount: number;
}

/** 用量聚合查询参数 */
export interface UsageSummaryQuery {
  project?: string;  // 按 repoPath 过滤
  taskId?: string;   // 按任务过滤
  from?: string;     // 本地日期 YYYY-MM-DD(含)
  to?: string;       // 本地日期(含)
}

/** 用量聚合结果(供前端面板,五维度) */
export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number; // 5m + 1h 合计
  totalCacheReadTokens: number;
  totalCost: number;
  totalRequests: number;
  byModel: UsageModelRow[];
  byTask: UsageTaskRow[];
  byProject: UsageProjectRow[];
  byDay: UsageDayRow[];
  bySession: UsageSessionRow[];
}
