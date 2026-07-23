// backend/src/interfaces/http/routes/taskRoutes.ts
import { FastifyInstance } from 'fastify';
import { TaskRepository } from '../../../domain/workflow/repositories/TaskRepository.js';
import { TaskId } from '../../../domain/workflow/value-objects/TaskId.js';
import { Task } from '../../../domain/workflow/entities/Task.js';
import { TaskStatus } from '../../../domain/workflow/value-objects/TaskStatus.js';
import { Priority } from '../../../domain/workflow/value-objects/Priority.js';
import type { CreateTaskRequest, UpdateTaskRequest } from '@ai-task-flow/shared';
import { buildTaskMarkdown, writeTaskDoc, removeTaskDoc } from '../../../infrastructure/persistence/taskDoc.js';
import { taskDocPath } from '../../../config/dataDir.js';

export async function registerTaskRoutes(
  fastify: FastifyInstance,
  taskRepository: TaskRepository,
) {
  /**
   * Task → DTO,补充 taskFilePath(markdown 存档的绝对路径)。
   * 前端据此生成执行指令,指向真实存在的文件,而非凭空拼路径。
   */
  const toDTO = (task: Task) => ({
    ...task.toJSON(),
    taskFilePath: taskDocPath(task.id.value),
  });

  // GET /api/tasks - 获取所有任务(可选 ?source=web|manual 过滤)
  fastify.get<{ Querystring: { source?: string } }>('/api/tasks', async (request) => {
    const tasks = await taskRepository.findAll();
    const { source } = request.query;
    const filtered = source ? tasks.filter((t) => t.source === source) : tasks;
    return filtered.map(toDTO);
  });

  // GET /api/tasks/:id - 获取单个任务
  fastify.get<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) => {
    const taskId = TaskId.fromString(request.params.id);
    const task = await taskRepository.findById(taskId);

    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    return toDTO(task);
  });

  // GET /api/tasks/status/:status - 按状态查询任务
  fastify.get<{ Params: { status: string } }>('/api/tasks/status/:status', async (request, reply) => {
    const status = request.params.status as TaskStatus;

    // 验证状态值(dispatched/review 已随派发/审查流移除)
    const validStatuses = ['planning', 'todo', 'done', 'blocked'];
    if (!validStatuses.includes(status)) {
      return reply.status(400).send({ error: 'Invalid status' });
    }

    const tasks = await taskRepository.findByStatus(status);
    return tasks.map(toDTO);
  });

  // POST /api/tasks - 创建任务
  fastify.post<{ Body: CreateTaskRequest }>('/api/tasks', async (request, reply) => {
    const { prefix, title, description, priority, repoPath, projectName, relatedFiles, steps, source, sourceUrl } = request.body;

    // prefix 容错:TaskId 要求 [A-Z][A-Z0-9]* 格式(如 WS/BUG/E2E)。
    // 留空或非法时回落到默认 TASK,实现"前缀非必填"。
    const normalizedPrefix = /^[A-Z][A-Z0-9]*$/.test(prefix ?? '') ? prefix : 'TASK';

    // 生成 ID（简化版：查询最大序号 + 1）
    const allTasks = await taskRepository.findAll();
    const maxSeq = allTasks
      .filter(t => t.id.prefix === normalizedPrefix)
      .map(t => t.id.sequence)
      .reduce((max, seq) => Math.max(max, seq), 0);

    const task = new Task(
      TaskId.create(normalizedPrefix, maxSeq + 1),
      title,
      description,
      TaskStatus.TODO,
      priority || Priority.P1,
      repoPath,
      projectName,
      relatedFiles || [],
      steps || [],
      undefined,        // worktree
      undefined,        // executionResult
      new Date(),       // createdAt
      new Date(),       // updatedAt
      source ?? 'manual',
      sourceUrl,
    );

    await taskRepository.save(task);

    // 落盘 markdown 存档(失败不阻断创建)
    try {
      await writeTaskDoc(task);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      fastify.log.warn(`Failed to write task doc for ${task.id.value}: ${message}`);
    }

    return reply.status(201).send(toDTO(task));
  });

  // PATCH /api/tasks/:id - 更新任务
  fastify.patch<{ Params: { id: string }; Body: UpdateTaskRequest }>(
    '/api/tasks/:id',
    async (request, reply) => {
      const taskId = TaskId.fromString(request.params.id);
      const task = await taskRepository.findById(taskId);

      if (!task) {
        return reply.status(404).send({ error: 'Task not found' });
      }

      // 通过领域方法更新，发布 TaskUpdated 事件以驱动前端 SSE 实时刷新
      task.applyUpdate(request.body);

      await taskRepository.save(task);

      // 同步更新 markdown 存档(失败不阻断)
      try {
        await writeTaskDoc(task);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        fastify.log.warn(`Failed to update task doc for ${task.id.value}: ${message}`);
      }

      return toDTO(task);
    }
  );

  // DELETE /api/tasks/:id - 删除任务
  fastify.delete<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) => {
    const taskId = TaskId.fromString(request.params.id);
    const task = await taskRepository.findById(taskId);

    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    await taskRepository.delete(taskId);

    // 删除 markdown 存档(失败不阻断)
    try {
      await removeTaskDoc(taskId.value);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      fastify.log.warn(`Failed to remove task doc for ${taskId.value}: ${message}`);
    }

    return reply.status(204).send();
  });

  // GET /api/tasks/:id/markdown - 生成任务的 markdown 文本
  fastify.get<{ Params: { id: string } }>(
    '/api/tasks/:id/markdown',
    async (request, reply) => {
      const taskId = TaskId.fromString(request.params.id);
      const task = await taskRepository.findById(taskId);

      if (!task) {
        return reply.status(404).send({ error: 'Task not found' });
      }

      // 复用统一的 markdown 生成器,保证接口返回与落盘存档完全一致
      return { markdown: buildTaskMarkdown(task) };
    }
  );
}
