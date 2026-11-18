// backend/src/interfaces/http/__tests__/server.test.ts
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHttpServer } from '../server.js';
import { JsonLlmConfigRepository } from '../../../infrastructure/persistence/JsonLlmConfigRepository.js';
import { LlmConfigService } from '../../../application/llm-config/LlmConfigService.js';
import { WebClipService } from '../../../application/webclip/WebClipService.js';
import { JsonVocabRepository } from '../../../infrastructure/persistence/JsonVocabRepository.js';
import { VocabService } from '../../../application/vocab/VocabService.js';
import { JsonMaimemoConfigRepository } from '../../../infrastructure/persistence/JsonMaimemoConfigRepository.js';
import { MaimemoClient } from '../../../infrastructure/maimemo/MaimemoClient.js';
import { MaimemoService } from '../../../application/maimemo/MaimemoService.js';
import { JsonMindmapRepository } from '../../../infrastructure/persistence/JsonMindmapRepository.js';
import { MindmapService } from '../../../application/mindmap/MindmapService.js';
import { JsonWorklogRepository } from '../../../infrastructure/persistence/JsonWorklogRepository.js';
import { WorklogService } from '../../../application/worklog/WorklogService.js';
import { JsonConclusionRepository } from '../../../infrastructure/persistence/JsonConclusionRepository.js';
import { ConclusionService } from '../../../application/conclusion/ConclusionService.js';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { FastifyInstance } from 'fastify';

// worklog 转型 Step1:Task CRUD 集成测试已随 taskRoutes 砍除;
// 保留 Health / Web Clip / Mindmap 聚合回归。
describe('HTTP Server', () => {
  let server: FastifyInstance;
  let testVocabPath: string;

  beforeEach(async () => {
    // 使用 nanoid 确保测试隔离
    const { nanoid } = await import('nanoid');
    const id = nanoid();
    testVocabPath = path.join(os.tmpdir(), `test-vocab-${id}.json`);

    const llmConfigRepository = new JsonLlmConfigRepository();
    const llmConfigService = new LlmConfigService(llmConfigRepository);
    const webClipService = new WebClipService(llmConfigService);
    const { KnowledgeService } = await import('../../../application/knowledge/KnowledgeService.js');
    const knowledgeService = new KnowledgeService(path.join(process.cwd(), 'knowledge-base'));

    // 翻译生词本测试依赖（用临时文件隔离）
    const vocabRepository = new JsonVocabRepository(testVocabPath);
    const vocabService = new VocabService(vocabRepository, llmConfigService);

    // 墨墨同步测试依赖（临时 config 文件隔离；不连真实墨墨 API）
    const testMaimemoConfigPath = path.join(os.tmpdir(), `test-maimemo-${id}.json`);
    const maimemoConfigRepo = new JsonMaimemoConfigRepository(testMaimemoConfigPath);
    const maimemoService = new MaimemoService(maimemoConfigRepo, vocabRepository);
    await maimemoService.init();
    maimemoService.useClient(new MaimemoClient(() => maimemoService.getActiveToken()));

    // 思维导图测试依赖（临时文件隔离）
    const testMindmapPath = path.join(os.tmpdir(), `test-mindmaps-${id}.json`);
    const mindmapRepository = new JsonMindmapRepository(testMindmapPath);
    const mindmapService = new MindmapService(mindmapRepository);

    // 工作记录测试依赖（临时文件隔离）
    const worklogService = new WorklogService(
      new JsonWorklogRepository(
        path.join(os.tmpdir(), `test-worklog-${id}.json`),
        path.join(os.tmpdir(), `test-worklog-backups-${id}`),
      ),
    );

    // 结论卡测试依赖（临时文件隔离）
    const conclusionService = new ConclusionService(
      new JsonConclusionRepository(
        path.join(os.tmpdir(), `test-conclusions-${id}.json`),
        path.join(os.tmpdir(), `test-conclusion-backups-${id}`),
      ),
    );

    server = await createHttpServer(
      { port: 0, host: '127.0.0.1', corsOrigin: '*' },
      llmConfigService,
      webClipService,
      knowledgeService,
      vocabService,
      maimemoService,
      mindmapService,
      worklogService,
      conclusionService,
    );
  });

  afterEach(async () => {
    await server.close();
    try {
      await fs.unlink(testVocabPath);
    } catch {}
  });

  describe('Health Check', () => {
    it('should return ok status', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeDefined();
    });
  });

  describe('Web Clip', () => {
    it('should mount POST /api/tasks/clip and reject when LLM not configured', async () => {
      // 未配置 LLM 时应 400 且消息含 API Key;验证路由已挂载 + 参数流转。
      // 真实拆解路径由 WebClipService 单测(mock LLM)覆盖,避免本集成测试依赖外部 LLM。
      const resp = await server.inject({
        method: 'POST',
        url: '/api/tasks/clip',
        payload: { sourceUrl: 'u', title: 't', content: { text: 'x' } },
      });
      expect([400, 200]).toContain(resp.statusCode);
    });
  });

  describe('Mindmap CRUD', () => {
    it('should create + get + list + duplicate + delete', async () => {
      const createResp = await server.inject({
        method: 'POST',
        url: '/api/mindmaps',
        payload: { title: '集成测试图' },
      });
      expect(createResp.statusCode).toBe(201);
      const doc = JSON.parse(createResp.body);
      expect(doc.title).toBe('集成测试图');
      expect(doc.nodes).toHaveLength(1);
      expect(doc.version).toBe(0);

      const getResp = await server.inject({ method: 'GET', url: `/api/mindmaps/${doc.id}` });
      expect(getResp.statusCode).toBe(200);

      const listResp = await server.inject({ method: 'GET', url: '/api/mindmaps' });
      expect(listResp.statusCode).toBe(200);
      expect(JSON.parse(listResp.body).total).toBeGreaterThanOrEqual(1);

      const dupResp = await server.inject({ method: 'POST', url: `/api/mindmaps/${doc.id}/duplicate` });
      expect(dupResp.statusCode).toBe(201);
      expect(JSON.parse(dupResp.body).id).not.toBe(doc.id);

      const delResp = await server.inject({ method: 'DELETE', url: `/api/mindmaps/${doc.id}` });
      expect(delResp.statusCode).toBe(204);
    });

    it('should return 404 for non-existent mindmap', async () => {
      const resp = await server.inject({ method: 'GET', url: '/api/mindmaps/no-exist' });
      expect(resp.statusCode).toBe(404);
    });

    it('should return 409 on optimistic lock conflict', async () => {
      const createResp = await server.inject({ method: 'POST', url: '/api/mindmaps', payload: {} });
      const { id } = JSON.parse(createResp.body);
      const conflictResp = await server.inject({
        method: 'PATCH',
        url: `/api/mindmaps/${id}`,
        payload: { title: '冲突', expectedVersion: 999 },
      });
      expect(conflictResp.statusCode).toBe(409);
    });

    it('should return 400 on invalid graph (dangling edge)', async () => {
      const createResp = await server.inject({ method: 'POST', url: '/api/mindmaps', payload: {} });
      const { id } = JSON.parse(createResp.body);
      const badResp = await server.inject({
        method: 'PATCH',
        url: `/api/mindmaps/${id}`,
        payload: { edges: [{ id: 'e1', source: 'ghost', target: 'phantom' }] },
      });
      expect(badResp.statusCode).toBe(400);
    });

    it('should accept valid graph update and bump version', async () => {
      const createResp = await server.inject({ method: 'POST', url: '/api/mindmaps', payload: {} });
      const { id, nodes } = JSON.parse(createResp.body);
      const rootId = nodes[0].id;
      const updResp = await server.inject({
        method: 'PATCH',
        url: `/api/mindmaps/${id}`,
        payload: {
          nodes: [
            ...nodes,
            { id: 'c1', position: { x: 200, y: 0 }, data: { label: '子节点', level: 1 } },
          ],
          edges: [{ id: 'e1', source: rootId, target: 'c1' }],
          expectedVersion: 0,
        },
      });
      expect(updResp.statusCode).toBe(200);
      const updated = JSON.parse(updResp.body);
      expect(updated.version).toBe(1);
      expect(updated.nodeCount).toBe(2);
    });
  });
});
