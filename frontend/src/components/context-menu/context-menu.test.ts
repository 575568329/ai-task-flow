// frontend/src/components/context-menu/context-menu.test.ts
// 抽象层纯函数测试：resolve（动态求值）+ trimSeparators（分隔线清理）。
import { describe, it, expect } from 'vitest';
import { resolve, type MenuContext, type MenuItem } from './types';
import { trimSeparators } from './ContextMenuHost';

const sep = (k: string): MenuItem<unknown> => ({ type: 'separator', key: k });
const act = (k: string): MenuItem<unknown> => ({
  type: 'action',
  key: k,
  label: k,
  onSelect: () => {},
});
const keys = (xs: MenuItem<unknown>[]) => xs.map((x) => x.key);

describe('resolve（动态字段求值）', () => {
  const ctx = { target: { id: 'x' }, ctx: {} } as MenuContext<unknown, unknown>;

  it('静态值原样返回', () => {
    expect(resolve('hi', ctx)).toBe('hi');
    expect(resolve(42, ctx)).toBe(42);
    expect(resolve(true, ctx)).toBe(true);
  });

  it('函数按上下文求值', () => {
    expect(resolve((c) => (c.target as { id: string }).id, ctx)).toBe('x');
  });
});

describe('trimSeparators（清理多余分隔线）', () => {
  it('去掉开头 separator', () => {
    expect(keys(trimSeparators([sep('s1'), act('a1')]))).toEqual(['a1']);
  });

  it('去掉结尾 separator', () => {
    expect(keys(trimSeparators([act('a1'), sep('s1')]))).toEqual(['a1']);
  });

  it('连续 separator 只保留第一个', () => {
    expect(keys(trimSeparators([act('a'), sep('s1'), sep('s2'), act('b')]))).toEqual([
      'a',
      's1',
      'b',
    ]);
  });

  it('空数组返回空', () => {
    expect(trimSeparators([])).toEqual([]);
  });

  it('全是 separator 返回空', () => {
    expect(keys(trimSeparators([sep('s1'), sep('s2')]))).toEqual([]);
  });

  it('保留正常的中段 separator', () => {
    expect(keys(trimSeparators([act('a'), sep('s'), act('b')]))).toEqual(['a', 's', 'b']);
  });
});
