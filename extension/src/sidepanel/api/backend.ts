// extension/src/sidepanel/api/backend.ts
import type { ClipRequest, ClipResponse, ClipDraft, CreateTaskRequest } from '@ai-task-flow/shared';
import type { PageContext } from '../../types/pageContext.js';

const BASE_URL = 'http://localhost:3000';

/** 解析后端错误信息（兼容 {error} 与纯状态码） */
async function parseError(resp: Response): Promise<string> {
  const err = (await resp.json().catch(() => ({ error: resp.statusText }))) as { error?: string };
  return err.error ?? `请求失败(${resp.status})`;
}

/** PageContext → 后端拆解 → 任务草案（POST /api/tasks/clip，Plan 1 已就绪） */
export async function captureToDrafts(ctx: PageContext): Promise<ClipResponse> {
  const body: ClipRequest = {
    sourceUrl: ctx.sourceUrl,
    title: ctx.title,
    content: { text: ctx.text },
    images: ctx.images,
  };
  const resp = await fetch(`${BASE_URL}/api/tasks/clip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(await parseError(resp));
  return (await resp.json()) as ClipResponse;
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
  const resp = await fetch(`${BASE_URL}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(await parseError(resp));
}
