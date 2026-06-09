// backend/src/domain/research/entities/ChatMessage.ts
import type { ChatMessage as ChatMessageDTO, Source, ChatRole, MessageStatus } from '@ai-task-flow/shared';

export class ChatMessage {
  constructor(
    public readonly id: string,
    public readonly conversationId: string,
    public readonly role: ChatRole,
    public content: string,
    public sources: Source[],
    public status: MessageStatus | undefined,
    public readonly createdAt: Date,
  ) {}

  static createUser(conversationId: string, content: string): ChatMessage {
    return new ChatMessage(
      crypto.randomUUID(),
      conversationId,
      'user',
      content,
      [],
      undefined,
      new Date(),
    );
  }

  static createAssistant(conversationId: string, content: string, sources: Source[]): ChatMessage {
    return new ChatMessage(
      crypto.randomUUID(),
      conversationId,
      'assistant',
      content,
      sources,
      'completed',
      new Date(),
    );
  }

  updateContent(newContent: string): void {
    this.content = newContent;
  }

  updateStatus(newStatus: MessageStatus): void {
    this.status = newStatus;
  }

  toJSON(): ChatMessageDTO {
    return {
      id: this.id,
      conversationId: this.conversationId,
      role: this.role,
      content: this.content,
      sources: this.sources.length > 0 ? this.sources : undefined,
      status: this.status,
      createdAt: this.createdAt.toISOString(),
    };
  }

  static fromJSON(dto: ChatMessageDTO): ChatMessage {
    return new ChatMessage(
      dto.id,
      dto.conversationId,
      dto.role,
      dto.content,
      dto.sources || [],
      dto.status,
      new Date(dto.createdAt),
    );
  }
}
