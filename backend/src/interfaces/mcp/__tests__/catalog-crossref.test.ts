// 回归测试:两个 MCP 工具描述必须互相点名(设计 §7.1)。
// 这是防止 AI 把对话结论写进 worklog、或把代码 diff 写进结论卡的首要手段,
// 描述文案一旦被改掉就必须红灯,不能静默漂移。
import { describe, it, expect } from 'vitest';
import { WORKLOG_TOOL_CATALOG, CONCLUSION_TOOL_CATALOG } from '@ai-task-flow/shared';

function descriptionOf(
  catalog: ReadonlyArray<{ name: string; description: string }>,
  name: string,
): string {
  const meta = catalog.find((item) => item.name === name);
  if (!meta) throw new Error(`catalog 中缺少工具 ${name}`);
  return meta.description;
}

describe('MCP tool catalog cross-references', () => {
  it('should point record_work at record_conclusion for discussion conclusions', () => {
    const description = descriptionOf(WORKLOG_TOOL_CATALOG, 'record_work');
    expect(description).toContain('record_conclusion');
  });

  it('should point record_conclusion at record_work for code changes', () => {
    const description = descriptionOf(CONCLUSION_TOOL_CATALOG, 'record_conclusion');
    expect(description).toContain('record_work');
  });
});
