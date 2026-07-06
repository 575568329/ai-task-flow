// frontend/src/components/views/ChatView.tsx
// 资料调研视图入口:挂载 chat/ChatView(会话列表 + 消息流 + 输入 + 流式驱动)。
import { ChatView as ChatPanel } from '@/components/chat/ChatView';

export function ChatView() {
  return <ChatPanel />;
}
