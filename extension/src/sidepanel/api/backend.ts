// extension/src/sidepanel/api/backend.ts
import type {
  ClipRequest,
  ClipResponse,
  ClipDraft,
  CreateTaskRequest,
  TranslateResponse,
  VocabDTO,
  VocabCreateDTO,
  VocabUpdateDTO,
  VocabListQuery,
  VocabListResponse,
} from '@ai-task-flow/shared';
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

/**
 * 统一代理请求：POST/PATCH/DELETE 带 body（走 text/plain），GET 无 body。
 * 响应体（已 JSON 解析）由调用方按需断言。
 */
async function backendRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  const hasBody = body !== undefined;
  const result = (await chrome.runtime.sendMessage({
    type: 'PROXY_FETCH',
    request: {
      url: `${BASE_URL}${path}`,
      method,
      // 用 text/plain 而非 application/json:后者触发 CORS 预检,会被 PNA 拦(到 localhost 私有网络
      // 的预检 → Failed to fetch)。text/plain 是 CORS 简单请求,不触发预检、不被 PNA 拦,和 GET 同层。
      // 后端已注册 text/plain→JSON 解析器。
      headers: hasBody ? { 'Content-Type': 'text/plain' } : undefined,
      body: hasBody ? JSON.stringify(body) : undefined,
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
  return (await backendRequest('POST', '/api/tasks/clip', body)) as ClipResponse;
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
  await backendRequest('POST', '/api/tasks', body);
}

// ============ 翻译生词本 ============

/** 划词翻译（POST /api/vocab/translate） */
export async function translateText(text: string, targetLang?: string): Promise<TranslateResponse> {
  return (await backendRequest('POST', '/api/vocab/translate', { text, targetLang })) as TranslateResponse;
}

/** 存生词（POST /api/vocab，重复返回 409 抛错） */
export async function saveVocab(dto: VocabCreateDTO): Promise<VocabDTO> {
  return (await backendRequest('POST', '/api/vocab', dto)) as VocabDTO;
}

/** 更新收藏/掌握（PATCH /api/vocab/:id） */
export async function updateVocab(id: string, dto: VocabUpdateDTO): Promise<VocabDTO> {
  return (await backendRequest('PATCH', `/api/vocab/${id}`, dto)) as VocabDTO;
}

/** 删除生词（DELETE /api/vocab/:id） */
export async function deleteVocab(id: string): Promise<void> {
  await backendRequest('DELETE', `/api/vocab/${id}`);
}

/** 列表（GET /api/vocab?kw&sourceLang&mastered&starred&page&pageSize） */
export async function listVocab(query: Partial<VocabListQuery> = {}): Promise<VocabListResponse> {
  const params = new URLSearchParams();
  if (query.kw) params.set('kw', query.kw);
  if (query.sourceLang) params.set('sourceLang', query.sourceLang);
  if (typeof query.mastered === 'boolean') params.set('mastered', String(query.mastered));
  if (typeof query.starred === 'boolean') params.set('starred', String(query.starred));
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  const qs = params.toString();
  return (await backendRequest('GET', `/api/vocab${qs ? `?${qs}` : ''}`)) as VocabListResponse;
}
