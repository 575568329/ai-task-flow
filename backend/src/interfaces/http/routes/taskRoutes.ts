// backend/src/interfaces/http/routes/taskRoutes.ts
import { FastifyInstance } from 'fastify';
import { TaskRepository } from '../../../domain/workflow/repositories/TaskRepository.js';
import { TaskId } from '../../../domain/workflow/value-objects/TaskId.js';
import { Task } from '../../../domain/workflow/entities/Task.js';
import { TaskStatus } from '../../../domain/workflow/value-objects/TaskStatus.js';
import { Priority } from '../../../domain/workflow/value-objects/Priority.js';
import { WorktreeManager } from '../../../infrastructure/git/WorktreeManager.js';
import type { CreateTaskRequest, UpdateTaskRequest } from '@ai-task-flow/shared';
import { stepsToMarkdown } from '@ai-task-flow/shared';

export async function registerTaskRoutes(
  fastify: FastifyInstance,
  taskRepository: TaskRepository,
  worktreeManager: WorktreeManager
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
  fastify.post<{ Body: CreateTaskRequest }>('/api/tasks', async (request, reply) => {
    const { prefix, title, description, priority, repoPath, projectName, relatedFiles, steps } = request.body;

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
      repoPath,
      projectName,
      relatedFiles || [],
      steps || []
    );

    await taskRepository.save(task);

    return reply.status(201).send(task.toJSON());
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

      return task.toJSON();
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

        return task.toJSON();
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
        return task.toJSON();
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
        return task.toJSON();
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

      const lines = [
        `# ${task.title}`,
        '',
        `**任务ID**: ${task.id.value}`,
        `**优先级**: ${task.priority}`,
        `**状态**: ${task.status}`,
      ];

      if (task.projectName) {
        lines.push(`**项目**: ${task.projectName}`);
      }
      if (task.repoPath) {
        lines.push(`**仓库路径**: \`${task.repoPath}\``);
      }

      lines.push('', '## 描述', '', task.description || '（无描述）', '');

      if (task.steps.length > 0) {
        lines.push('## 任务步骤', '');
        // 复用 shared：图文顺序与编辑器、MCP、前端预览一致
        lines.push(stepsToMarkdown(task.steps), '');
      }

      if (task.relatedFiles.length > 0) {
        lines.push('## 相关文件', '');
        task.relatedFiles.forEach(file => {
          lines.push(`- \`${file}\``);
        });
        lines.push('');
      }

      if (task.worktree) {
        lines.push(
          '## Worktree 信息',
          '',
          `- **路径**: \`${task.worktree.path}\``,
          `- **分支**: \`${task.worktree.branch}\``,
          `- **基准提交**: \`${task.worktree.baseCommit}\``,
          ''
        );
      }

      if (task.executionResult) {
        lines.push(
          '## 执行结果',
          '',
          `**状态**: ${task.executionResult.status}`,
          '',
          '**变更文件**:',
          ''
        );
        task.executionResult.changedFiles.forEach(file => {
          lines.push(`- \`${file}\``);
        });
        lines.push('', `**备注**: ${task.executionResult.notes}`, '');
      }

      return { markdown: lines.join('\n') };
    }
  );
}
