// backend/src/utils/__tests__/http.test.ts
// 验证 fetchWithTimeout(超时/signal 尊重)+ fetchGetRetry(5xx 重试/4xx 不重试/网络错误重试)。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchWithTimeout, fetchGetRetry } from '../http.js';

describe('fetchWithTimeout', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('正常透传 fetch 并返回 response', async () => {
    const mock = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('ok'));
    const res = await fetchWithTimeout('http://x');
    expect(res.ok).toBe(true);
    expect(mock).toHaveBeenCalledOnce();
  });

  it('init 已传 signal 时尊重之,不覆盖', async () => {
    const ac = new AbortController();
    const mock = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('ok'));
    await fetchWithTimeout('http://x', { signal: ac.signal });
    expect(mock.mock.calls[0][1]?.signal).toBe(ac.signal);
  });

  it('未传 signal 时注入 AbortSignal(防挂死)', async () => {
    const mock = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('ok'));
    await fetchWithTimeout('http://x', {}, 5000);
    const signal = mock.mock.calls[0][1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect((signal as AbortSignal).aborted).toBe(false);
  });
});

describe('fetchGetRetry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('200 一次性返回,不重试', async () => {
    const mock = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));
    const res = await fetchGetRetry('http://x', {}, { retries: 2 });
    expect(res.status).toBe(200);
    expect(mock).toHaveBeenCalledOnce();
  });

  it('5xx 重试到成功', async () => {
    const mock = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const res = await fetchGetRetry('http://x', {}, { retries: 2 });
    expect(res.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('4xx 不重试(客户端错误直接返回,避免无谓重试)', async () => {
    const mock = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    const res = await fetchGetRetry('http://x', {}, { retries: 2 });
    expect(res.status).toBe(404);
    expect(mock).toHaveBeenCalledOnce();
  });

  it('持续 5xx 到 retries 用尽,返回最后一次', async () => {
    const mock = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 503 }));
    const res = await fetchGetRetry('http://x', {}, { retries: 1 });
    expect(res.status).toBe(503);
    expect(mock).toHaveBeenCalledTimes(2); // 初始 + 1 重试
  });

  it('网络错误(fetch reject)重试,最终抛', async () => {
    const mock = vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));
    await expect(fetchGetRetry('http://x', {}, { retries: 1 })).rejects.toThrow('network down');
    expect(mock).toHaveBeenCalledTimes(2);
  });
});
