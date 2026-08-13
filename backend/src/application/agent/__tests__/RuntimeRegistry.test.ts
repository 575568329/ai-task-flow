// backend/src/application/agent/__tests__/RuntimeRegistry.test.ts
// RuntimeRegistry 单测:CRUD / 双池隔离 / GC 各分支 / sweeper(fake timers)/ clear。
// 用 mock RuntimeRecord(vi.fn dispose),不依赖 SDK(#3 才实现真实 AgentRuntime)。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RuntimeRegistry,
  isStale,
  type RuntimeRecord,
  RUNTIME_MAX_ABSOLUTE_LIFETIME_MS,
  RUNTIME_MAX_IDLE_MS,
  SWEEP_INTERVAL_MS,
} from '../RuntimeRegistry.js';

/** 固定时间锚,避免 Date.now() 不确定性(GC 判定全靠 now 参数) */
const NOW = 1_700_000_000_000;

const makeRecord = (over: Partial<RuntimeRecord> = {}): RuntimeRecord => ({
  sessionId: 's1',
  side: 'windows',
  createdAt: NOW,
  lastUsedAt: NOW,
  activeTurnCount: 0,
  closed: false,
  dispose: vi.fn().mockResolvedValue(undefined),
  ...over,
});

describe('RuntimeRegistry - CRUD', () => {
  let reg: RuntimeRegistry;
  beforeEach(() => {
    reg = new RuntimeRegistry();
  });

  it('should_set_and_get_by_side_and_session_id', () => {
    const r = makeRecord();
    reg.set('windows', 's1', r);
    expect(reg.get('windows', 's1')).toBe(r);
  });

  it('should_return_undefined_for_missing_key', () => {
    expect(reg.get('windows', 'nope')).toBeUndefined();
  });

  it('should_delete_record', () => {
    reg.set('windows', 's1', makeRecord());
    reg.delete('windows', 's1');
    expect(reg.get('windows', 's1')).toBeUndefined();
  });

  it('should_touch_update_last_used_at', () => {
    const r = makeRecord({ lastUsedAt: 0 });
    reg.touch(r, NOW);
    expect(r.lastUsedAt).toBe(NOW);
  });

  it('should_isolate_windows_and_wsl_pools', () => {
    // 同 sessionId、不同 side 是两条独立记录(两个不同 claude 进程)
    const win = makeRecord({ side: 'windows' });
    const wsl = makeRecord({ side: 'wsl' });
    reg.set('windows', 's1', win);
    reg.set('wsl', 's1', wsl);
    expect(reg.get('windows', 's1')).toBe(win);
    expect(reg.get('wsl', 's1')).toBe(wsl);
    expect(reg.getSnapshot()).toEqual({ windowsCount: 1, wslCount: 1, total: 2 });
  });
});

describe('isStale - GC 判定(纯函数)', () => {
  it('should_be_stale_when_closed', () => {
    expect(isStale(makeRecord({ closed: true }), NOW)).toBe(true);
  });

  it('should_be_stale_when_absolute_lifetime_exceeded', () => {
    const r = makeRecord({ createdAt: NOW - RUNTIME_MAX_ABSOLUTE_LIFETIME_MS - 1, lastUsedAt: NOW });
    // 即使刚用过、有活跃 turn,绝对寿命到也得回收(防泄漏)
    expect(isStale(makeRecord({ ...r, activeTurnCount: 2 }), NOW)).toBe(true);
  });

  it('should_be_stale_when_idle_exceeded_and_no_active_turn', () => {
    const r = makeRecord({
      createdAt: NOW,
      lastUsedAt: NOW - RUNTIME_MAX_IDLE_MS - 1,
      activeTurnCount: 0,
    });
    expect(isStale(r, NOW)).toBe(true);
  });

  it('should_keep_record_with_active_turn_even_if_idle', () => {
    // 活跃 turn 时不回收(避免中断进行中的会话)
    const r = makeRecord({
      createdAt: NOW,
      lastUsedAt: NOW - RUNTIME_MAX_IDLE_MS - 1,
      activeTurnCount: 1,
    });
    expect(isStale(r, NOW)).toBe(false);
  });

  it('should_keep_fresh_record', () => {
    expect(isStale(makeRecord(), NOW)).toBe(false);
  });
});

describe('RuntimeRegistry - cleanupStale', () => {
  let reg: RuntimeRegistry;
  beforeEach(() => {
    reg = new RuntimeRegistry();
  });

  it('should_evict_closed_record_and_call_dispose', async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    reg.set('windows', 's1', makeRecord({ closed: true, dispose }));
    const n = await reg.cleanupStale(NOW);
    expect(n).toBe(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(reg.get('windows', 's1')).toBeUndefined();
  });

  it('should_evict_idle_record_without_active_turn', async () => {
    reg.set('wsl', 's1', makeRecord({
      side: 'wsl',
      createdAt: NOW,
      lastUsedAt: NOW - RUNTIME_MAX_IDLE_MS - 1,
      activeTurnCount: 0,
    }));
    await reg.cleanupStale(NOW);
    expect(reg.getSnapshot().total).toBe(0);
  });

  it('should_keep_active_record_even_if_idle', async () => {
    reg.set('windows', 's1', makeRecord({
      createdAt: NOW,
      lastUsedAt: NOW - RUNTIME_MAX_IDLE_MS - 1,
      activeTurnCount: 1,
    }));
    await reg.cleanupStale(NOW);
    expect(reg.get('windows', 's1')).toBeDefined();
  });

  it('should_evict_multiple_and_keep_fresh', async () => {
    reg.set('windows', 'stale', makeRecord({ closed: true }));
    reg.set('windows', 'fresh', makeRecord());
    const n = await reg.cleanupStale(NOW);
    expect(n).toBe(1);
    expect(reg.get('windows', 'stale')).toBeUndefined();
    expect(reg.get('windows', 'fresh')).toBeDefined();
  });

  it('should_not_block_eviction_when_dispose_throws', async () => {
    // dispose 失败也要从注册表移除(坏 runtime 不能卡住 GC)
    reg.set('windows', 's1', makeRecord({ closed: true, dispose: vi.fn().mockRejectedValue(new Error('boom')) }));
    await reg.cleanupStale(NOW);
    expect(reg.get('windows', 's1')).toBeUndefined();
  });
});

describe('RuntimeRegistry - sweeper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should_run_cleanupStale_on_interval_and_evict_stale', async () => {
    const reg = new RuntimeRegistry();
    reg.set('windows', 's1', makeRecord({ closed: true }));
    reg.startSweeper();
    expect(reg.isSweeping).toBe(true);

    // 推进一个 sweeper 周期:cleanupStale 是 async,用 vi.advanceTimersByTimeAsync 等它落定
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(reg.get('windows', 's1')).toBeUndefined();

    reg.stopSweeper();
    expect(reg.isSweeping).toBe(false);
  });

  it('should_be_idempotent_start_and_unref_safe', () => {
    const reg = new RuntimeRegistry();
    reg.startSweeper();
    reg.startSweeper(); // 重复 start 不应起第二个 timer
    reg.stopSweeper();
  });
});

describe('RuntimeRegistry - clear', () => {
  it('should_dispose_all_and_empty', async () => {
    const reg = new RuntimeRegistry();
    const d1 = vi.fn().mockResolvedValue(undefined);
    const d2 = vi.fn().mockResolvedValue(undefined);
    reg.set('windows', 's1', makeRecord({ dispose: d1 }));
    reg.set('wsl', 's2', makeRecord({ side: 'wsl', sessionId: 's2', dispose: d2 }));
    await reg.clear();
    expect(d1).toHaveBeenCalledTimes(1);
    expect(d2).toHaveBeenCalledTimes(1);
    expect(reg.getSnapshot().total).toBe(0);
  });
});
