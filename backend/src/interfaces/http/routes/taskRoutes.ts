// backend/src/interfaces/http/routes/taskRoutes.ts
import { FastifyInstance } from 'fastify';
import { TaskRepository } from '../../../domain/workflow/repositories/TaskRepository.js';
import { TaskId } from '../../../domain/workflow/value-objects/TaskId.js';
import { Task } from '../../../domain/workflow/entities/Task.js';
import { TaskStatus } from '../../../domain/workflow/value-objects/TaskStatus.js';
import { Priority } from '../../../domain/workflow/value-objects/Priority.js';
import { WorktreeManager } from '../../../infrastructure/git/WorktreeManager.js';
import type { CreateTaskRequest, UpdateTaskRequest } from '@ai-task-flow/shared';
import { buildTaskMarkdown, writeTaskDoc, removeTaskDoc } from '../../../infrastructure/persistence/taskDoc.js';
import { taskDocPath } from '../../../config/dataDir.js';
import { TerminalLauncher } from '../../../infrastructure/system/TerminalLauncher.js';

export async function registerTaskRoutes(
  fastify: FastifyInstance,
  taskRepository: TaskRepository,
  worktreeManager: WorktreeManager
) {
  /**
   * Task → DTO,补充 taskFilePath(markdown 存档的绝对路径)。
   * 前端据此生成派发指令,指向真实存在的文件,而非凭空拼路径。
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

    // 验证状态值
    const validStatuses = ['planning', 'todo', 'dispatched', 'review', 'done', 'blocked'];
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

      const previousStatus = task.status;
      const hasWorktree = !!task.worktree;

      // 通过领域方法更新，发布 TaskUpdated 事件以驱动前端 SSE 实时刷新
      task.applyUpdate(request.body);

      // 如果状态从 dispatched 变为其他状态，清理 worktree
      if (
        previousStatus === TaskStatus.DISPATCHED &&
        task.status !== TaskStatus.DISPATCHED &&
        hasWorktree
      ) {
        try {
          const worktree = task.worktree!;
          await worktreeManager.destroy(worktree);
          // 清空任务的 worktree 字段
          task.worktree = undefined;
          fastify.log.info(`Worktree cleaned for task ${task.id.value}: ${worktree.path}`);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          fastify.log.warn(`Failed to clean worktree for task ${task.id.value}: ${message}`);
          // 不阻止任务状态更新，worktree 清理失败只记录警告
        }
      }

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

  // POST /api/tasks/:id/dispatch - 派发任务（创建 worktree）
  fastify.post<{ Params: { id: string } }>(
    '/api/tasks/:id/dispatch',
    async (request, reply) => {
      const taskId = TaskId.fromString(request.params.id);
      const task = await taskRepository.findById(taskId);

      if (!task) {
        return reply.status(404).send({ error: 'Task not found' });
      }

      if (task.status !== TaskStatus.TODO) {
        return reply.status(400).send({ error: 'Only TODO tasks can be dispatched' });
      }

      if (!task.repoPath) {
        return reply.status(400).send({ error: 'Task must have a repoPath to dispatch' });
      }

      try {
        // 创建 worktree
        const worktree = await worktreeManager.create(task.repoPath, task.id.value);

        // 调用领域方法派发
        task.dispatch(worktree);

        // 保存任务
        await taskRepository.save(task);

        // 落盘 markdown 存档(含 worktree 信息),派发指令指向此真实文件
        try {
          await writeTaskDoc(task);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          fastify.log.warn(`Failed to write task doc on dispatch for ${task.id.value}: ${message}`);
        }

        // 生成 Claude 指令（包含 /rename 命令 + 任务拉取指令）
        const taskMdPath = taskDocPath(task.id.value);
        const claudeCommand = `/rename ${task.id.value}\n请拉取任务 ${task.id.value} 并执行，详情见 ${taskMdPath}`;

        // 尝试自动打开终端并运行 claude（失败不阻断派发）
        try {
          await TerminalLauncher.openAndRunClaude(task.repoPath);
          fastify.log.info(`Launched terminal for task ${task.id.value} at ${task.repoPath}`);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          fastify.log.warn(`Failed to launch terminal for ${task.id.value}: ${message}`);
        }

        // 返回任务 DTO + Claude 指令（前端负责复制到剪贴板）
        return {
          ...toDTO(task),
          claudeCommand,
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(500).send({ error: `Failed to dispatch: ${message}` });
      }
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

  // GET /api/tasks/:id/diff - 获取任务 worktree 的 git diff
  fastify.get<{ Params: { id: string }; Querystring: { base?: string } }>(
    '/api/tasks/:id/diff',
    async (request, reply) => {
      const taskId = TaskId.fromString(request.params.id);
      const task = await taskRepository.findById(taskId);

      if (!task) {
        return reply.status(404).send({ error: 'Task not found' });
      }

      if (!task.worktree) {
        return reply.status(409).send({ error: 'Task has no worktree (not dispatched)' });
      }

      const baseBranch = request.query.base || 'main';
      try {
        const diff = await worktreeManager.getDiff(task.worktree, baseBranch);
        return {
          taskId: task.id.value,
          branch: task.worktree.branch,
          baseBranch,
          diff,
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(500).send({ error: `Failed to compute diff: ${message}` });
      }
    }
  );

  // POST /api/tasks/:id/approve - 审查通过(review → done)
  fastify.post<{ Params: { id: string }; Body: { mergeStrategy?: 'merge' | 'keep_branch' } }>(
    '/api/tasks/:id/approve',
    async (request, reply) => {
      const taskId = TaskId.fromString(request.params.id);
      const task = await taskRepository.findById(taskId);

      if (!task) {
        return reply.status(404).send({ error: 'Task not found' });
      }

      try {
        task.approve(request.body?.mergeStrategy ?? 'keep_branch');
        await taskRepository.save(task);
        return toDTO(task);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(400).send({ error: message });
      }
    }
  );

  // POST /api/tasks/:id/reject - 审查打回(review → todo)
  fastify.post<{ Params: { id: string }; Body: { reason: string } }>(
    '/api/tasks/:id/reject',
    async (request, reply) => {
      const taskId = TaskId.fromString(request.params.id);
      const task = await taskRepository.findById(taskId);

      if (!task) {
        return reply.status(404).send({ error: 'Task not found' });
      }

      const reason = request.body?.reason;
      if (!reason) {
        return reply.status(400).send({ error: 'reason is required' });
      }

      try {
        task.reject(reason);
        await taskRepository.save(task);
        return toDTO(task);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(400).send({ error: message });
      }
    }
  );

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
