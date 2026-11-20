// extension/src/sidepanel/api/__tests__/backend.test.ts
// backend.ts 经 chrome.runtime.sendMessage({type:'PROXY_FETCH',request}) 走 background 代理,
// 故 mock sendMessage 返回 ProxyResult(而非 global.fetch —— 那是早期直连 fetch 的旧 mock,已过时)。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  captureToDrafts,
  createTaskFromDraft,
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
    expect(call.request.url).toBe('http://localhost:47821/api/tasks/clip');
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
    expect(call.request.url).toBe('http://localhost:47821/api/tasks');
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
