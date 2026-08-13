// backend/src/utils/http.ts
// 外部 HTTP 调用的超时 + 重试工具。防 LLM/搜索/同步等上游服务挂起拖垮本服务(P1-11)。
// 原 8 处裸 fetch(OpenAiCompatible/Anthropic/Glm/Arxiv/Maimemo)无超时,上游卡住 → 本请求
// 无限挂起 → Fastify 连接耗尽。统一加 AbortSignal.timeout;幂等 GET 加重试。

/** 默认请求超时(ms)。LLM 非流式/搜索 30s 够;流式调用方自行传 signal 控制。 */
const DEFAULT_TIMEOUT_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 带 AbortSignal 超时的 fetch。若 init 已传 signal 则尊重(调用方手动控制,如流式 abort)。
 * 超时抛 AbortError(fetch 原生行为),由调用方 catch 降级。
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(timeoutMs),
  });
}

/**
 * 带超时 + 重试的 GET(仅幂等请求)。失败(超时/网络错误/5xx)按指数退避重试。
 * POST 等非幂等请求**不要**用此函数(重试会重复副作用),用 fetchWithTimeout。
 */
export async function fetchGetRetry(
  url: string,
  init: RequestInit = {},
  options: { timeoutMs?: number; retries?: number } = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 2 } = options;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, { ...init, method: 'GET' }, timeoutMs);
      // 5xx 服务端错误可重试;4xx 客户端错误不重试(直接返回交调用方处理)
      if (res.status >= 500 && attempt < retries) {
        await sleep(2 ** attempt * 500); // 500ms, 1s, 2s...
        continue;
      }
      return res;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(2 ** attempt * 500);
        continue;
      }
    }
  }
  throw lastError;
}
