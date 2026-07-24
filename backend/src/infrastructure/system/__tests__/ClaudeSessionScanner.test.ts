// backend/src/infrastructure/system/__tests__/ClaudeSessionScanner.test.ts
// 验证 ClaudeSessionScanner.parseSessionMeta:
//   - 标题提取(跳过系统注入、命名优先、回退)+ cwd
//   - usage 累加(按模型 + cache 5m/1h 拆分 + byDay 分桶)
//   - taskId 标记提取(从 get_task 的 tool_result,取众数)
import { describe, it, expect } from 'vitest';
import { ClaudeSessionScanner } from '../ClaudeSessionScanner.js';
import type { SessionUsage } from '@ai-task-flow/shared';

// parseSessionMeta 为 private static,测试经 as any 访问
const parse = (lines: string[]) =>
  (ClaudeSessionScanner as any).parseSessionMeta(lines) as {
    title: string;
    cwd: string;
    usage: SessionUsage;
  };

// user 消息行:content 支持字符串与 text-block 数组两种形态(真实 jsonl 都会出现)
const userLine = (text: string, cwd = '/mnt/d/Study/ai-task-flow') =>
  JSON.stringify({ type: 'user', message: { role: 'user', content: text }, cwd });
const userBlockLine = (text: string, cwd = '/mnt/d/Study/ai-task-flow') =>
  JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] }, cwd });
const assistantLine = (text: string) =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });

/** 带 usage 的 assistant 行(模拟 Claude API 响应记录) */
const assistantUsageLine = (
  usage: Record<string, number>,
  opts: { model?: string; timestamp?: string; cache1h?: number } = {},
) => {
  const { model = 'claude-sonnet-4-6', timestamp = '2026-07-24T10:00:00Z', cache1h } = opts;
  const message: any = { role: 'assistant', model, usage, content: [{ type: 'text', text: 'ok' }] };
  if (cache1h !== undefined) {
    message.cache_creation = { ephemeral_1h_input_tokens: cache1h };
  }
  return JSON.stringify({ type: 'assistant', timestamp, message });
};

/** get_task 返回的 tool_result 行(含任务标记) */
const taskMarkerLine = (taskId: string) =>
  JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          content: [{ type: 'text', text: `<!-- ai-task-flow: task=${taskId} -->\n# 任务详情` }],
        },
      ],
    },
  });

describe('ClaudeSessionScanner.parseSessionMeta — 标题 & cwd', () => {
  it('跳过 <local-command-caveat> 等系统注入,取首条真实 user 文本', () => {
    const lines = [
      userLine('<local-command-caveat>Caveat: The messages below were generated while you were away.</local-command-caveat>'),
      assistantLine('好的'),
      userLine('拉一下最新的任务'),
    ];
    expect(parse(lines).title).toBe('拉一下最新的任务');
  });

  it('优先采用 system-reminder 里用户命名的会话名', () => {
    const lines = [
      userBlockLine('<system-reminder>\nThe user named this session "个人中心修改".\nThis is a reminder.</system-reminder>'),
      userLine('开始干活'),
    ];
    expect(parse(lines).title).toBe('个人中心修改');
  });

  it('content 为 text-block 数组时同样能跳过命令注入、取真实文本', () => {
    const lines = [userBlockLine('<command-name>/init</command-name>'), userBlockLine('执行006')];
    expect(parse(lines).title).toBe('执行006');
  });

  it('仅有系统注入/无真实 user 文本时回退到 (无标题)', () => {
    const lines = [userLine('<local-command-caveat>Caveat...</local-command-caveat>'), assistantLine('回复')];
    expect(parse(lines).title).toBe('(无标题)');
  });

  it('提取首个非空 cwd 字段', () => {
    const lines = [
      userLine('hi', 'C:\\Study\\ai-task-flow'),
      userLine('again', '/mnt/d/Study/ai-task-flow'),
    ];
    expect(parse(lines).cwd).toBe('C:\\Study\\ai-task-flow');
  });
});

describe('ClaudeSessionScanner.parseSessionMeta — 用量累加', () => {
  it('累加 assistant 行的 input/output/cacheRead,按模型分组', () => {
    const lines = [
      assistantUsageLine({ input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 30 }),
      assistantUsageLine({ input_tokens: 200, output_tokens: 10, cache_read_input_tokens: 5 }),
    ];
    const u = parse(lines).usage;
    expect(u.assistantCount).toBe(2);
    const m = u.byModel['claude-sonnet-4-6'];
    expect(m.inputTokens).toBe(300);
    expect(m.outputTokens).toBe(60);
    expect(m.cacheReadTokens).toBe(35);
    expect(m.requests).toBe(2);
    expect(u.total.inputTokens).toBe(300);
  });

  it('cache_creation 拆 5m(默认)/1h:1h 按 ephemeral_1h,剩余归 5m', () => {
    const lines = [
      assistantUsageLine(
        { input_tokens: 10, output_tokens: 0, cache_creation_input_tokens: 200 },
        { cache1h: 80 },
      ),
    ];
    const m = parse(lines).usage.byModel['claude-sonnet-4-6'];
    expect(m.cacheCreation1hTokens).toBe(80);
    expect(m.cacheCreation5mTokens).toBe(120); // 200 - 80
  });

  it('无 ephemeral_1h 字段时,cache_creation 全部归 5m', () => {
    const lines = [
      assistantUsageLine({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 150 }),
    ];
    const m = parse(lines).usage.byModel['claude-sonnet-4-6'];
    expect(m.cacheCreation5mTokens).toBe(150);
    expect(m.cacheCreation1hTokens).toBe(0);
  });

  it('按本地日期分桶 byDay(跨天会话分到不同日期)', () => {
    // 两天间隔足够大,任何运行时区都不会合并成同一天
    const lines = [
      assistantUsageLine({ input_tokens: 100, output_tokens: 0 }, { timestamp: '2026-07-24T10:00:00Z' }),
      assistantUsageLine({ input_tokens: 50, output_tokens: 0 }, { timestamp: '2026-07-26T09:00:00Z' }),
    ];
    const byDay = parse(lines).usage.byDay;
    expect(Object.keys(byDay).length).toBe(2);
    const sum = Object.values(byDay).reduce(
      (s, d) => s + d.inputTokens + (Object.values(d).reduce((x: number, m: any) => x + (m?.inputTokens ?? 0), 0)),
      0,
    );
    // byDay 是 Record<day, Record<model, ModelAccum>>;取内层 inputTokens 合计
    const inner = Object.values(byDay).reduce((s, models) => {
      return s + Object.values(models).reduce((x, m) => x + m.inputTokens, 0);
    }, 0);
    expect(inner).toBe(150);
    expect(sum).toBe(150); // 守护:两种算法一致
  });
});

describe('ClaudeSessionScanner.parseSessionMeta — 任务标记', () => {
  it('从 get_task 的 tool_result 提取 taskId 标记', () => {
    const lines = [taskMarkerLine('TASK-006'), assistantUsageLine({ input_tokens: 100, output_tokens: 0 })];
    expect(parse(lines).usage.taskId).toBe('TASK-006');
  });

  it('一会话多任务标记时取出现最多的主任务', () => {
    const lines = [
      taskMarkerLine('TASK-006'),
      taskMarkerLine('TASK-006'),
      taskMarkerLine('TASK-007'),
      assistantUsageLine({ input_tokens: 10, output_tokens: 0 }),
    ];
    expect(parse(lines).usage.taskId).toBe('TASK-006');
  });

  it('无 get_task 标记时 taskId 为 undefined', () => {
    const lines = [userLine('随便聊聊'), assistantUsageLine({ input_tokens: 10, output_tokens: 0 })];
    expect(parse(lines).usage.taskId).toBeUndefined();
  });
});
