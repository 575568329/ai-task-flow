// frontend/src/components/chat/ChatView.tsx
import React, { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Send, Square, Globe, Bot, Copy, RefreshCw, Check } from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';
import {
  getConversations,
  createConversation,
  deleteConversation,
  getMessages,
  updateConversation,
} from '../../api/chat';
import { streamChat } from '../../api/chatStream';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import type { ChatMessage } from '@ai-task-flow/shared';
import { toast } from '../ui/Toaster';
import { MessageContent } from './MessageContent';
import { SourceList } from './SourceList';
import { CustomPromptPanel } from './CustomPromptPanel';
import './ChatView.css';

/**
 * 调研聊天主视图
 * - 富文本(Markdown)渲染 + 可点引用角标
 * - assistant 消息工具栏:复制 / 重新回答
 * - 侧边自定义需求面板(每对话独立,每轮生效)
 */
export const ChatView: React.FC = () => {
  const {
    conversations,
    currentConversationId,
    messages,
    isStreaming,
    currentAssistantMessage,
    currentSources,
    progressSteps,
    setConversations,
    setCurrentConversation,
    setMessages,
    patchConversation,
    removeLastAssistantMessage,
    startStreaming,
    appendDelta,
    setSources,
    addProgressStep,
    finishStreaming,
    resetStream,
  } = useChatStore();

  const [userInput, setUserInput] = useState('');
  const [useWebSearch, setUseWebSearch] = useState(() => {
    return localStorage.getItem('chat-web-search') !== 'false';
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const currentConversation = conversations.find((c) => c.id === currentConversationId);

  // 初始化：加载会话列表
  useEffect(() => {
    getConversations().then(setConversations).catch(console.error);
  }, [setConversations]);

  // 切换会话时加载消息
  useEffect(() => {
    if (currentConversationId) {
      getMessages(currentConversationId).then(setMessages).catch(console.error);
    }
  }, [currentConversationId, setMessages]);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentAssistantMessage, progressSteps]);

  // 联网开关记忆
  useEffect(() => {
    localStorage.setItem('chat-web-search', String(useWebSearch));
  }, [useWebSearch]);

  const handleNewChat = async () => {
    const conv = await createConversation('新对话');
    setConversations([conv, ...conversations]);
    setCurrentConversation(conv.id);
    setMessages([]);
  };

  const handleDeleteConversation = async (id: string) => {
    await deleteConversation(id);
    setConversations(conversations.filter((c) => c.id !== id));
    if (currentConversationId === id) {
      setCurrentConversation(null);
      setMessages([]);
    }
  };

  // 删除会话二次确认
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  /** 保存当前会话的自定义需求 */
  const handleSaveCustomPrompt = async (prompt: string) => {
    if (!currentConversationId) return;
    try {
      await updateConversation(currentConversationId, { customPrompt: prompt });
      patchConversation(currentConversationId, { customPrompt: prompt });
      toast.success('自定义需求已保存');
    } catch (error) {
      toast.error('保存失败,请重试');
      throw error;
    }
  };

  /** 跑一轮流式对话(发送 or 重新回答) */
  const runStream = async (params: {
    message: string;
    regenerate?: boolean;
    /** 本轮失败时的回调(用于 regenerate 失败后恢复消息) */
    onFailure?: () => void;
  }) => {
    if (!currentConversationId) return;
    startStreaming();
    try {
      for await (const event of streamChat({
        conversationId: currentConversationId,
        message: params.message,
        useWebSearch,
        regenerate: params.regenerate,
      })) {
        if (event.type === 'progress') {
          addProgressStep(event.output);
        } else if (event.type === 'source') {
          setSources(event.sources);
        } else if (event.type === 'text-delta') {
          appendDelta(event.delta);
        } else if (event.type === 'done') {
          finishStreaming(event.messageId);
        } else if (event.type === 'error') {
          console.error('SSE error:', event.message);
          toast.error(event.message || '对话出错,请稍后重试');
          resetStream();
          params.onFailure?.();
        }
      }
    } catch (error) {
      console.error('Stream failed:', error);
      const msg = error instanceof Error ? error.message : '网络异常,请检查后端服务';
      toast.error(msg);
      resetStream();
      params.onFailure?.();
    }
  };

  const handleSend = async () => {
    if (!userInput.trim() || isStreaming || !currentConversationId) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId: currentConversationId,
      role: 'user',
      content: userInput,
      createdAt: new Date().toISOString(),
    };

    setMessages([...messages, userMessage]);
    const sentInput = userInput;
    setUserInput('');
    await runStream({ message: sentInput });
  };

  /** 重新回答:乐观移除最后一条 assistant,带最新自定义需求重新生成;
   *  失败时从后端重新拉取恢复(后端在新答成功前不会删旧答)。 */
  const handleRegenerate = async () => {
    if (isStreaming || !currentConversationId) return;
    const convId = currentConversationId;
    removeLastAssistantMessage();
    // message 字段在 regenerate 模式下后端会忽略(复用已存最后一条 user)
    await runStream({
      message: '',
      regenerate: true,
      onFailure: () => {
        // 后端未删旧答,重新拉取即可恢复界面与数据一致
        getMessages(convId).then(setMessages).catch(console.error);
      },
    });
  };

  /** 复制 assistant 正文 */
  const handleCopy = async (content: string, messageId: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(messageId);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      toast.error('复制失败');
    }
  };

  // 当前对话最后一条 assistant 消息 id(只有它能"重新回答")
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;

  return (
    <div className="sp-chat-layout">
      {/* 侧栏 240px */}
      <aside className="sp-sidebar">
        <div className="sp-sidebar-header">
          <button className="sp-new-chat-btn" onClick={handleNewChat}>
            <Plus size={18} strokeWidth={2} />
            <span>新对话</span>
          </button>
        </div>

        <div className="sp-conversation-list">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`sp-conversation-item ${currentConversationId === conv.id ? 'active' : ''}`}
              onClick={() => setCurrentConversation(conv.id)}
            >
              <span className="sp-conversation-title">{conv.title}</span>
              <button
                className="sp-conversation-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  setPendingDeleteId(conv.id);
                }}
              >
                <Trash2 size={14} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* 对话区 */}
      <main className="sp-chat-main">
        {currentConversationId ? (
          <>
            <div className="sp-message-area">
              <div className="sp-message-container">
                {messages.map((msg) => (
                  <div key={msg.id} className={`sp-message ${msg.role}`}>
                    {msg.role === 'assistant' && (
                      <div className="sp-ai-header">
                        <div className="sp-ai-avatar">
                          <Bot size={18} strokeWidth={2} />
                        </div>
                        <span className="sp-ai-name">调研助手</span>
                      </div>
                    )}
                    <div className={`sp-bubble ${msg.role}`}>
                      {msg.role === 'assistant' ? (
                        <>
                          <MessageContent content={msg.content} sources={msg.sources} />
                          <SourceList sources={msg.sources ?? []} />
                          {/* 工具栏:复制 / 重新回答 */}
                          <div className="sp-msg-toolbar">
                            <button
                              className="sp-msg-tool"
                              onClick={() => handleCopy(msg.content, msg.id)}
                              title="复制"
                            >
                              {copiedId === msg.id ? (
                                <Check size={15} strokeWidth={2} />
                              ) : (
                                <Copy size={15} strokeWidth={2} />
                              )}
                              <span>{copiedId === msg.id ? '已复制' : '复制'}</span>
                            </button>
                            {msg.id === lastAssistantId && (
                              <button
                                className="sp-msg-tool"
                                onClick={handleRegenerate}
                                disabled={isStreaming}
                                title="按最新自定义需求重新回答"
                              >
                                <RefreshCw size={15} strokeWidth={2} />
                                <span>重新回答</span>
                              </button>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="sp-msg-text">{msg.content}</div>
                      )}
                    </div>
                  </div>
                ))}

                {/* 流式中的 AI 消息 */}
                {isStreaming && (
                  <div className="sp-message assistant">
                    <div className="sp-ai-header">
                      <div className="sp-ai-avatar">
                        <Bot size={18} strokeWidth={2} />
                      </div>
                      <span className="sp-ai-name">调研助手</span>
                    </div>

                    {/* 思考过程区 */}
                    {progressSteps.length > 0 && (
                      <div className="sp-thinking">
                        {progressSteps.map((step, i) => (
                          <div key={i} className="sp-thinking-step">
                            {step}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="sp-bubble assistant">
                      {currentSources.length > 0 && (
                        <SourceList sources={currentSources} />
                      )}
                      <MessageContent content={currentAssistantMessage} sources={currentSources} />
                      <span className="sp-cursor" />
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* 底部输入框 */}
            <div className="sp-input-area">
              <div className="sp-input-box">
                <textarea
                  className="sp-textarea"
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="向我提问，开启联网检索获取带引用的资料…"
                  disabled={isStreaming}
                />
                <div className="sp-input-toolbar">
                  <button
                    className={`sp-tool-btn ${useWebSearch ? 'active' : ''}`}
                    onClick={() => setUseWebSearch(!useWebSearch)}
                  >
                    <Globe size={18} strokeWidth={2} />
                    <span>联网</span>
                  </button>

                  <button
                    className="sp-send-btn"
                    onClick={handleSend}
                    disabled={isStreaming || !userInput.trim()}
                  >
                    {isStreaming ? <Square size={16} strokeWidth={2} /> : <Send size={16} strokeWidth={2} />}
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="sp-empty-state">
            <Bot size={48} strokeWidth={1.5} />
            <p>选择或新建一个对话开始资料调研</p>
            <button className="sp-new-chat-btn" onClick={handleNewChat}>
              <Plus size={18} strokeWidth={2} />
              <span>新对话</span>
            </button>
          </div>
        )}
      </main>

      {/* 自定义需求面板(仅在选中会话时显示) */}
      {currentConversation && (
        <CustomPromptPanel
          key={currentConversation.id}
          value={currentConversation.customPrompt ?? ''}
          onSave={handleSaveCustomPrompt}
        />
      )}

      {/* 删除会话二次确认 */}
      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="删除对话"
        danger
        confirmText="删除"
        message="确定删除这个对话吗？该对话的所有消息将被清除，且无法恢复。"
        onConfirm={() => {
          if (pendingDeleteId) handleDeleteConversation(pendingDeleteId);
          setPendingDeleteId(null);
        }}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
};
