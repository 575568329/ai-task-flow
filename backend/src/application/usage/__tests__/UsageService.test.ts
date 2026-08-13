// backend/src/application/usage/__tests__/UsageService.test.ts
// 验证 UsageService.aggregate(五维度聚合纯函数,原"注释自夸便于单测却没测",P2-17 补)。
// 覆盖:空输入/无 usage 跳过/单 session 各维度/taskId 缺失/多模型聚合排序/同模型合并/
// bySession 时间排序/cost 非负。sessionCost 依赖 modelPricing 表,只断言 >=0 不绑具体单价。
import { describe, it, expect } from 'vitest';
import { UsageService } from '../UsageService.js';
import type { ClaudeSessionMeta, ModelAccum } from '@ai-task-flow/shared';

const tok = (input: number, output: number) => ({
  inputTokens: input,
  outputTokens: output,
  cacheCreation5mTokens: 0,
  cacheCreation1hTokens: 0,
  cacheReadTokens: 0,
});

function makeSession(o: {
  sessionId?: string;
  taskId?: string;
  cwd?: string;
  model?: string;
  input?: number;
  output?: number;
  requests?: number;
  assistantCount?: number;
  lastActiveAt?: string;
}): ClaudeSessionMeta {
  const model = o.model ?? 'claude-sonnet';
  const input = o.input ?? 100;
  const output = o.output ?? 50;
  const requests = o.requests ?? 1;
  const mu: ModelAccum = { ...tok(input, output), requests };
  return {
    sessionId: o.sessionId ?? 's1',
    title: 't',
    cwd: o.cwd ?? 'D:/proj',
    lastActiveAt: o.lastActiveAt ?? '2026-08-13T10:00:00Z',
    messageCount: 2,
    source: 'windows',
    usage: {
      byModel: { [model]: mu },
      byDay: { '2026-08-13': { [model]: mu } },
      total: tok(input, output),
      assistantCount: o.assistantCount ?? 1,
      taskId: o.taskId,
    },
  };
}

describe('UsageService.aggregate', () => {
  it('空 sessions:全 0 + 各维度空数组', () => {
    const r = UsageService.aggregate([]);
    expect(r.totalInputTokens).toBe(0);
    expect(r.totalOutputTokens).toBe(0);
    expect(r.totalRequests).toBe(0);
    expect(r.totalCost).toBe(0);
    expect(r.byModel).toEqual([]);
    expect(r.byTask).toEqual([]);
    expect(r.byProject).toEqual([]);
    expect(r.byDay).toEqual([]);
    expect(r.bySession).toEqual([]);
  });

  it('无 usage 的 session 被跳过(不计入 total/bySession)', () => {
    const s: ClaudeSessionMeta = { ...makeSession({}), usage: undefined };
    const r = UsageService.aggregate([s]);
    expect(r.totalInputTokens).toBe(0);
    expect(r.bySession).toEqual([]);
    expect(r.byModel).toEqual([]);
  });

  it('单 session:byModel/byTask/byProject/bySession 各 1 行,total 累加', () => {
    const r = UsageService.aggregate([makeSession({ taskId: 'T-1', input: 100, output: 50 })]);
    expect(r.totalInputTokens).toBe(100);
    expect(r.totalOutputTokens).toBe(50);
    expect(r.byModel).toHaveLength(1);
    expect(r.byTask).toHaveLength(1);
    expect(r.byTask[0].taskId).toBe('T-1');
    expect(r.byProject).toHaveLength(1);
    expect(r.byProject[0].project).toBe('D:/proj');
    expect(r.bySession).toHaveLength(1);
    expect(r.totalRequests).toBe(1);
  });

  it('taskId 缺失 → byTask 空,其他维度仍计入', () => {
    const r = UsageService.aggregate([makeSession({})]);
    expect(r.byTask).toEqual([]);
    expect(r.byModel).toHaveLength(1);
    expect(r.byProject).toHaveLength(1);
  });

  it('多 session 不同模型 → byModel 各一行 + total 累加', () => {
    const r = UsageService.aggregate([
      makeSession({ sessionId: 's1', model: 'claude-sonnet', input: 1000 }),
      makeSession({ sessionId: 's2', model: 'claude-opus', input: 500 }),
    ]);
    expect(r.byModel).toHaveLength(2);
    expect([...r.byModel.map((m) => m.model)].sort()).toEqual(['claude-opus', 'claude-sonnet']);
    expect(r.totalInputTokens).toBe(1500);
    expect(r.bySession).toHaveLength(2);
  });

  it('同模型多 session → byModel 合并成一行,requestCount 累加', () => {
    const r = UsageService.aggregate([
      makeSession({ sessionId: 's1', model: 'claude-sonnet', requests: 2, assistantCount: 2 }),
      makeSession({ sessionId: 's2', model: 'claude-sonnet', requests: 3, assistantCount: 3 }),
    ]);
    expect(r.byModel).toHaveLength(1);
    expect(r.byModel[0].requestCount).toBe(5);
    expect(r.bySession).toHaveLength(2);
    expect(r.totalRequests).toBe(5);
  });

  it('bySession 按最后活跃时间降序', () => {
    const r = UsageService.aggregate([
      makeSession({ sessionId: 'old', lastActiveAt: '2026-08-01T00:00:00Z' }),
      makeSession({ sessionId: 'new', lastActiveAt: '2026-08-13T00:00:00Z' }),
    ]);
    expect(r.bySession[0].sessionId).toBe('new');
    expect(r.bySession[1].sessionId).toBe('old');
  });

  it('cost 非负(单价表命中或未命中为 0,不绑具体单价)', () => {
    const r = UsageService.aggregate([makeSession({ model: 'totally-unknown-model', input: 100 })]);
    expect(r.totalCost).toBeGreaterThanOrEqual(0);
    expect(r.byModel[0].cost).toBeGreaterThanOrEqual(0);
  });
});
