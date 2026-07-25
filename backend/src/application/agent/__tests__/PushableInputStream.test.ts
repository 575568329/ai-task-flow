// backend/src/application/agent/__tests__/PushableInputStream.test.ts
// PushableInputStream 单测:push 顺序消费 / end→done / 挂起等待唤醒 / end 后 push 忽略 / end 幂等。
import { describe, it, expect } from 'vitest';
import { PushableInputStream } from '../PushableInputStream.js';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

const msg = (text: string): SDKUserMessage => ({
  type: 'user',
  message: { role: 'user', content: text },
  parent_tool_use_id: null,
});

const drain = async (s: PushableInputStream, max = 100): Promise<SDKUserMessage[]> => {
  const out: SDKUserMessage[] = [];
  const it = s[Symbol.asyncIterator]();
  for (let i = 0; i < max; i++) {
    const r = await it.next();
    if (r.done) break;
    out.push(r.value);
  }
  return out;
};

describe('PushableInputStream', () => {
  it('should_yield_pushed_messages_in_order', async () => {
    const s = new PushableInputStream();
    s.push(msg('a'));
    s.push(msg('b'));
    s.push(msg('c'));
    s.end();
    expect((await drain(s)).map((m) => (m.message as { content: string }).content)).toEqual(['a', 'b', 'c']);
  });

  it('should_return_done_when_ended_without_data', async () => {
    const s = new PushableInputStream();
    s.end();
    const it = s[Symbol.asyncIterator]();
    expect((await it.next()).done).toBe(true);
  });

  it('should_wake_pending_consumer_on_push', async () => {
    const s = new PushableInputStream();
    const it = s[Symbol.asyncIterator]();
    const pending = it.next();
    s.push(msg('hello'));
    const r = await pending;
    expect(r.done).toBe(false);
    expect((r.value.message as { content: string }).content).toBe('hello');
  });

  it('should_wake_pending_consumer_on_end', async () => {
    const s = new PushableInputStream();
    const it = s[Symbol.asyncIterator]();
    const pending = it.next();
    s.end();
    expect((await pending).done).toBe(true);
  });

  it('should_ignore_push_after_end', async () => {
    const s = new PushableInputStream();
    s.push(msg('keep'));
    s.end();
    // end 后再 push:被忽略,不进入流
    s.push(msg('dropped'));
    expect((await drain(s)).map((m) => (m.message as { content: string }).content)).toEqual(['keep']);
    expect(s.ended).toBe(true);
  });

  it('should_be_idempotent_on_end', () => {
    const s = new PushableInputStream();
    s.end();
    s.end(); // 不抛、不改变状态
    expect(s.ended).toBe(true);
  });

  it('should_mix_buffered_then_waited_correctly', async () => {
    // 先 push 一条(buffer 命中),再挂起等待第二条
    const s = new PushableInputStream();
    s.push(msg('first'));
    const it = s[Symbol.asyncIterator]();
    const r1 = await it.next();
    expect((r1.value.message as { content: string }).content).toBe('first');
    const pending = it.next();
    s.push(msg('second'));
    const r2 = await pending;
    expect((r2.value.message as { content: string }).content).toBe('second');
    s.end();
    expect((await it.next()).done).toBe(true);
  });
});
