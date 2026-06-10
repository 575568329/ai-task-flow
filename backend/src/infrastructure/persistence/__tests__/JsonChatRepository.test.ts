// backend/src/infrastructure/persistence/__tests__/JsonChatRepository.test.ts
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JsonChatRepository } from '../JsonChatRepository.js';
import { Conversation } from '../../../domain/research/entities/Conversation.js';
import { ChatMessage } from '../../../domain/research/entities/ChatMessage.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('JsonChatRepository', () => {
  let repository: JsonChatRepository;
  let testFilePath: string;

  beforeEach(async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-repo-test-'));
    testFilePath = path.join(tmpDir, 'chats.json');
    repository = new JsonChatRepository(testFilePath);
  });

  afterEach(async () => {
    try {
      await fs.rm(path.dirname(testFilePath), { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('Conversation CRUD', () => {
    it('should save and find conversation', async () => {
      const conv = Conversation.create('Test Chat');
      await repository.saveConversation(conv);

      const found = await repository.findConversationById(conv.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(conv.id);
      expect(found!.title).toBe('Test Chat');
    });

    it('should list all conversations', async () => {
      const conv1 = Conversation.create('Chat 1');
      const conv2 = Conversation.create('Chat 2');
      await repository.saveConversation(conv1);
      await repository.saveConversation(conv2);

      const all = await repository.findAllConversations();
      expect(all).toHaveLength(2);
      expect(all.map(c => c.title)).toContain('Chat 1');
      expect(all.map(c => c.title)).toContain('Chat 2');
    });

    it('should update conversation title', async () => {
      const conv = Conversation.create('Old Title');
      await repository.saveConversation(conv);

      conv.updateTitle('New Title');
      await repository.saveConversation(conv);

      const found = await repository.findConversationById(conv.id);
      expect(found!.title).toBe('New Title');
    });

    it('should delete conversation', async () => {
      const conv = Conversation.create('To Delete');
      await repository.saveConversation(conv);

      await repository.deleteConversation(conv.id);

      const found = await repository.findConversationById(conv.id);
      expect(found).toBeNull();
    });
  });

  describe('Message CRUD', () => {
    it('should save and find message', async () => {
      const conv = Conversation.create('Test Chat');
      await repository.saveConversation(conv);

      const msg = ChatMessage.createUser(conv.id, 'Hello');
      await repository.saveMessage(msg);

      const found = await repository.findMessageById(msg.id);
      expect(found).not.toBeNull();
      expect(found!.content).toBe('Hello');
      expect(found!.role).toBe('user');
    });

    it('should find messages by conversation', async () => {
      const conv = Conversation.create('Test Chat');
      await repository.saveConversation(conv);

      const msg1 = ChatMessage.createUser(conv.id, 'Q1');
      const msg2 = ChatMessage.createAssistant(conv.id, 'A1', []);
      await repository.saveMessage(msg1);
      await repository.saveMessage(msg2);

      const messages = await repository.findMessagesByConversationId(conv.id);
      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe('Q1');
      expect(messages[1].content).toBe('A1');
    });

    it('should delete conversation with messages', async () => {
      const conv = Conversation.create('Test Chat');
      await repository.saveConversation(conv);

      const msg = ChatMessage.createUser(conv.id, 'Test');
      await repository.saveMessage(msg);

      await repository.deleteConversation(conv.id);

      const messages = await repository.findMessagesByConversationId(conv.id);
      expect(messages).toHaveLength(0);
    });

    it('should save assistant message with sources', async () => {
      const conv = Conversation.create('Test Chat');
      await repository.saveConversation(conv);

      const msg = ChatMessage.createAssistant(conv.id, 'Answer with [1] citation', [
        {
          index: 1,
          title: 'Test Paper',
          url: 'https://arxiv.org/abs/1234',
          snippet: 'Abstract...',
          sourceType: 'arxiv',
        },
      ]);
      await repository.saveMessage(msg);

      const found = await repository.findMessageById(msg.id);
      expect(found!.sources).toHaveLength(1);
      expect(found!.sources[0].title).toBe('Test Paper');
    });
  });
});
