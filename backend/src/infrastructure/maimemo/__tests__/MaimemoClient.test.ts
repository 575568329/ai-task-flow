// backend/src/infrastructure/maimemo/__tests__/MaimemoClient.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SlidingWindowLimiter } from '../MaimemoClient.js';

describe('SlidingWindowLimiter', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('未触顶时不等待，连续 acquire 立即返回', async () => {
    // 用一个 10s/3 的窗口便于测试
    const limiter = new SlidingWindowLimiter([{ sizeMs: 10_000, max: 3 }]);
    // RATE_WINDOWS 是模块级常量，但 acquire 内部固定用它；这里只验证「未满即放行」的快路径
    // 18 次（10s 窗口余量上限）内应全部立即 resolve
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 18; i++) promises.push(limiter.acquire());
    // 全部应在同一 tick 内 resolve（无 setTimeout 等待）
    const results = await Promise.all(promises.map(async p => {
      const race = await Promise.race([p.then(() => 'ok'), new Promise(r => setTimeout(() => r('wait'), 0))]);
      return race;
    }));
    expect(results.every(r => r === 'ok')).toBe(true);
  });

  it('触顶后 acquire 挂起，时间推进到最旧记录滑出后才放行', async () => {
    const limiter = new SlidingWindowLimiter([{ sizeMs: 10_000, max: 18 }]);
    // 先打满 18 次
    for (let i = 0; i < 18; i++) await limiter.acquire();
    // 第 19 次应被挂起（需等到第 1 条滑出 10s 窗口）
    let resolved = false;
    const p = limiter.acquire().then(() => { resolved = true; });
    // 推进一点点时间，不应放行
    await vi.advanceTimersByTimeAsync(5_000);
    expect(resolved).toBe(false);
    // 推进到 ~10s（第 1 条记录滑出窗口），应放行
    await vi.advanceTimersByTimeAsync(6_000);
    await p;
    expect(resolved).toBe(true);
  });
});
