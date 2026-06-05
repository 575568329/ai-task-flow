// backend/src/interfaces/http/routes/taskRoutes.ts
import { FastifyInstance } from 'fastify';
import { TaskRepository } from '../../../domain/workflow/repositories/TaskRepository.js';
import { TaskId } from '../../../domain/workflow/value-objects/TaskId.js';
import { Task } from '../../../domain/workflow/entities/Task.js';
import { TaskStatus } from '../../../domain/workflow/value-objects/TaskStatus.js';
import { Priority } from '../../../domain/workflow/value-objects/Priority.js';

export async function registerTaskRoutes(
  fastify: FastifyInstance,
  taskRepository: TaskRepository
) {
  // GET /api/tasks - 获取所有任务
  fastify.get('/api/tasks', async (request, reply) => {
    const tasks = await taskRepository.findAll();
    return tasks.map(task => task.toJSON());
  });

  // GET /api/tasks/:id - 获取单个任务
  fastify.get<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) => {
    const taskId = TaskId.fromString(request.params.id);
    const task = await taskRepository.findById(taskId);

    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    return task.toJSON();
  });

  // GET /api/tasks/status/:status - 按状态查询任务
  fastify.get<{ Params: { status: string } }>('/api/tasks/status/:status', async (request, reply) => {
    const status = request.params.status as TaskStatus;

    // 验证状态值
    const validStatuses = ['planning', 'todo', 'dispatched', 'review', 'done', 'blocked'];
    if (!validStatuses.includes(status)) {
      return reply.status(400).send({ error: 'Invalid status' });
    }

    const tasks = await taskRepository.findByStatus(status);
    return tasks.map(task => task.toJSON());
  });

  // POST /api/tasks - 创建任务
  fastify.post<{
    Body: {
      prefix: string;
      title: string;
      description: string;
      priority?: Priority;
      projects?: string[];
      relatedFiles?: string[];
      acceptanceCriteria?: string[];
    };
  }>('/api/tasks', async (request, reply) => {
    const { prefix, title, description, priority, projects, relatedFiles, acceptanceCriteria } = request.body;

    // 生成 ID（简化版：查询最大序号 + 1）
    const allTasks = await taskRepository.findAll();
    const maxSeq = allTasks
      .filter(t => t.id.prefix === prefix)
      .map(t => t.id.sequence)
      .reduce((max, seq) => Math.max(max, seq), 0);

    const task = new Task(
      TaskId.create(prefix, maxSeq + 1),
      title,
      description,
      TaskStatus.TODO,
      priority || Priority.P1,
      projects || [],
      relatedFiles || [],
      acceptanceCriteria || []
    );

    await taskRepository.save(task);

    return reply.status(201).send(task.toJSON());
  });

  // PATCH /api/tasks/:id - 更新任务
  fastify.patch<{
    Params: { id: string };
    Body: {
      title?: string;
      description?: string;
      status?: TaskStatus;
      priority?: Priority;
      projects?: string[];
      relatedFiles?: string[];
      acceptanceCriteria?: string[];
    };
  }>('/api/tasks/:id', async (request, reply) => {
    const taskId = TaskId.fromString(request.params.id);
    const task = await taskRepository.findById(taskId);

    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    const updates = request.body;

    // 更新字段（通过重新创建，因为 Task 是不可变的）
    const updatedTask = new Task(
      task.id,
      updates.title ?? task.title,
      updates.description ?? task.description,
      updates.status ?? task.status,
      updates.priority ?? task.priority,
      updates.projects ?? task.projects,
      updates.relatedFiles ?? task.relatedFiles,
      updates.acceptanceCriteria ?? task.acceptanceCriteria,
      task.worktree,
      task.executionResult,
      task.createdAt,
      new Date() // updatedAt
    );

    await taskRepository.save(updatedTask);

    return updatedTask.toJSON();
  });

  // DELETE /api/tasks/:id - 删除任务
  fastify.delete<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) => {
    const taskId = TaskId.fromString(request.params.id);
    const task = await taskRepository.findById(taskId);

    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    await taskRepository.delete(taskId);

    return reply.status(204).send();
  });
}
