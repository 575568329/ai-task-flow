// backend/src/interfaces/http/routes/sseRoutes.ts
import { FastifyInstance, FastifyReply } from 'fastify';
import { EventBus } from '../../../infrastructure/pubsub/EventBus.js';

export async function registerSSERoutes(
  fastify: FastifyInstance,
  eventBus: EventBus
) {
  // GET /api/events - SSE 事件流
  fastify.get('/api/events', async (request, reply) => {
    // 设置 SSE 响应头
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // 发送初始连接事件
    reply.raw.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);

    // 订阅所有领域事件
    const unsubscribe = eventBus.subscribeAll((event) => {
      // 将领域事件转换为 SSE 格式
      const sseData = JSON.stringify({
        type: event.eventType,
        aggregateId: event.aggregateId,
        eventId: event.eventId,
        occurredAt: event.occurredAt,
        payload: event,
      });

      reply.raw.write(`data: ${sseData}\n\n`);
    });

    // 心跳（每 30 秒）
    const heartbeatInterval = setInterval(() => {
      reply.raw.write(`: heartbeat\n\n`);
    }, 30000);

    // 客户端断开连接时清理
    request.raw.on('close', () => {
      clearInterval(heartbeatInterval);
      unsubscribe();
      reply.raw.end();
    });
  });
}
