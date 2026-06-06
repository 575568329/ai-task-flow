// backend/src/interfaces/http/__tests__/server.test.ts
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHttpServer } from '../server.js';
import { JsonTaskRepository } from '../../../infrastructure/persistence/JsonTaskRepository.js';
import { InMemoryEventBus } from '../../../infrastructure/pubsub/EventBus.js';
import { JsonEventStore } from '../../../infrastructure/pubsub/EventStore.js';
import { WorktreeManager } from '../../../infrastructure/git/WorktreeManager.js';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { FastifyInstance } from 'fastify';

describe('HTTP Server', () => {
  let server: FastifyInstance;
  let testFilePath: string;
  let testEventsPath: string;
  let taskRepository: JsonTaskRepository;
  let eventBus: InMemoryEventBus;

  beforeEach(async () => {
    // 使用 nanoid 确保测试隔离
    const { nanoid } = await import('nanoid');
    const id = nanoid();
    testFilePath = path.join(os.tmpdir(), `test-tasks-${id}.json`);
    testEventsPath = path.join(os.tmpdir(), `test-events-${id}.jsonl`);

    eventBus = new InMemoryEventBus();
    const eventStore = new JsonEventStore(testEventsPath);
    taskRepository = new JsonTaskRepository(testFilePath, eventBus, eventStore);

    server = await createHttpServer(
      { port: 0, host: '127.0.0.1', corsOrigin: '*' },
      taskRepository,
      eventBus,
      new WorktreeManager()
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
          status: 'dispatched',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.title).toBe('Updated title');
      expect(body.status).toBe('dispatched');
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

      // 更新一个任务状态
      await server.inject({
        method: 'PATCH',
        url: '/api/tasks/WS-001',
        payload: { status: 'dispatched' },
      });

      // 按状态查询
      const todoResponse = await server.inject({
        method: 'GET',
        url: '/api/tasks/status/todo',
      });

      const dispatchedResponse = await server.inject({
        method: 'GET',
        url: '/api/tasks/status/dispatched',
      });

      const todoTasks = JSON.parse(todoResponse.body);
      const dispatchedTasks = JSON.parse(dispatchedResponse.body);

      expect(todoTasks).toHaveLength(1);
      expect(todoTasks[0].id).toBe('WS-002');

      expect(dispatchedTasks).toHaveLength(1);
      expect(dispatchedTasks[0].id).toBe('WS-001');
    });
  });
});
