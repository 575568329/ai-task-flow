// backend/src/interfaces/http/routes/llmConfigRoutes.ts
import type { FastifyInstance } from 'fastify';
import type { LlmConfigService } from '../../../application/llm-config/LlmConfigService.js';

interface SaveLlmConfigBody {
  baseURL: string;
  apiKey: string;
  model: string;
}

/**
 * LLM 配置 REST API
 * - GET  /api/llm-config  获取当前配置（apiKey 脱敏）
 * - PUT  /api/llm-config  保存配置，立即生效
 */
export async function registerLlmConfigRoutes(
  fastify: FastifyInstance,
  llmConfigService: LlmConfigService,
) {
  // GET /api/llm-config - 获取当前 LLM 配置（脱敏）
  fastify.get('/api/llm-config', async () => {
    return llmConfigService.getMaskedConfig();
  });

  // PUT /api/llm-config - 保存 LLM 配置
  fastify.put<{ Body: SaveLlmConfigBody }>('/api/llm-config', async (request, reply) => {
    const { baseURL, apiKey, model } = request.body;

    // 基本校验
    if (!baseURL || !model) {
      return reply.status(400).send({ error: 'baseURL 和 model 不能为空' });
    }

    // URL 格式校验
    try {
      new URL(baseURL);
    } catch {
      return reply.status(400).send({ error: 'baseURL 格式无效' });
    }

    const result = await llmConfigService.saveConfig({ baseURL, apiKey, model });
    return result;
  });
}
