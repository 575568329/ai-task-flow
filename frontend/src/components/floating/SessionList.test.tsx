import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import { SessionList } from './SessionList';
import type { ProjectSessionSummary } from '@ai-task-flow/shared';

// lucide-react 被 npm hoist 到根 → 解析到根 react 18,与 frontend react 19 双实例("older version
// of React")。vitest.config.ts 的 react alias 对 externalize 的 node_modules 包不完全生效,故 stub。
// 产品构建 vite dedupe 生效不受影响。
vi.mock('lucide-react', () => ({ Plus: () => null, RefreshCw: () => null }));

// 文件级 cleanup(同 MessageStream.test),每个用例后清 DOM 避免累积
afterEach(cleanup);

const winSession = (id: string): ProjectSessionSummary => ({
  sessionId: id,
  title: `标题-${id}`,
  lastActiveAt: '2026-07-25T10:00:00.000Z',
  messageCount: 3,
  source: 'windows',
});
const wslSession = (id: string): ProjectSessionSummary => ({
  sessionId: id,
  title: `标题-${id}`,
  lastActiveAt: '2026-07-25T10:00:00.000Z',
  messageCount: 5,
  source: 'wsl',
  taskTitle: '某任务',
});

describe('SessionList', () => {
  it('渲染会话标题与来源色标(Win/WSL)', () => {
    render(<SessionList sessions={[winSession('1'), wslSession('2')]} onSelect={() => {}} onNew={() => {}} onRefresh={() => {}} />);
    expect(screen.getByText('标题-1')).toBeInTheDocument();
    expect(screen.getByText('标题-2')).toBeInTheDocument();
    // Win badge:新建按钮也含"Win"文本,用 within 限定到会话项内精确断言
    expect(within(screen.getByText('标题-1').closest('button')!).getByText('Win')).toBeInTheDocument();
    expect(within(screen.getByText('标题-2').closest('button')!).getByText('WSL')).toBeInTheDocument();
  });

  it('点击会话项触发 onSelect(id, source)', () => {
    const onSelect = vi.fn();
    render(<SessionList sessions={[wslSession('2')]} onSelect={onSelect} onNew={() => {}} onRefresh={() => {}} />);
    fireEvent.click(screen.getByText('标题-2'));
    expect(onSelect).toHaveBeenCalledWith('2', 'wsl');
  });

  it('点击新建触发 onNew', () => {
    const onNew = vi.fn();
    render(<SessionList sessions={[]} onSelect={() => {}} onNew={onNew} onRefresh={() => {}} />);
    fireEvent.click(screen.getByLabelText('新建 Windows 侧对话'));
    expect(onNew).toHaveBeenCalledWith('windows');
  });

  it('loading 时显示加载中,空时显示暂无历史', () => {
    const { rerender } = render(<SessionList sessions={[]} loading onSelect={() => {}} onNew={() => {}} onRefresh={() => {}} />);
    expect(screen.getByText('加载中…')).toBeInTheDocument();
    rerender(<SessionList sessions={[]} onSelect={() => {}} onNew={() => {}} onRefresh={() => {}} />);
    expect(screen.getByText('暂无历史会话')).toBeInTheDocument();
  });

  it('activeSessionId 对应项标记 data-active', () => {
    render(
      <SessionList
        sessions={[winSession('1'), winSession('2')]}
        activeSessionId="2"
        onSelect={() => {}}
        onNew={() => {}} onRefresh={() => {}}
      />,
    );
    const active = screen.getByText('标题-2').closest('button');
    expect(active).toHaveAttribute('data-active', 'true');
  });
});
