// extension/src/sidepanel/api/__tests__/backend.test.ts
// backend.ts 经 chrome.runtime.sendMessage({type:'PROXY_FETCH',request}) 走 background 代理,
// 故 mock sendMessage 返回 ProxyResult(而非 global.fetch —— 那是早期直连 fetch 的旧 mock,已过时)。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  captureToDrafts,
  createTaskFromDraft,
  translateText,
  saveVocab,
  listVocab,
} from '../backend.js';

/** ProxyResult 形状（与 backend.ts 一致） */
interface ProxyResult {
  ok: boolean;
  status: number;
  statusText: string;
  json: unknown;
  text: string;
  error?: string;
}

/** sendMessage 入参形状 */
interface SendMessageCall {
  type: string;
  request: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: string;
  };
}

beforeEach(() => {
  global.chrome = {
    runtime: { sendMessage: vi.fn() },
  } as unknown as typeof chrome;
});

/** 让下一次 sendMessage resolve 为给定 ProxyResult */
function mockProxy(result: Partial<ProxyResult>): void {
  (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce(result as ProxyResult);
}

/** 取第 n 次（默认最近一次）sendMessage 调用的入参 */
function lastCall(n = 0): SendMessageCall {
  const calls = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1 - n][0] as SendMessageCall;
}

describe('backend api', () => {
  it('captureToDrafts posts ClipRequest via PROXY_FETCH and returns drafts', async () => {
    mockProxy({
      ok: true,
      status: 200,
      statusText: '',
      json: { drafts: [{ title: 'T', description: 'D', steps: [] }], sourceUrl: 'u' },
      text: '',
    });
    const resp = await captureToDrafts({
      sourceUrl: 'u',
      title: 't',
      text: '正文',
      images: [{ name: 'img-1', base64: 'data:x' }],
    });
    expect(resp.drafts).toHaveLength(1);
    const call = lastCall();
    expect(call.type).toBe('PROXY_FETCH');
    expect(call.request.url).toBe('http://localhost:3000/api/tasks/clip');
    expect(call.request.method).toBe('POST');
    expect(call.request.headers?.['Content-Type']).toBe('text/plain');
    const body = JSON.parse(call.request.body as string);
    expect(body.sourceUrl).toBe('u');
    expect(body.content.text).toBe('正文');
    expect(body.images[0].name).toBe('img-1');
  });

  it('createTaskFromDraft posts web task with sourceUrl and prefix', async () => {
    mockProxy({ ok: true, status: 200, statusText: '', json: { id: 'WEB-1' }, text: '' });
    await createTaskFromDraft({ title: 'T', description: 'D', steps: [] }, 'https://x.com/p', 'WEB');
    const call = lastCall();
    expect(call.request.url).toBe('http://localhost:3000/api/tasks');
    const body = JSON.parse(call.request.body as string);
    expect(body.source).toBe('web');
    expect(body.sourceUrl).toBe('https://x.com/p');
    expect(body.prefix).toBe('WEB');
  });

  it('throws on non-ok response with backend error', async () => {
    mockProxy({
      ok: false,
      status: 400,
      statusText: '',
      json: { error: '尚未配置 API Key' },
      text: '',
    });
    await expect(
      createTaskFromDraft({ title: 'T', description: 'D', steps: [] }, 'u', 'WEB'),
    ).rejects.toThrow(/API Key/);
  });

  it('throws when service worker not responding', async () => {
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    await expect(
      createTaskFromDraft({ title: 'T', description: 'D', steps: [] }, 'u', 'WEB'),
    ).rejects.toThrow(/未响应/);
  });
});

describe('vocab api', () => {
  it('translateText posts text and returns TranslateResponse', async () => {
    mockProxy({
      ok: true,
      status: 200,
      statusText: '',
      json: { translation: '你好', sourceLang: 'en', targetLang: 'zh' },
      text: '',
    });
    const resp = await translateText('hello');
    expect(resp.translation).toBe('你好');
    const call = lastCall();
    expect(call.request.url).toBe('http://localhost:3000/api/vocab/translate');
    expect(call.request.method).toBe('POST');
    expect(JSON.parse(call.request.body as string).text).toBe('hello');
  });

  it('saveVocab posts VocabCreateDTO and returns VocabDTO', async () => {
    mockProxy({
      ok: true,
      status: 200,
      statusText: '',
      json: {
        id: 'v1', word: 'hi', translation: '你好', targetLang: 'zh',
        starred: false, mastered: false, reviewCount: 0, createdAt: 't', updatedAt: 't',
      },
      text: '',
    });
    const v = await saveVocab({ word: 'hi', translation: '你好' });
    expect(v.id).toBe('v1');
    expect(lastCall().request.url).toBe('http://localhost:3000/api/vocab');
  });

  it('saveVocab duplicate returns 409 error', async () => {
    mockProxy({ ok: false, status: 409, statusText: '', json: { error: '该词已在生词本' }, text: '' });
    await expect(saveVocab({ word: 'hi', translation: '你好' })).rejects.toThrow(/已在生词本/);
  });

  it('listVocab GETs with query params, no body/headers', async () => {
    mockProxy({ ok: true, status: 200, statusText: '', json: { items: [], total: 0 }, text: '' });
    await listVocab({ kw: 'hi', page: 1, pageSize: 20 });
    const call = lastCall();
    expect(call.request.method).toBe('GET');
    expect(call.request.url).toContain('/api/vocab?');
    expect(call.request.url).toContain('kw=hi');
    expect(call.request.url).toContain('page=1');
    expect(call.request.url).toContain('pageSize=20');
    expect(call.request.body).toBeUndefined();
    expect(call.request.headers).toBeUndefined();
  });

  it('listVocab without query GETs bare path', async () => {
    mockProxy({ ok: true, status: 200, statusText: '', json: { items: [], total: 0 }, text: '' });
    await listVocab();
    expect(lastCall().request.url).toBe('http://localhost:3000/api/vocab');
  });
});
