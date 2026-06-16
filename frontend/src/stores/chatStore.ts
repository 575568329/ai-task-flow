// frontend/src/stores/chatStore.ts
import { create } from 'zustand';
import type { Conversation, ChatMessage, Source } from '@ai-task-flow/shared';

interface ChatState {
  // 会话列表
  conversations: Conversation[];
  currentConversationId: string | null;

  // 当前会话消息
  messages: ChatMessage[];

  // 流式状态
  isStreaming: boolean;
  currentAssistantMessage: string; // 流式累积中的 assistant 消息
  currentSources: Source[];
  progressSteps: string[]; // 进度文案数组

  // Actions
  setConversations: (conversations: Conversation[]) => void;
  setCurrentConversation: (id: string | null) => void;
  setMessages: (messages: ChatMessage[]) => void;
  /** 本地更新某会话字段(如 customPrompt/title),与后端保存并行 */
  patchConversation: (id: string, patch: Partial<Conversation>) => void;
  /** 移除当前会话最后一条 assistant 消息(用于重新回答) */
  removeLastAssistantMessage: () => void;

  // 流式控制
  startStreaming: () => void;
  appendDelta: (delta: string) => void;
  setSources: (sources: Source[]) => void;
  addProgressStep: (step: string) => void;
  finishStreaming: (messageId: string) => void;
  resetStream: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  conversations: [],
  currentConversationId: null,
  messages: [],
  isStreaming: false,
  currentAssistantMessage: '',
  currentSources: [],
  progressSteps: [],

  setConversations: (conversations) => set({ conversations }),
  setCurrentConversation: (id) => set({ currentConversationId: id }),
  setMessages: (messages) => set({ messages }),

  patchConversation: (id, patch) => set((state) => ({
    conversations: state.conversations.map((c) =>
      c.id === id ? { ...c, ...patch } : c,
    ),
  })),

  removeLastAssistantMessage: () => set((state) => {
    const lastAssistantIndex = [...state.messages]
      .map((m) => m.role)
      .lastIndexOf('assistant');
    if (lastAssistantIndex === -1) return {};
    return {
      messages: state.messages.filter((_, i) => i !== lastAssistantIndex),
    };
  }),

  startStreaming: () => set({
    isStreaming: true,
    currentAssistantMessage: '',
    currentSources: [],
    progressSteps: [],
  }),

  appendDelta: (delta) => set((state) => ({
    currentAssistantMessage: state.currentAssistantMessage + delta,
  })),

  setSources: (sources) => set({ currentSources: sources }),

  addProgressStep: (step) => set((state) => ({
    progressSteps: [...state.progressSteps, step],
  })),

  finishStreaming: (messageId) => set((state) => ({
    isStreaming: false,
    messages: [
      ...state.messages,
      {
        id: messageId,
        conversationId: state.currentConversationId!,
        role: 'assistant' as const,
        content: state.currentAssistantMessage,
        sources: state.currentSources.length > 0 ? state.currentSources : undefined,
        status: 'completed' as const,
        createdAt: new Date().toISOString(),
      },
    ],
  })),

  resetStream: () => set({
    isStreaming: false,
    currentAssistantMessage: '',
    currentSources: [],
    progressSteps: [],
  }),
}));
