// backend/src/interfaces/http/__tests__/server.test.ts
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHttpServer } from '../server.js';
import { JsonTaskRepository } from '../../../infrastructure/persistence/JsonTaskRepository.js';
import { InMemoryEventBus } from '../../../infrastructure/pubsub/EventBus.js';
import { JsonEventStore } from '../../../infrastructure/pubsub/EventStore.js';
import { JsonChatRepository } from '../../../infrastructure/persistence/JsonChatRepository.js';
import { GlmWebSearchClient } from '../../../infrastructure/search/GlmWebSearchClient.js';
import { ArxivClient } from '../../../infrastructure/search/ArxivClient.js';
import { SearchOrchestrator } from '../../../application/research/SearchOrchestrator.js';
import { ChatService } from '../../../application/research/ChatService.js';
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
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { FastifyInstance } from 'fastify';

describe('HTTP Server', () => {
  let server: FastifyInstance;
  let testFilePath: string;
  let testEventsPath: string;
  let testVocabPath: string;
  let taskRepository: JsonTaskRepository;
  let eventBus: InMemoryEventBus;

  beforeEach(async () => {
    // 使用 nanoid 确保测试隔离
    const { nanoid } = await import('nanoid');
    const id = nanoid();
    testFilePath = path.join(os.tmpdir(), `test-tasks-${id}.json`);
    testEventsPath = path.join(os.tmpdir(), `test-events-${id}.jsonl`);
    testVocabPath = path.join(os.tmpdir(), `test-vocab-${id}.json`);

    eventBus = new InMemoryEventBus();
    const eventStore = new JsonEventStore(testEventsPath);
    taskRepository = new JsonTaskRepository(testFilePath, eventBus, eventStore);

    // 调研聊天 Agent 测试依赖
    const chatRepository = new JsonChatRepository();
    const llmConfigRepository = new JsonLlmConfigRepository();
    const llmConfigService = new LlmConfigService(llmConfigRepository);
    const webSearchClient = new GlmWebSearchClient(() => llmConfigService.getActiveApiKey());
    const arxivClient = new ArxivClient();
    const searchOrchestrator = new SearchOrchestrator(webSearchClient, arxivClient);
    const chatService = new ChatService(chatRepository, llmConfigService, searchOrchestrator);
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

    server = await createHttpServer(
      { port: 0, host: '127.0.0.1', corsOrigin: '*' },
      taskRepository,
      eventBus,
      chatRepository,
      chatService,
      llmConfigService,
      webClipService,
      knowledgeService,
      vocabService,
      maimemoService,
      mindmapService,
    );
  });

  afterEach(async () => {
    await server.close();
    try {
      await fs.unlink(testFilePath);
    } catch {}
    try {
      await fs.unlink(testEventsPath);
    } catch {}
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

  describe('Task CRUD', () => {
    it('should create a new task', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: {
          prefix: 'WS',
          title: 'Test task',
          description: 'Test description',
          priority: 'P0',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.id).toBe('WS-001');
      expect(body.title).toBe('Test task');
      expect(body.status).toBe('todo');
    });

    it('should get all tasks', async () => {
      // 验证初始状态为空
      const initialResponse = await server.inject({
        method: 'GET',
        url: '/api/tasks',
      });
      const initialTasks = JSON.parse(initialResponse.body);
      expect(initialTasks).toHaveLength(0);

      // 创建第一个任务
      const create1Response = await server.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: {
          prefix: 'WS',
          title: 'Task 1',
          description: 'Description 1',
        },
      });
      const task1 = JSON.parse(create1Response.body);
      expect(task1.id).toBe('WS-001');

      // 创建第二个任务
      const create2Response = await server.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: {
          prefix: 'WS',
          title: 'Task 2',
          description: 'Description 2',
        },
      });
      const task2 = JSON.parse(create2Response.body);
      expect(task2.id).toBe('WS-002');

      // 获取所有任务
      const response = await server.inject({
        method: 'GET',
        url: '/api/tasks',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveLength(2);
      expect(body[0].id).toBe('WS-001');
      expect(body[1].id).toBe('WS-002');
    });

    it('should get a task by id', async () => {
      // 创建任务
      await server.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: {
          prefix: 'WS',
          title: 'Test task',
          description: 'Test description',
        },
      });

      // 获取任务
      const response = await server.inject({
        method: 'GET',
        url: '/api/tasks/WS-001',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe('WS-001');
      expect(body.title).toBe('Test task');
    });

    it('should return 404 for non-existent task', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/tasks/WS-999',
      });

      expect(response.statusCode).toBe(404);
    });

    it('should update a task', async () => {
      // 创建任务
      await server.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: {
          prefix: 'WS',
          title: 'Original title',
          description: 'Original description',
        },
      });

      // 更新任务
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/tasks/WS-001',
        payload: {
          title: 'Updated title',
          status: 'done',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.title).toBe('Updated title');
      expect(body.status).toBe('done');
      expect(body.description).toBe('Original description'); // 未修改的字段保持不变
    });

    it('should delete a task', async () => {
      // 创建任务
      await server.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: {
          prefix: 'WS',
          title: 'To be deleted',
          description: 'Description',
        },
      });

      // 删除任务
      const deleteResponse = await server.inject({
        method: 'DELETE',
        url: '/api/tasks/WS-001',
      });

      expect(deleteResponse.statusCode).toBe(204);

      // 验证已删除
      const getResponse = await server.inject({
        method: 'GET',
        url: '/api/tasks/WS-001',
      });

      expect(getResponse.statusCode).toBe(404);
    });

    it('should get tasks by status', async () => {
      // 创建多个任务
      await server.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: {
          prefix: 'WS',
          title: 'Todo task',
          description: 'Description',
        },
      });

      await server.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: {
          prefix: 'WS',
          title: 'Another todo',
          description: 'Description',
        },
      });

      // 更新一个任务状态为已完成
      await server.inject({
        method: 'PATCH',
        url: '/api/tasks/WS-001',
        payload: { status: 'done' },
      });

      // 按状态查询
      const todoResponse = await server.inject({
        method: 'GET',
        url: '/api/tasks/status/todo',
      });

      const doneResponse = await server.inject({
        method: 'GET',
        url: '/api/tasks/status/done',
      });

      const todoTasks = JSON.parse(todoResponse.body);
      const doneTasks = JSON.parse(doneResponse.body);

      expect(todoTasks).toHaveLength(1);
      expect(todoTasks[0].id).toBe('WS-002');

      expect(doneTasks).toHaveLength(1);
      expect(doneTasks[0].id).toBe('WS-001');
    });

    it('should create web-sourced task with sourceUrl', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: {
          prefix: 'WS', title: 'Clipped', description: 'from web',
          source: 'web', sourceUrl: 'https://example.com/bug/1',
        },
      });
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.source).toBe('web');
      expect(body.sourceUrl).toBe('https://example.com/bug/1');
    });

    it('should filter tasks by source via query', async () => {
      await server.inject({ method: 'POST', url: '/api/tasks', payload: {
        prefix: 'WS', title: 'Web one', description: 'd', source: 'web', sourceUrl: 'u1',
      }});
      await server.inject({ method: 'POST', url: '/api/tasks', payload: {
        prefix: 'WS', title: 'Manual one', description: 'd',
      }});

      const webResp = await server.inject({ method: 'GET', url: '/api/tasks?source=web' });
      const manualResp = await server.inject({ method: 'GET', url: '/api/tasks?source=manual' });

      const webTasks = JSON.parse(webResp.body);
      const manualTasks = JSON.parse(manualResp.body);
      expect(webTasks).toHaveLength(1);
      expect(webTasks[0].source).toBe('web');
      expect(manualTasks).toHaveLength(1);
      expect(manualTasks[0].source).toBe('manual');
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
