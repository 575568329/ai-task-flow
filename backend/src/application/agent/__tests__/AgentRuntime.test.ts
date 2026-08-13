// backend/src/application/agent/__tests__/AgentRuntime.test.ts
// AgentRuntime 单测:mock SDK query(FakeQuery:可 push 消息 / interrupt / close / throwError),
// 验证常驻 runtime 的 turn 生命周期——result resolve + session_id 捕获 + 透传、stream 透传、
// ignore 过滤、interrupt 不杀进程、dispose reject pending、consume crash 标 closed、串行排队。
//
// 不接真实 claude 进程:FakeQuery 替代 SDK query 的输出流,测试用 push 驱动 consumeLoop。
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '@ai-task-flow/shared';

// —— vi.mock 必须先于 import 被测模块;holder 用 vi.hoisted 保证 factory 可引用 ——
const queryHolder = vi.hoisted(() => ({ current: null as FakeQuery | null }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  // query 返回 holder.current(测试 beforeEach set),忽略 prompt(options 由 AgentRuntime 组合)
  query: vi.fn(() => queryHolder.current),
}));

import { AgentRuntime } from '../AgentRuntime.js';

/** 可测试驱动的 Fake query:模拟 claude 进程输出流 + interrupt/close 接口 */
interface FakeQuery {
  interrupt: Mock<[], Promise<void>>;
  close: Mock<[], void>;
  push: (m: SDKMessage) => void;
  end: () => void;
  throwError: (e: Error) => void;
  [Symbol.asyncIterator]: () => AsyncIterator<SDKMessage>;
}

function createFakeQuery(): FakeQuery {
  const queue: SDKMessage[] = [];
  let waiter: ((r: IteratorResult<SDKMessage>) => void) | null = null;
  let rejecter: ((e: Error) => void) | null = null;
  let pendingError: Error | null = null;

  return {
    interrupt: vi.fn(async () => {}),
    // close 触发流 done(模拟 query.close 让 for-await 正常结束)
    close: vi.fn(() => {
      if (waiter) { const w = waiter; waiter = null; rejecter = null; w({ value: undefined, done: true }); }
    }),
    push: (m) => {
      if (waiter) { const w = waiter; waiter = null; rejecter = null; w({ value: m, done: false }); }
      else queue.push(m);
    },
    end: () => {
      if (waiter) { const w = waiter; waiter = null; rejecter = null; w({ value: undefined, done: true }); }
    },
    throwError: (e) => {
      if (rejecter) { const rj = rejecter; waiter = null; rejecter = null; rj(e); }
      else pendingError = e; // 无挂起 waiter:下次 next 抛
    },
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise<IteratorResult<SDKMessage>>((resolve, reject) => {
          if (pendingError) { const e = pendingError; pendingError = null; reject(e); return; }
          if (queue.length) return resolve({ value: queue.shift()!, done: false });
          waiter = resolve;
          rejecter = reject;
        }),
    }),
  };
}

// —— 测试消息工厂(SDKMessage 形态,routeMessage 只认 type 字段)——
const msgResult = (over: Record<string, unknown> = {}): SDKMessage =>
  ({ type: 'result', subtype: 'success', session_id: 's-real', is_error: false, ...over }) as unknown as SDKMessage;
const msgAssistant = (): SDKMessage => ({ type: 'assistant', message: { role: 'assistant' } }) as unknown as SDKMessage;
const msgHook = (): SDKMessage => ({ type: 'hook_started' }) as unknown as SDKMessage;

const isResult = (e: AgentEvent): boolean => (e as { type?: string }).type === 'result';
const isAssistant = (e: AgentEvent): boolean => (e as { type?: string }).type === 'assistant';

let runtime: AgentRuntime;
let fake: FakeQuery;

beforeEach(() => {
  fake = createFakeQuery();
  queryHolder.current = fake;
  runtime = new AgentRuntime({ side: 'windows', cwd: 'C:/proj', spawnOpts: { cwd: 'C:/proj' } });
});

/** 让 runTurn 微任务跑一次(其内同步设 pending + push userMsg),再驱动 FakeQuery */
const tick = () => Promise.resolve();

describe('AgentRuntime - turn 生命周期', () => {
  it('should_resolve_turn_and_capture_session_id_on_result', async () => {
    const p = runtime.executeTurn('hi', () => undefined);
    await tick(); // runTurn 设 pending
    fake.push(msgAssistant());
    fake.push(msgResult());
    const { result } = await p;
    expect(runtime.sessionId).toBe('s-real');
    expect(result.session_id).toBe('s-real');
  });

  it('should_passthrough_result_to_onevent', async () => {
    // #5 回归:result 必须透传 onEvent(前端 applyEvent 据此判 turn 结束),否则 UI 卡在思考
    const events: AgentEvent[] = [];
    const p = runtime.executeTurn('hi', (e) => events.push(e));
    await tick();
    fake.push(msgResult());
    await p;
    expect(events.some(isResult)).toBe(true);
  });

  it('should_stream_assistant_message_to_onevent', async () => {
    const events: AgentEvent[] = [];
    const p = runtime.executeTurn('hi', (e) => events.push(e));
    await tick();
    fake.push(msgAssistant());
    fake.push(msgResult());
    await p;
    expect(events.some(isAssistant)).toBe(true);
  });

  it('should_not_passthrough_ignored_messages', async () => {
    // hook/text_delta 等 routeMessage 标 ignore,不该到 onEvent
    const events: AgentEvent[] = [];
    const p = runtime.executeTurn('hi', (e) => events.push(e));
    await tick();
    fake.push(msgHook()); // ignore
    fake.push(msgResult());
    await p;
    expect(events.filter((e) => (e as { type?: string }).type === 'hook_started')).toHaveLength(0);
  });
});

describe('AgentRuntime - interrupt / dispose / crash', () => {
  it('should_call_query_interrupt_and_keep_alive', async () => {
    // interrupt 只中断当前 turn,进程不死:closed 仍为 false,runtime 仍可复用
    await runtime.interrupt();
    expect(fake.interrupt).toHaveBeenCalledTimes(1);
    expect(runtime.closed).toBe(false);
  });

  it('should_reject_pending_and_close_on_dispose', async () => {
    const p = runtime.executeTurn('hi', () => undefined);
    await tick();
    await runtime.dispose();
    await expect(p).rejects.toThrow(/disposed/);
    expect(runtime.closed).toBe(true);
    expect(fake.close).toHaveBeenCalled();
  });

  it('should_be_idempotent_on_dispose', async () => {
    await runtime.dispose();
    await expect(runtime.dispose()).resolves.not.toThrow();
    expect(fake.close).toHaveBeenCalledTimes(1);
  });

  it('should_mark_closed_and_reject_pending_on_consume_crash', async () => {
    // claude 进程 crash:for-await 抛错 → consumeLoop catch → 标 closed + reject 在途 turn
    const p = runtime.executeTurn('hi', () => undefined);
    await tick();
    fake.throwError(new Error('claude process crashed'));
    await expect(p).rejects.toThrow(/crashed/);
    expect(runtime.closed).toBe(true);
  });
});

describe('AgentRuntime - 串行与复用', () => {
  it('should_keep_session_id_across_turns', async () => {
    // 连发复用:同一 runtime 第二轮 session_id 不变(常驻进程跨 turn 存活)
    const p1 = runtime.executeTurn('A', () => undefined);
    await tick();
    fake.push(msgResult({ session_id: 's-real' }));
    await p1;
    expect(runtime.sessionId).toBe('s-real');

    const p2 = runtime.executeTurn('B', () => undefined);
    await tick();
    fake.push(msgResult({ session_id: 's-real' }));
    await p2;
    expect(runtime.sessionId).toBe('s-real');
  });

  it('should_serialize_concurrent_turns', async () => {
    // turnChain 串行:B 必须等 A resolve 后才开始(防 pending 单槽被覆盖)
    const eventsA: AgentEvent[] = [];
    const eventsB: AgentEvent[] = [];
    const pA = runtime.executeTurn('A', (e) => eventsA.push(e));
    await tick(); // A 的 pending 已设
    const pB = runtime.executeTurn('B', (e) => eventsB.push(e));
    await tick(); // B 仍在 turnChain 队列,A 未 resolve → B 未跑

    fake.push(msgResult({ session_id: 's-real' })); // resolve A
    await pA;
    expect(eventsA.some(isResult)).toBe(true);
    // B 尚未完成(还在等它的 result)
    expect(eventsB.some(isResult)).toBe(false);

    await tick(); // A settle → turnChain 放行 B 的 runTurn,设 pending
    fake.push(msgResult({ session_id: 's-real' })); // resolve B
    await pB;
    expect(eventsB.some(isResult)).toBe(true);
  });
});
