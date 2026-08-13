import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { MessageStream } from './MessageStream';
import type { ChatTurn } from '@ai-task-flow/shared';

// MessageContent 依赖 react-markdown/remark/rehype,被 npm hoist 到根 → 解析到根 react 18,
// 与 frontend react 19 双实例("older version of React")。vitest.config.ts 的 react alias 对
// externalize 的 node_modules 包不完全生效,故仍 stub。产品构建 vite dedupe 生效不受影响。
vi.mock('@/components/chat/MessageContent', () => ({
  MessageContent: ({ content }: { content: string }) => <div>{content}</div>,
}));
// ContextMenuHost 依赖 radix（portal/focus），test 环境直接透传 children
vi.mock('@/components/context-menu/ContextMenuHost', () => ({
  ContextMenuHost: ({ children }: any) => children,
}));

// 文件级 cleanup(vitest 1.6.1 setupFiles 的 afterEach 跨文件不生效),每个用例后清 DOM
afterEach(cleanup);

const userTurn = (text: string): ChatTurn => ({ id: `u-${text}`, role: 'user', text });
const assistantTurn = (text: string): ChatTurn => ({
  id: `a-${text}`,
  role: 'assistant',
  blocks: [{ kind: 'text', text }],
});

describe('MessageStream', () => {
  it('空 turns 显示 emptyHint', () => {
    render(<MessageStream turns={[]} streaming={false} emptyHint={<div>暂无消息</div>} />);
    expect(screen.getByText('暂无消息')).toBeInTheDocument();
  });

  it('streaming 且末尾是用户消息时显示思考中占位', () => {
    render(<MessageStream turns={[userTurn('你好')]} streaming={true} />);
    expect(screen.getByText('思考中')).toBeInTheDocument();
  });

  it('显示 error 文本', () => {
    render(<MessageStream turns={[]} streaming={false} error="出错了" />);
    expect(screen.getByText('出错了')).toBeInTheDocument();
  });

  // TODO(测试环境): vitest + monorepo hoist 双 React 实例,ThinkingCard/ToolUseCard/Collapse
  //   内 lucide-react 图标触发 "older version of React"。同 skip 用例,产品构建不受影响。
  it.skip('assistant turn 含 tool_use 时渲染折叠按钮', () => {
    const turn: ChatTurn = {
      id: 'a-1',
      role: 'assistant',
      blocks: [
        { kind: 'thinking', thinking: 'thinking...' },
        { kind: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
      ],
    };
    render(<MessageStream turns={[turn]} streaming={false} />);
    expect(screen.getByText('1 个步骤')).toBeInTheDocument();
  });

  it.skip('多个过程块合并到一个折叠,text 块保持可见', () => {
    const turn: ChatTurn = {
      id: 'a-1',
      role: 'assistant',
      blocks: [
        { kind: 'text', text: '开始处理' },
        { kind: 'thinking', thinking: 'step 1' },
        { kind: 'tool_use', id: 't1', name: 'Bash', input: {} },
        { kind: 'text', text: '中间说明' },
        { kind: 'tool_use', id: 't2', name: 'Read', input: {} },
        { kind: 'text', text: '完成' },
      ],
    };
    render(<MessageStream turns={[turn]} streaming={false} />);
    // 步骤合并:2 个 tool_use → "2 个步骤"
    expect(screen.getByText('2 个步骤')).toBeInTheDocument();
    // text 在折叠外面,始终可见
    expect(screen.getByText('开始处理')).toBeInTheDocument();
    expect(screen.getByText('中间说明')).toBeInTheDocument();
    expect(screen.getByText('完成')).toBeInTheDocument();
  });

  // TODO(测试环境): vitest + monorepo hoist 双 React 实例 —— lucide-react(Copy 图标)被 hoist 到
  // 根 → 解析到根 react 18,footer 含 Copy 图标触发 "older version of React"。vitest.config.ts 的
  // react alias 对 externalize 包不完全生效。产品构建 vite dedupe 生效不受影响,待专项治理后启用。
  it.skip('非流式时点击复制全部触发 onCopyAll', () => {
    const onCopyAll = vi.fn();
    render(
      <MessageStream
        turns={[userTurn('问'), assistantTurn('答')]}
        streaming={false}
        onCopyAll={onCopyAll}
      />,
    );
    fireEvent.click(screen.getByText('复制全部'));
    expect(onCopyAll).toHaveBeenCalledOnce();
  });
});
