// frontend/src/components/chat/ChatView.tsx
import React, { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Send, Square, Globe, Bot } from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';
import { getConversations, createConversation, deleteConversation, getMessages } from '../../api/chat';
import { streamChat } from '../../api/chatStream';
import type { ChatMessage } from '@ai-task-flow/shared';
import './ChatView.css';

/**
 * 调研聊天主视图
 * 严格遵循 Spark-design AI 对话页规范（Ai_chat.md）：
 * - 侧栏 240px / 对话区 max-w 800px
 * - 用户气泡右对齐主色，AI 左对齐
 * - 引用角标圆形上标
 * - 输入框圆角 12px，发送按钮圆形 32px
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
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
    startStreaming();

    try {
      for await (const event of streamChat({
        conversationId: currentConversationId,
        message: sentInput,
        useWebSearch,
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
          resetStream();
        }
      }
    } catch (error) {
      console.error('Stream failed:', error);
      resetStream();
    }
  };

  // 渲染引用角标（圆形上标，Spark Ai_chat.md 规范）
  const renderMessageContent = (content: string, sources?: ChatMessage['sources']) => {
    if (!sources || sources.length === 0) {
      return <div className="sp-msg-text">{content}</div>;
    }

    const citationRegex = /\[(\d+)\]/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = citationRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push(content.slice(lastIndex, match.index));
      }
      const num = parseInt(match[1]);
      const source = sources[num - 1];
      if (source) {
        parts.push(
          <sup
            key={match.index}
            className="sp-citation"
            title={source.title}
            onClick={() => window.open(source.url, '_blank')}
          >
            {num}
          </sup>
        );
      }
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < content.length) {
      parts.push(content.slice(lastIndex));
    }

    return <div className="sp-msg-text">{parts}</div>;
  };

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
                  handleDeleteConversation(conv.id);
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
                        {msg.sources && msg.sources.length > 0 && (
                          <span className="sp-source-tag">{msg.sources.length} 篇内容来源 ›</span>
                        )}
                      </div>
                    )}
                    <div className={`sp-bubble ${msg.role}`}>
                      {renderMessageContent(msg.content, msg.sources)}
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
                      {currentSources.length > 0 && (
                        <span className="sp-source-tag">{currentSources.length} 篇内容来源 ›</span>
                      )}
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
                      {renderMessageContent(currentAssistantMessage, currentSources)}
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
    </div>
  );
};
