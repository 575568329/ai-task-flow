// backend/src/domain/research/entities/Conversation.ts
import type { Conversation as ConversationDTO } from '@ai-task-flow/shared';

export class Conversation {
  constructor(
    public readonly id: string,
    public title: string,
    public readonly createdAt: Date,
    public updatedAt: Date,
    /** 该对话的自定义需求,拼入 systemPrompt,每轮都生效 */
    public customPrompt: string = '',
  ) {}

  static create(title: string): Conversation {
    const now = new Date();
    const id = crypto.randomUUID();
    return new Conversation(id, title, now, now);
  }

  updateTitle(newTitle: string): void {
    this.title = newTitle;
    this.updatedAt = new Date();
  }

  /** 更新自定义需求(空串表示清空) */
  updateCustomPrompt(prompt: string): void {
    this.customPrompt = prompt;
    this.updatedAt = new Date();
  }

  toJSON(): ConversationDTO {
    return {
      id: this.id,
      title: this.title,
      customPrompt: this.customPrompt || undefined,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }

  static fromJSON(dto: ConversationDTO): Conversation {
    return new Conversation(
      dto.id,
      dto.title,
      new Date(dto.createdAt),
      new Date(dto.updatedAt),
      dto.customPrompt ?? '',
    );
  }
}
