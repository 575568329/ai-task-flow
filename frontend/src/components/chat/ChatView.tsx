// frontend/src/components/chat/ChatView.tsx
// 资料调研主视图:会话列表 + 消息流 + 输入区 + 流式驱动(streamChat → chatStore)。
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Plus, Send, Trash2, Settings2, Loader2, Globe } from 'lucide-react';
import type { ChatMessage, ChatRole, Source } from '@ai-task-flow/shared';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/Toaster';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chatStore';
import {
  getConversations,
  createConversation,
  deleteConversation,
  getMessages,
} from '@/api/chat';
import { streamChat } from '@/api/chatStream';
import { MessageContent } from './MessageContent';
import { SourceList } from './SourceList';
import { CustomPromptPanel } from './CustomPromptPanel';

interface MessageBubbleProps {
  role: ChatRole;
  content: string;
  sources?: Source[];
  streaming?: boolean;
  progressSteps?: string[];
}

function MessageBubble({
  role,
  content,
  sources,
  streaming,
  progressSteps,
}: MessageBubbleProps) {
  const isUser = role === 'user';
  return (
    <div className={cn('mb-4 flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-lg px-3 py-2',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
        )}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap text-sm">{content}</div>
        ) : content ? (
          <MessageContent content={content} />
        ) : (
          <div className="text-muted-foreground text-xs">思考中…</div>
        )}

        {streaming && progressSteps && progressSteps.length > 0 && (
          <div className="mt-2 flex flex-col gap-0.5 text-[10px] opacity-70">
            {progressSteps.map((step, index) => (
              <div key={index}>• {step}</div>
            ))}
          </div>
        )}

        {!isUser && sources && sources.length > 0 && !streaming && (
          <SourceList sources={sources} />
        )}
      </div>
    </div>
  );
}

export function ChatView() {
  const conversations = useChatStore((s) => s.conversations);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const currentAssistantMessage = useChatStore((s) => s.currentAssistantMessage);
  const currentSources = useChatStore((s) => s.currentSources);
  const progressSteps = useChatStore((s) => s.progressSteps);

  const setConversations = useChatStore((s) => s.setConversations);
  const setCurrentConversation = useChatStore((s) => s.setCurrentConversation);
  const setMessages = useChatStore((s) => s.setMessages);
  const startStreaming = useChatStore((s) => s.startStreaming);
  const appendDelta = useChatStore((s) => s.appendDelta);
  const setSources = useChatStore((s) => s.setSources);
  const addProgressStep = useChatStore((s) => s.addProgressStep);
  const finishStreaming = useChatStore((s) => s.finishStreaming);
  const resetStream = useChatStore((s) => s.resetStream);

  const [input, setInput] = useState('');
  const [useWebSearch, setUseWebSearch] = useState(true);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptConvId, setPromptConvId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 加载会话列表
  useEffect(() => {
    getConversations()
      .then(setConversations)
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : '加载会话失败')
      );
  }, [setConversations]);

  // 切换会话 → 加载消息
  useEffect(() => {
    if (!currentConversationId) {
      setMessages([]);
      return;
    }
    getMessages(currentConversationId)
      .then(setMessages)
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : '加载消息失败')
      );
  }, [currentConversationId, setMessages]);

  // 新消息/流式增量 → 滚到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentAssistantMessage, progressSteps]);

  const onNewConversation = () => {
    setCurrentConversation(null);
    setMessages([]);
    setInput('');
  };

  const onDeleteConversation = async (id: string) => {
    if (!window.confirm('删除该对话?消息将一并删除。')) return;
    try {
      await deleteConversation(id);
      const remaining = conversations.filter((c) => c.id !== id);
      setConversations(remaining);
      if (currentConversationId === id) {
        setCurrentConversation(remaining[0]?.id ?? null);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败');
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput('');

    let conversationId = currentConversationId;
    try {
      // 无当前会话则先创建(标题取前 24 字)
      if (!conversationId) {
        const conversation = await createConversation(text.slice(0, 24) || '新对话');
        conversationId = conversation.id;
        setConversations([conversation, ...conversations]);
        setCurrentConversation(conversation.id);
      }

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        conversationId,
        role: 'user',
        content: text,
        createdAt: new Date().toISOString(),
      };
      setMessages([...messages, userMessage]);
      startStreaming();

      for await (const event of streamChat({
        conversationId,
        message: text,
        useWebSearch,
      })) {
        switch (event.type) {
          case 'progress':
            addProgressStep(event.output);
            break;
          case 'source':
            setSources(event.sources);
            break;
          case 'text-delta':
            appendDelta(event.delta);
            break;
          case 'done':
            finishStreaming(event.messageId);
            break;
          case 'error':
            throw new Error(event.message);
        }
      }
    } catch (error) {
      resetStream();
      toast.error(error instanceof Error ? error.message : '发送失败');
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex h-full">
      {/* 左:会话列表 */}
      <aside className="bg-muted/30 flex w-60 shrink-0 flex-col border-r">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">会话</span>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={onNewConversation}
            aria-label="新建会话"
          >
            <Plus className="size-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5">
          {conversations.length === 0 && (
            <div className="text-muted-foreground p-2 text-xs">点击 + 新建对话</div>
          )}
          {conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={cn(
                'group flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5',
                conversation.id === currentConversationId
                  ? 'bg-accent'
                  : 'hover:bg-accent/50'
              )}
              onClick={() => setCurrentConversation(conversation.id)}
            >
              {conversation.customPrompt && (
                <span className="bg-primary size-1.5 shrink-0 rounded-full" />
              )}
              <span className="flex-1 truncate text-sm">
                {conversation.title || '新对话'}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="size-6 opacity-0 group-hover:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  setPromptConvId(conversation.id);
                  setPromptOpen(true);
                }}
                aria-label="自定义需求"
              >
                <Settings2 className="size-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive size-6 opacity-0 group-hover:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  void onDeleteConversation(conversation.id);
                }}
                aria-label="删除会话"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </aside>

      {/* 右:消息流 + 输入 */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {messages.length === 0 && !isStreaming && (
            <div className="text-muted-foreground mt-10 text-center text-sm">
              输入问题开始调研…
            </div>
          )}
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              role={message.role}
              content={message.content}
              sources={message.sources}
            />
          ))}
          {isStreaming && (
            <MessageBubble
              role="assistant"
              content={currentAssistantMessage}
              sources={currentSources}
              streaming
              progressSteps={progressSteps}
            />
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="border-t p-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="输入问题,Enter 发送,Shift+Enter 换行"
              className="max-h-40 min-h-10 resize-none"
            />
            <Button
              size="icon"
              onClick={() => void send()}
              disabled={isStreaming || !input.trim()}
              aria-label="发送"
            >
              {isStreaming ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </Button>
          </div>
          <label className="mt-1.5 flex items-center gap-2 text-xs">
            <Switch checked={useWebSearch} onCheckedChange={setUseWebSearch} />
            <span className="text-muted-foreground flex items-center gap-1">
              <Globe className="size-3" />
              联网搜索
            </span>
          </label>
        </div>
      </div>

      <CustomPromptPanel
        open={promptOpen}
        onOpenChange={setPromptOpen}
        conversationId={promptConvId}
      />
    </div>
  );
}
