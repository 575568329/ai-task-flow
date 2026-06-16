// backend/src/infrastructure/persistence/JsonChatRepository.ts
import fs from 'fs/promises';
import path from 'path';
import { injectable } from 'tsyringe';
import { chatFilePath } from '../../config/dataDir.js';
import type { ChatRepository } from '../../domain/research/repositories/ChatRepository.js';
import { Conversation } from '../../domain/research/entities/Conversation.js';
import { ChatMessage } from '../../domain/research/entities/ChatMessage.js';
import type { ChatMessage as ChatMessageDTO, Conversation as ConversationDTO } from '@ai-task-flow/shared';

interface ChatStorageData {
  conversations: ConversationDTO[];
  messages: ChatMessageDTO[];
}

/**
 * JSON 文件存储的 Chat 仓储实现
 * 存储位置：~/.ai-task-flow/chats.json
 */
@injectable()
export class JsonChatRepository implements ChatRepository {
  private readonly filePath: string;

  constructor(customPath?: string) {
    // 走统一的 resolveDataDir(),与 tasks.json / events.jsonl 同目录,
    // 保证 --data-dir / AI_TASK_FLOW_DATA_DIR 改动时 chats.json 跟随、存储监控不漏扫。
    this.filePath = customPath ?? chatFilePath();
  }

  // Conversation
  async saveConversation(conversation: Conversation): Promise<void> {
    const data = await this.loadAll();
    const index = data.conversations.findIndex(c => c.id === conversation.id);

    if (index >= 0) {
      data.conversations[index] = conversation.toJSON();
    } else {
      data.conversations.push(conversation.toJSON());
    }

    await this.saveAll(data);
  }

  async findConversationById(id: string): Promise<Conversation | null> {
    const data = await this.loadAll();
    const dto = data.conversations.find(c => c.id === id);
    return dto ? Conversation.fromJSON(dto) : null;
  }

  async findAllConversations(): Promise<Conversation[]> {
    const data = await this.loadAll();
    return data.conversations.map(dto => Conversation.fromJSON(dto));
  }

  async deleteConversation(id: string): Promise<void> {
    const data = await this.loadAll();
    data.conversations = data.conversations.filter(c => c.id !== id);
    // 连带删除该会话所有消息
    data.messages = data.messages.filter(m => m.conversationId !== id);
    await this.saveAll(data);
  }

  // ChatMessage
  async saveMessage(message: ChatMessage): Promise<void> {
    const data = await this.loadAll();
    const index = data.messages.findIndex(m => m.id === message.id);

    if (index >= 0) {
      data.messages[index] = message.toJSON();
    } else {
      data.messages.push(message.toJSON());
    }

    await this.saveAll(data);
  }

  async findMessageById(id: string): Promise<ChatMessage | null> {
    const data = await this.loadAll();
    const dto = data.messages.find(m => m.id === id);
    return dto ? ChatMessage.fromJSON(dto) : null;
  }

  async findMessagesByConversationId(conversationId: string): Promise<ChatMessage[]> {
    const data = await this.loadAll();
    return data.messages
      .filter(m => m.conversationId === conversationId)
      .map(dto => ChatMessage.fromJSON(dto));
  }

  async deleteMessagesByConversationId(conversationId: string): Promise<void> {
    const data = await this.loadAll();
    data.messages = data.messages.filter(m => m.conversationId !== conversationId);
    await this.saveAll(data);
  }

  async deleteMessage(id: string): Promise<void> {
    const data = await this.loadAll();
    data.messages = data.messages.filter(m => m.id !== id);
    await this.saveAll(data);
  }

  // Private helpers
  private async loadAll(): Promise<ChatStorageData> {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const content = await fs.readFile(this.filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return { conversations: [], messages: [] };
      }
      throw error;
    }
  }

  private async saveAll(data: ChatStorageData): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2));
  }
}
