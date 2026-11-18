import { describe, it, expect, afterEach, vi } from 'vitest';
import { resolveManualSource, resolveMcpSource } from '../source.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveMcpSource', () => {
  it('should prefer AI_AGENT and CLAUDE_CODE_SESSION_ID', () => {
    vi.stubEnv('AI_AGENT', 'claude-code_2-1-314_agent');
    vi.stubEnv('CLAUDE_CODE_SESSION_ID', 'sess-1');
    const source = resolveMcpSource({ name: 'other', version: '9.9' }, '话题A');
    expect(source.tool).toBe('claude-code');
    expect(source.conversationId).toBe('sess-1');
    expect(source.conversationName).toBe('话题A');
    expect(source.agentVersion).toBe('9.9');
  });

  it('should fall back to client name and a process fingerprint', () => {
    vi.stubEnv('AI_AGENT', '');
    vi.stubEnv('CLAUDE_CODE_SESSION_ID', '');
    const source = resolveMcpSource({ name: 'zcode', version: '1.0' });
    expect(source.tool).toBe('zcode');
    expect(source.conversationId).toMatch(/^zcode:\d+:\d+$/);
  });

  it('should fall back to unknown when nothing is available', () => {
    vi.stubEnv('AI_AGENT', '');
    vi.stubEnv('CLAUDE_CODE_SESSION_ID', '');
    const source = resolveMcpSource(undefined);
    expect(source.tool).toBe('unknown');
  });

  it('should treat a blank client name as absent and fall back to unknown', () => {
    vi.stubEnv('AI_AGENT', '');
    vi.stubEnv('CLAUDE_CODE_SESSION_ID', '');
    const source = resolveMcpSource({ name: '   ' });
    expect(source.tool).toBe('unknown');
    expect(source.conversationId).toMatch(/^unknown:\d+:\d+$/);
  });
});

describe('resolveManualSource', () => {
  it('should mark manual and omit conversationId', () => {
    const source = resolveManualSource();
    expect(source.tool).toBe('manual');
    expect(source.conversationId).toBeUndefined();
  });
});
