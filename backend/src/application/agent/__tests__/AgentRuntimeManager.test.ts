// backend/src/application/agent/__tests__/AgentRuntimeManager.test.ts
// AgentRuntimeManager 单测:mock AgentRuntime(FakeRuntime,可控 sessionId/closed/executeTurn 失败)+
// mock sdk-loader(避免真实 spawn wsl)。验证 acquire(命中/miss+resume/新会话 temp)、
// 首 turn rekey、closed→evictAll、signal abort→interrupt、双侧隔离、interrupt/dispose 委托。
//
// 用真实 RuntimeRegistry(纯逻辑已单测),只隔离 AgentRuntime 与 spawn。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { RuntimeRecord } from '../RuntimeRegistry.js';

// —— vi.mock 先于 import;holder 用 vi.hoisted,factory 通过它取运行时工厂 ——
const runtimeHolder = vi.hoisted(() => ({ factory: null as null | ((opts: RuntimeOpts) => FakeRuntime) }));
vi.mock('../AgentRuntime.js', () => ({
  AgentRuntime: vi.fn((opts: RuntimeOpts) => runtimeHolder.factory!(opts)),
}));
vi.mock('../../../utils/sdk-loader.js', () => ({
  buildSdkSpawnOptions: vi.fn(async () => ({ cwd: 'C:/test' })),
}));

import { AgentRuntimeManager } from '../AgentRuntimeManager.js';
import { AgentRuntime } from '../AgentRuntime.js';

interface RuntimeOpts {
  side: 'windows' | 'wsl';
  cwd: string;
  spawnOpts: { cwd: string };
  sdkOptions?: { resume?: string };
}

/** 可控 FakeRuntime:实现 RuntimeRecord + executeTurn/interrupt/dispose,测试驱动成败与 sessionId */
interface FakeRuntime extends RuntimeRecord {
  executeTurn: Mock;
  interrupt: Mock;
  dispose: Mock;
  _failNext: (e: Error) => void;
}

const createFakeRuntime = (opts: RuntimeOpts): FakeRuntime => {
  let failError: Error | null = null;
  let closed = false;
  return {
    side: opts.side,
    createdAt: 0,
    lastUsedAt: 0,
    activeTurnCount: 0,
    // 默认 claude 分配的 sessionId;rekey 据此迁移
    sessionId: 's-real',
    get closed() {
      return closed;
    },
    executeTurn: vi.fn(async () => {
      if (failError) {
        closed = true; // runtime 不可用,Manager catch 据 closed 触发 evictAll
        throw failError;
      }
      return { result: { session_id: 's-real', subtype: 'success', is_error: false } };
    }),
    interrupt: vi.fn(async () => {}),
    dispose: vi.fn(async () => {
      closed = true;
    }),
    _failNext(e: Error) {
      failError = e;
    },
  };
};

const agentRuntimeMock = AgentRuntime as unknown as Mock;
const onEvent = () => undefined;

let manager: AgentRuntimeManager;
const created: FakeRuntime[] = [];

beforeEach(() => {
  agentRuntimeMock.mockClear();
  created.length = 0;
  runtimeHolder.factory = (opts) => {
    const r = createFakeRuntime(opts);
    created.push(r);
    return r;
  };
  manager = new AgentRuntimeManager();
});

describe('AgentRuntimeManager - acquire 与 rekey', () => {
  it('should_rekey_temp_key_to_real_session_id_for_new_session', async () => {
    // 新会话:无 sessionId → temp key → 首 turn 后 rekey 到 claude 分配的 s-real
    const r = await manager.executeTurn({ side: 'windows', cwd: 'C:/p', text: 'A', onEvent });
    expect(r.sessionId).toBe('s-real');
    expect(manager.getSnapshot()).toEqual({ windowsCount: 1, wslCount: 0, total: 1 });
  });

  it('should_reuse_runtime_when_real_session_id_hits', async () => {
    // 连发复用:第二次传真实 sessionId → 命中,不新建 runtime
    await manager.executeTurn({ side: 'windows', cwd: 'C:/p', text: 'A', onEvent });
    const ctorBefore = agentRuntimeMock.mock.calls.length;
    const r2 = await manager.executeTurn({
      side: 'windows',
      sessionId: 's-real',
      cwd: 'C:/p',
      text: 'B',
      onEvent,
    });
    expect(agentRuntimeMock.mock.calls.length).toBe(ctorBefore); // 复用,未新建
    expect(r2.sessionId).toBe('s-real');
  });

  it('should_create_with_resume_when_session_id_misses', async () => {
    // resume 续接:传入历史 sessionId 但池中无(GC 过/重启后)→ 新建并 resume 该 session
    await manager.executeTurn({ side: 'windows', sessionId: 'history-uuid', cwd: 'C:/p', text: 'A', onEvent });
    const opts = agentRuntimeMock.mock.calls[0][0] as RuntimeOpts;
    expect(opts.sdkOptions?.resume).toBe('history-uuid');
  });
});

describe('AgentRuntimeManager - evict / signal', () => {
  it('should_evict_all_keys_when_runtime_closed', async () => {
    // runtime 不可用(executeTurn 抛错 + closed):evictAll 清注册表,下次 acquire 重建
    runtimeHolder.factory = (opts) => {
      const r = createFakeRuntime(opts);
      r._failNext(new Error('claude crashed'));
      created.push(r);
      return r;
    };
    await expect(
      manager.executeTurn({ side: 'windows', cwd: 'C:/p', text: 'A', onEvent }),
    ).rejects.toThrow('claude crashed');
    expect(manager.getSnapshot().total).toBe(0);
  });

  it('should_call_runtime_interrupt_when_signal_aborted', async () => {
    // signal 已 abort:onAbort 立即调 runtime.interrupt(进程不死,下次复用)
    const ac = new AbortController();
    ac.abort();
    await manager.executeTurn({
      side: 'windows',
      cwd: 'C:/p',
      text: 'A',
      signal: ac.signal,
      onEvent,
    });
    expect(created[0].interrupt).toHaveBeenCalledTimes(1);
  });

  it('should_remove_signal_listener_after_turn', async () => {
    // turn 完成后 signal 解绑:后续 abort 不再触发已结束 turn 的 interrupt
    const ac = new AbortController();
    await manager.executeTurn({ side: 'windows', cwd: 'C:/p', text: 'A', signal: ac.signal, onEvent });
    const callsBefore = created[0].interrupt.mock.calls.length;
    ac.abort(); // turn 已结束,这条 abort 不该再 interrupt
    expect(created[0].interrupt.mock.calls.length).toBe(callsBefore);
  });
});

describe('AgentRuntimeManager - 双侧隔离', () => {
  it('should_isolate_windows_and_wsl_pools', async () => {
    // 同 sessionId、不同 side → 两个独立 runtime(两个 claude 进程),互不串台
    await manager.executeTurn({ side: 'windows', cwd: 'C:/p', text: 'A', onEvent });
    await manager.executeTurn({ side: 'wsl', cwd: 'C:/p', text: 'B', onEvent });
    expect(manager.getSnapshot()).toEqual({ windowsCount: 1, wslCount: 1, total: 2 });
    expect(created).toHaveLength(2);

    // windows 的 interrupt 不影响 wsl
    await manager.interrupt('windows', 's-real');
    expect(created[0].interrupt).toHaveBeenCalledTimes(1);
    expect(created[1].interrupt).not.toHaveBeenCalled();
  });
});

describe('AgentRuntimeManager - interrupt / dispose 委托', () => {
  it('should_interrupt_existing_runtime_by_session_id', async () => {
    await manager.executeTurn({ side: 'windows', cwd: 'C:/p', text: 'A', onEvent });
    await manager.interrupt('windows', 's-real');
    expect(created[0].interrupt).toHaveBeenCalledTimes(1);
  });

  it('should_not_throw_when_interrupting_unknown_runtime', async () => {
    // 不存在的 runtime:interrupt/dispose 静默(?.()),不抛
    await expect(manager.interrupt('windows', 'nope')).resolves.not.toThrow();
    await expect(manager.dispose('windows', 'nope')).resolves.not.toThrow();
  });

  it('should_dispose_runtime_and_remove_from_registry', async () => {
    await manager.executeTurn({ side: 'windows', cwd: 'C:/p', text: 'A', onEvent });
    await manager.dispose('windows', 's-real');
    expect(created[0].dispose).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot().total).toBe(0);
  });

  it('should_dispose_all_on_shutdown', async () => {
    await manager.executeTurn({ side: 'windows', cwd: 'C:/p', text: 'A', onEvent });
    await manager.executeTurn({ side: 'wsl', cwd: 'C:/p', text: 'B', onEvent });
    await manager.shutdown();
    expect(created[0].dispose).toHaveBeenCalledTimes(1);
    expect(created[1].dispose).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot().total).toBe(0);
  });
});
