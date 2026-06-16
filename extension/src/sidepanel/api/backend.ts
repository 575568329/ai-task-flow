// extension/src/sidepanel/api/backend.ts
import type { ClipRequest, ClipResponse, ClipDraft, CreateTaskRequest } from '@ai-task-flow/shared';
import type { PageContext } from '../../types/pageContext.js';

const BASE_URL = 'http://localhost:3000';

/**
 * 经 background service worker 代理访问后端。
 * side panel 作为扩展「页面」上下文，直接 fetch localhost 会被 Chrome Local Network Access 拦截
 * （POST → Failed to fetch）；service worker 是特权后台上下文，host_permissions 授权后绕过该限制。
 * 统一用 text/plain（CORS 简单请求）从根上避开 PNA 预检拦截。
 * 见 background/index.ts 的 PROXY_FETCH 处理器与 docs/20260617020000_网页剪藏扩展联调踩坑记录.md。
 */
interface ProxyResult {
  ok: boolean;
  status: number;
  statusText: string;
  json: unknown;
  text: string;
  error?: string;
}

/** POST JSON 到后端路径，响应体（已 JSON 解析）由调用方按需断言 */
async function backendPost(path: string, body: unknown): Promise<unknown> {
  const result = (await chrome.runtime.sendMessage({
    type: 'PROXY_FETCH',
    request: {
      url: `${BASE_URL}${path}`,
      method: 'POST',
      // 用 text/plain 而非 application/json:后者触发 CORS 预检,会被 PNA 拦(到 localhost 私有网络
      // 的预检 → Failed to fetch)。text/plain 是 CORS 简单请求,不触发预检、不被 PNA 拦,和 GET 同层。
      // 后端已注册 text/plain→JSON 解析器。
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(body),
    },
  })) as ProxyResult | undefined;

  if (!result) {
    throw new Error('background service worker 未响应，请在 chrome://extensions 重新加载扩展');
  }
  if (result.error) {
    throw new Error(`后端请求未到达：${result.error}`);
  }
  if (!result.ok) {
    const bodyObj = result.json as { error?: unknown } | null;
    const message =
      bodyObj && typeof bodyObj === 'object' && 'error' in bodyObj
        ? String(bodyObj.error)
        : `请求失败（${result.status}）`;
    throw new Error(message);
  }
  return result.json;
}

/** PageContext → 后端拆解 → 任务草案（POST /api/tasks/clip） */
export async function captureToDrafts(ctx: PageContext): Promise<ClipResponse> {
  const body: ClipRequest = {
    sourceUrl: ctx.sourceUrl,
    title: ctx.title,
    content: { text: ctx.text },
    images: ctx.images,
  };
  const json = await backendPost('/api/tasks/clip', body);
  return json as ClipResponse;
}

/** 草案 → 建任务（source='web' + sourceUrl + prefix，POST /api/tasks） */
export async function createTaskFromDraft(
  draft: ClipDraft,
  sourceUrl: string,
  prefix: string,
): Promise<void> {
  const body: CreateTaskRequest = {
    prefix,
    title: draft.title,
    description: draft.description,
    source: 'web',
    sourceUrl,
    steps: draft.steps,
  };
  await backendPost('/api/tasks', body);
}
