// backend/src/application/agent/__tests__/routeMessage.test.ts
// routeMessage 单测:result→turnEnd / assistant·user·system-init→stream / thinking_delta→stream /
// text_delta·system非init·其他→ignore。过滤逻辑与 AgentRunner.shouldKeep 同源。
import { describe, it, expect } from 'vitest';
import { routeMessage } from '../routeMessage.js';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

const asMsg = (m: object): SDKMessage => m as unknown as SDKMessage;

describe('routeMessage', () => {
  it('should_route_result_as_turnEnd', () => {
    const r = routeMessage(asMsg({ type: 'result', subtype: 'success', session_id: 's1', is_error: false }));
    expect(r.kind).toBe('turnEnd');
    if (r.kind === 'turnEnd') expect(r.result.session_id).toBe('s1');
  });

  it('should_route_result_error_as_turnEnd_too', () => {
    // interrupt 后的 result 是 error_during_execution,仍是 turnEnd(上层据 subtype 识别中断)
    const r = routeMessage(asMsg({ type: 'result', subtype: 'error_during_execution', session_id: 's1', is_error: true }));
    expect(r.kind).toBe('turnEnd');
  });

  it('should_stream_assistant_message', () => {
    expect(routeMessage(asMsg({ type: 'assistant', message: { role: 'assistant' } })).kind).toBe('stream');
  });

  it('should_stream_user_message', () => {
    expect(routeMessage(asMsg({ type: 'user', message: { role: 'user' } })).kind).toBe('stream');
  });

  it('should_stream_system_init', () => {
    expect(routeMessage(asMsg({ type: 'system', subtype: 'init' })).kind).toBe('stream');
  });

  it('should_ignore_system_non_init', () => {
    expect(routeMessage(asMsg({ type: 'system', subtype: 'compact' })).kind).toBe('ignore');
  });

  it('should_stream_thinking_delta', () => {
    const r = routeMessage(
      asMsg({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '...' } } }),
    );
    expect(r.kind).toBe('stream');
  });

  it('should_ignore_text_delta', () => {
    // text_delta 过滤:文本走终态 assistant 事件,避免 SSE 双流
    const r = routeMessage(
      asMsg({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '...' } } }),
    );
    expect(r.kind).toBe('ignore');
  });

  it('should_ignore_unknown_types', () => {
    expect(routeMessage(asMsg({ type: 'hook_started' })).kind).toBe('ignore');
    expect(routeMessage(asMsg({ type: 'thinking_tokens' })).kind).toBe('ignore');
  });
});
