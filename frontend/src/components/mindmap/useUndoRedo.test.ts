// frontend/src/components/mindmap/useUndoRedo.test.ts
// 撤销/重做快照栈测试：记录/undo/redo/redo 清空/上限。
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUndoRedo } from './useUndoRedo';
import type { MindmapRFNode } from './MindmapNode';
import type { MindmapRFEdge } from './BranchEdge';

function node(id: string): MindmapRFNode {
  return { id, type: 'mindmap', position: { x: 0, y: 0 }, data: { label: id, level: 1 } };
}

function setup(nodes: MindmapRFNode[], edges: MindmapRFEdge[]) {
  // latest 用可变引用：测试模拟"编辑后 getLatest 返回新态"
  const latest = { nodes, edges };
  const setNodes = vi.fn();
  const setEdges = vi.fn();
  const markDirty = vi.fn();
  const { result } = renderHook(() =>
    useUndoRedo({ getLatest: () => latest, setNodes, setEdges, markDirty }),
  );
  return { result, setNodes, setEdges, markDirty, latest };
}

describe('useUndoRedo', () => {
  it('初始 canUndo/canRedo 均为 false', () => {
    const { result } = setup([node('a')], []);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it('takeSnapshot 后 canUndo=true、canRedo=false', () => {
    const { result } = setup([node('a')], []);
    act(() => result.current.takeSnapshot());
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it('undo 恢复快照 + 触发 setNodes/setEdges/markDirty', () => {
    const { result, setNodes, setEdges, markDirty, latest } = setup([node('a')], []);
    act(() => result.current.takeSnapshot()); // 记录 [a]
    // 模拟编辑：latest 变为 [a,b]
    latest.nodes = [node('a'), node('b')];
    act(() => result.current.undo());
    // setNodes 收到恢复的 [a]
    expect(setNodes).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'a' })]));
    expect(setNodes.mock.calls[0][0]).toHaveLength(1);
    expect(setEdges).toHaveBeenCalled();
    expect(markDirty).toHaveBeenCalled();
    expect(result.current.canRedo).toBe(true);
    expect(result.current.canUndo).toBe(false);
  });

  it('redo 恢复到撤销前状态', () => {
    const { result, latest } = setup([node('a')], []);
    act(() => result.current.takeSnapshot()); // 记录 [a]
    latest.nodes = [node('a'), node('b'), node('c')];
    act(() => result.current.undo()); // 恢复 [a]，redo 栈 = [[a,b,c]]
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.redo());
    // redo 恢复 [a,b,c]
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it('undo 后再 takeSnapshot 清空 future（新分支丢弃 redo 链）', () => {
    const { result } = setup([node('a')], []);
    act(() => result.current.takeSnapshot());
    act(() => result.current.undo());
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.takeSnapshot()); // 新快照清 future
    expect(result.current.canRedo).toBe(false);
  });

  it('空栈 undo/redo 不触发副作用', () => {
    const { result, setNodes } = setup([node('a')], []);
    act(() => result.current.undo());
    act(() => result.current.redo());
    expect(setNodes).not.toHaveBeenCalled();
  });
});
