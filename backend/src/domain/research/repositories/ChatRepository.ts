// backend/src/domain/research/repositories/ChatRepository.ts
import type { Conversation } from '../entities/Conversation.js';
import type { ChatMessage } from '../entities/ChatMessage.js';

export interface ChatRepository {
  // Conversation
  saveConversation(conversation: Conversation): Promise<void>;
  findConversationById(id: string): Promise<Conversation | null>;
  findAllConversations(): Promise<Conversation[]>;
  deleteConversation(id: string): Promise<void>;

  // ChatMessage
  saveMessage(message: ChatMessage): Promise<void>;
  findMessageById(id: string): Promise<ChatMessage | null>;
  findMessagesByConversationId(conversationId: string): Promise<ChatMessage[]>;
  deleteMessagesByConversationId(conversationId: string): Promise<void>;
}
