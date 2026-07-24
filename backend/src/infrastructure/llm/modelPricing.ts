// backend/src/infrastructure/llm/modelPricing.ts
// 模型单价表(per 1M tokens,USD)。input/output 分价,缓存按 Anthropic 倍率折算。
// 仅覆盖常用模型;未命中返回 undefined(用量照常统计,只是不估算成本)。
//
// Anthropic 缓存计费(cache token 相对普通 input token 的倍率):
//   - 5min 缓存写入 1.25×   - 1h 缓存写入 2×   - 缓存命中读取 0.1×
// 来源:https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
// GLM Coding Plan 等订阅制套餐本身不计费,此处给占位单价仅为成本视图可用,实际以账单为准。
import type { TokenUsage } from '@ai-task-flow/shared';

interface ModelPrice {
  /** per 1M input tokens(USD) */
  input: number;
  /** per 1M output tokens(USD) */
  output: number;
  /** 缓存读 token 计价占 input 的比例(Anthropic 0.1);非缓存模型留空(0) */
  cacheReadRatio?: number;
  /** 5min 缓存写入计价倍率(Anthropic 1.25) */
  cacheCreation5mRatio?: number;
  /** 1h 缓存写入计价倍率(Anthropic 2) */
  cacheCreation1hRatio?: number;
}

/** Anthropic 系列的缓存计费倍率(固定值,见文档链接) */
const ANTHROPIC_CACHE_RATES = { read: 0.1, write5m: 1.25, write1h: 2 };

/** Claude 系列单价构造器:input/output + 三个缓存倍率一键补全 */
const CLAUDE = (input: number, output: number): ModelPrice => ({
  input,
  output,
  cacheReadRatio: ANTHROPIC_CACHE_RATES.read,
  cacheCreation5mRatio: ANTHROPIC_CACHE_RATES.write5m,
  cacheCreation1hRatio: ANTHROPIC_CACHE_RATES.write1h,
});

/** key 用小写模型名。查表先精确命中,再前缀匹配(兼容带日期后缀的版本号) */
const PRICING: Record<string, ModelPrice> = {
  // Anthropic
  'claude-opus-4-8': CLAUDE(5, 25),
  'claude-opus-4-7': CLAUDE(5, 25),
  'claude-opus-4-6': CLAUDE(5, 25),
  'claude-sonnet-4-6': CLAUDE(3, 15),
  'claude-sonnet-4-5': CLAUDE(3, 15),
  'claude-haiku-4-5': CLAUDE(1, 5),
  // 智谱 GLM(走 anthropic 协议;订阅制,单价为占位)
  'glm-5.2': { input: 0.5, output: 0.5 },
  // OpenAI 兼容
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'deepseek-chat': { input: 0.27, output: 1.1 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
};

function lookupPrice(model: string): ModelPrice | undefined {
  const key = model.toLowerCase();
  if (PRICING[key]) return PRICING[key];
  // 兜底:前缀匹配(如 claude-sonnet-4-6-20260101、gpt-4o-2024-xx)
  for (const k of Object.keys(PRICING)) {
    if (key.startsWith(k)) return PRICING[k];
  }
  return undefined;
}

/**
 * 估算用量成本(USD):input + output + 三种缓存项各自按倍率折算。
 * 单价表未命中返回 undefined(调用方按 0 记账,不影响用量统计)。
 */
export function estimateCost(model: string, usage: TokenUsage): number | undefined {
  const price = lookupPrice(model);
  if (!price) return undefined;
  const r5m = price.cacheCreation5mRatio ?? 0;
  const r1h = price.cacheCreation1hRatio ?? 0;
  const rRead = price.cacheReadRatio ?? 0;

  const input = (usage.inputTokens / 1e6) * price.input;
  const output = (usage.outputTokens / 1e6) * price.output;
  // 缓存项都按 input 单价 × 对应倍率(写入/读取本身是 input 侧 token)
  const cache5m = (usage.cacheCreation5mTokens / 1e6) * price.input * r5m;
  const cache1h = (usage.cacheCreation1hTokens / 1e6) * price.input * r1h;
  const cacheRead = (usage.cacheReadTokens / 1e6) * price.input * rRead;

  const total = input + output + cache5m + cache1h + cacheRead;
  return Math.round(total * 1e6) / 1e6; // 保留 6 位小数(USD)
}
