// backend/src/interfaces/http/routes/chatRoutes.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ChatRepository } from '../../../domain/research/repositories/ChatRepository.js';
import { Conversation } from '../../../domain/research/entities/Conversation.js';
import { ChatService, type ChatRequest } from '../../../application/research/ChatService.js';
import type { SSEEvent } from '@ai-task-flow/shared';

export async function registerChatRoutes(
  fastify: FastifyInstance,
  chatRepository: ChatRepository,
  chatService: ChatService,
) {
  // GET /api/conversations - 会话列表
  fastify.get('/api/conversations', async (request, reply) => {
    const conversations = await chatRepository.findAllConversations();
    return conversations.map(c => c.toJSON());
  });

  // POST /api/conversations - 新建会话
  fastify.post<{ Body: { title?: string } }>('/api/conversations', async (request, reply) => {
    const { title = '新对话' } = request.body;
    const conversation = Conversation.create(title);
    await chatRepository.saveConversation(conversation);
    return conversation.toJSON();
  });

  // DELETE /api/conversations/:id - 删除会话
  fastify.delete<{ Params: { id: string } }>('/api/conversations/:id', async (request, reply) => {
    await chatRepository.deleteConversation(request.params.id);
    return reply.status(204).send();
  });

  // GET /api/conversations/:id/messages - 某会话消息
  fastify.get<{ Params: { id: string } }>('/api/conversations/:id/messages', async (request, reply) => {
    const messages = await chatRepository.findMessagesByConversationId(request.params.id);
    return messages.map(m => m.toJSON());
  });

  // POST /api/chat - 核心：检索+流式回答（SSE）
  fastify.post<{ Body: ChatRequest }>('/api/chat', async (request: FastifyRequest<{ Body: ChatRequest }>, reply: FastifyReply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    try {
      for await (const event of chatService.handleChat(request.body)) {
        // SSE 格式：data: {json}\n\n
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error: any) {
      const errorEvent: SSEEvent = {
        type: 'error',
        message: error.message || 'Internal server error',
      };
      reply.raw.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
    } finally {
      reply.raw.end();
    }
  });
}
