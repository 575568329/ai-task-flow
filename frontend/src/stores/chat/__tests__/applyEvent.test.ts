// frontend/src/stores/chat/__tests__/applyEvent.test.ts
// applyEvent 纯函数单测:覆盖 partial 思考流式合并、终态去重(防翻倍)、tool_result 回填等高风险分支。
import { describe, it, expect } from 'vitest';
import { applyEvent } from '../applyEvent';
import type { AgentEvent, ChatTurn } from '@ai-task-flow/shared';

/** 构造 stream_event thinking_delta 增量(partial 模式逐字) */
const tDelta = (chunk: string): AgentEvent => ({
  type: 'stream_event',
  event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: chunk } },
});

/** 构造 assistant 终态事件(content 数组) */
const assistant = (content: unknown[]): AgentEvent => ({
  type: 'assistant',
  message: { role: 'assistant', content },
});

describe('applyEvent — stream_event thinking_delta(partial 流式)', () => {
  it('should_create_assistant_turn_with_thinking_when_delta_arrives_on_empty_turns', () => {
    const out = applyEvent([], tDelta('你好'));
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('assistant');
    expect(out[0].blocks).toEqual([{ kind: 'thinking', thinking: '你好' }]);
  });

  it('should_append_chunk_to_last_thinking_when_consecutive_deltas', () => {
    let turns = applyEvent([], tDelta('你好'));
    turns = applyEvent(turns, tDelta('世界'));
    expect(turns[0].blocks).toEqual([{ kind: 'thinking', thinking: '你好世界' }]);
  });

  it('should_create_new_thinking_block_when_last_block_is_text', () => {
    // 末尾是 text block(非 thinking),thinking 增量应新建 thinking block 而非拼进 text
    const prev: ChatTurn[] = [{ id: 'a', role: 'assistant', blocks: [{ kind: 'text', text: 'hi' }] }];
    const turns = applyEvent(prev, tDelta('想'));
    expect(turns[0].blocks).toEqual([
      { kind: 'text', text: 'hi' },
      { kind: 'thinking', thinking: '想' },
    ]);
  });

  it('should_return_turns_unchanged_when_stream_event_is_not_thinking_delta', () => {
    // text_delta / signature_delta 等非思考增量:过滤掉,turns 原引用不变
    const ev: AgentEvent = {
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } },
    };
    const before: ChatTurn[] = [{ id: 'a', role: 'assistant', blocks: [{ kind: 'text', text: 't' }] }];
    expect(applyEvent(before, ev)).toBe(before);
  });
});

describe('applyEvent — assistant 终态去重(防 thinking 翻倍)', () => {
  it('should_skip_terminal_thinking_when_last_block_already_thinking_from_stream', () => {
    // 去重核心:partial 下 stream_event 已逐字构建 thinking,终态 assistant 再发完整 thinking 不应翻倍
    let turns = applyEvent([], tDelta('思考'));
    turns = applyEvent(turns, assistant([
      { type: 'thinking', thinking: '思考' },
      { type: 'text', text: '答复' },
    ]));
    expect(turns[0].blocks).toEqual([
      { kind: 'thinking', thinking: '思考' }, // 没翻倍
      { kind: 'text', text: '答复' },
    ]);
  });

  it('should_merge_terminal_thinking_when_no_prior_stream_thinking', () => {
    // 老版本/未开 partial:无 stream 前导,终态 assistant 正常合并 thinking(兜底)
    const turns = applyEvent([], assistant([
      { type: 'thinking', thinking: '完整思考' },
      { type: 'text', text: '答复' },
    ]));
    expect(turns[0].blocks).toEqual([
      { kind: 'thinking', thinking: '完整思考' },
      { kind: 'text', text: '答复' },
    ]);
  });

  it('should_merge_text_into_last_text_block_avoiding_fragments', () => {
    // text 碎片合并到末尾 text block
    let turns = applyEvent([], assistant([{ type: 'text', text: 'part1' }]));
    turns = applyEvent(turns, assistant([{ type: 'text', text: 'part2' }]));
    expect(turns[0].blocks).toEqual([{ kind: 'text', text: 'part1part2' }]);
  });
});

describe('applyEvent — tool_use / tool_result', () => {
  it('should_backfill_tool_result_by_tool_use_id', () => {
    // assistant 发 tool_use → user 回 tool_result,按 id 关联回填到对应 tool_use 块
    let turns = applyEvent([], assistant([
      { type: 'tool_use', id: 't1', name: 'Read', input: { path: '/a' } },
    ]));
    turns = applyEvent(turns, {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
    });
    const tu = turns[0].blocks?.find((b) => b.kind === 'tool_use');
    expect(tu?.kind).toBe('tool_use');
    expect(tu && tu.kind === 'tool_use' ? tu.result : undefined).toEqual({ content: 'ok', isError: false });
  });

  it('should_mark_tool_result_is_error_when_flag_set', () => {
    let turns = applyEvent([], assistant([
      { type: 'tool_use', id: 't1', name: 'Bash', input: { cmd: 'x' } },
    ]));
    turns = applyEvent(turns, {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'boom', is_error: true }],
      },
    });
    const tu = turns[0].blocks?.find((b) => b.kind === 'tool_use');
    expect(tu && tu.kind === 'tool_use' ? tu.result : undefined).toEqual({ content: 'boom', isError: true });
  });

  it('should_update_existing_tool_use_input_when_same_id_reappears', () => {
    // 同 id tool_use 再现:更新 input,不重复新增
    let turns = applyEvent([], assistant([
      { type: 'tool_use', id: 't1', name: 'Read', input: { path: '/a' } },
    ]));
    turns = applyEvent(turns, assistant([
      { type: 'tool_use', id: 't1', name: 'Read', input: { path: '/b' } },
    ]));
    const tu = turns[0].blocks?.find((b) => b.kind === 'tool_use');
    expect(tu && tu.kind === 'tool_use' ? tu.input : undefined).toEqual({ path: '/b' });
    expect(turns[0].blocks).toHaveLength(1);
  });
});

describe('applyEvent — 非归一化事件透传', () => {
  it('should_return_turns_unchanged_for_result_system_error_events', () => {
    // result/system/error 由 send() 处理终态,applyEvent 不动 turns(原引用)
    const before: ChatTurn[] = [{ id: 'a', role: 'assistant', blocks: [] }];
    expect(applyEvent(before, { type: 'result', subtype: 'success' })).toBe(before);
    expect(applyEvent(before, { type: 'system', subtype: 'init' })).toBe(before);
    expect(applyEvent(before, { type: 'error', message: 'boom' })).toBe(before);
  });
});
