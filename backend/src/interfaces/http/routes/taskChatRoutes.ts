// backend/src/interfaces/http/routes/taskChatRoutes.ts
// 任务对话流式接口:POST /api/tasks/:id/chat → spawn claude(headless stream-json)→ SSE 透传事件。
// 旁路通道:不写 tasks.json、不转状态机(状态回写仍走 MCP 那条通道)。sessionId 续接存 task-sessions.json。
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { TaskRepository } from '../../../domain/workflow/repositories/TaskRepository.js';
import { TaskId } from '../../../domain/workflow/value-objects/TaskId.js';
import { AgentRunner } from '../../../application/agent/AgentRunner.js';
import type { TaskSessionStore } from '../../../infrastructure/persistence/TaskSessionStore.js';
import { FileLogger } from '../../../infrastructure/logging/FileLogger.js';
import { ClaudeSessionScanner } from '../../../infrastructure/system/ClaudeSessionScanner.js';
import type { AgentEvent, ChatSessionSummary } from '@ai-task-flow/shared';

const logger = new FileLogger('task-chat');

/** 安全解析 taskId:无效 id 返回 null(调用方回 400),避免 fromString 抛 500 */
function parseTaskId(reply: FastifyReply, raw: string): TaskId | null {
  try {
    return TaskId.fromString(raw);
  } catch {
    reply.status(400).send({ error: '无效的任务 id' });
    return null;
  }
}

export async function registerTaskChatRoutes(
  fastify: FastifyInstance,
  taskRepository: TaskRepository,
  agentRunner: AgentRunner,
  sessionStore: TaskSessionStore,
) {
  // GET /api/tasks/:id/chat/sessions — 该任务仓库下的历史 Claude 会话列表
  fastify.get<{ Params: { id: string } }>(
    '/api/tasks/:id/chat/sessions',
    async (request, reply) => {
      const taskId = parseTaskId(reply, request.params.id);
      if (!taskId) return;
      const task = await taskRepository.findById(taskId);
      if (!task) return reply.status(404).send({ error: 'Task not found' });
      const dto = task.toJSON();
      const cwd = dto.worktree?.path || dto.repoPath;
      if (!cwd) return reply.send({ sessions: [] });
      try {
        const metas = await ClaudeSessionScanner.scan(cwd);
        const sessions: ChatSessionSummary[] = metas.map((m) => ({
          sessionId: m.sessionId,
          title: m.title,
          lastActiveAt: m.lastActiveAt,
          messageCount: m.messageCount,
          source: m.source,
        }));
        return { sessions };
      } catch (error: unknown) {
        logger.error('list sessions 异常', { message: error instanceof Error ? error.message : String(error) });
        return { sessions: [] };
      }
    },
  );

  // GET /api/tasks/:id/chat/sessions/:sessionId — 加载某历史会话的消息时间线
  fastify.get<{ Params: { id: string; sessionId: string } }>(
    '/api/tasks/:id/chat/sessions/:sessionId',
    async (request, reply) => {
      const taskId = parseTaskId(reply, request.params.id);
      if (!taskId) return;
      const task = await taskRepository.findById(taskId);
      if (!task) return reply.status(404).send({ error: 'Task not found' });
      const dto = task.toJSON();
      const cwd = dto.worktree?.path || dto.repoPath;
      if (!cwd) return reply.status(400).send({ error: '任务未配置仓库路径' });
      const turns = await ClaudeSessionScanner.loadTimeline(cwd, request.params.sessionId);
      if (!turns) return reply.status(404).send({ error: '历史会话不存在' });
      return { turns };
    },
  );

  fastify.post<{ Params: { id: string }; Body: { message?: string; sessionId?: string; side?: 'windows' | 'wsl' } }>(
    '/api/tasks/:id/chat',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { message?: string; sessionId?: string; side?: 'windows' | 'wsl' };
      }>,
      reply: FastifyReply,
    ) => {
      const taskId = parseTaskId(reply, request.params.id);
      if (!taskId) return;
      const task = await taskRepository.findById(taskId);
      if (!task) return reply.status(404).send({ error: 'Task not found' });

      const message = request.body?.message?.trim();
      if (!message) return reply.status(400).send({ error: 'message 不能为空' });

      // cwd:worktree 优先,其次 repoPath;都没有则拒绝(没有工作目录无法 spawn)
      const dto = task.toJSON();
      const cwd = dto.worktree?.path || dto.repoPath;
      if (!cwd) {
        return reply.status(400).send({ error: '任务未配置仓库路径(worktree/repoPath),无法启动对话' });
      }

      // 续接 sessionId 优先级:body 显式(加载历史后接着聊)> 上次 result 落盘的(按侧)
      const side = request.body?.side === 'wsl' ? 'wsl' : 'windows';
      const resumeSessionId =
        request.body?.sessionId?.trim() || (await sessionStore.get(task.id.value, side));

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      // 中断控制:客户端断开(用户点「停止」→ fetch abort / 关抽屉)时 abort,
      // AgentRunner 收到信号 kill claude 子进程,避免它继续跑到 max-turns/timeout。
      const abortController = new AbortController();
      const onClose = () => abortController.abort();
      request.raw.on('close', onClose);

      try {
        for await (const ev of agentRunner.run({
          prompt: message,
          cwd,
          side: request.body?.side,
          resumeSessionId,
          signal: abortController.signal,
        })) {
          // 客户端可能已断开(abort/关抽屉),写已结束的流会抛 → 卫语句兜底(CR1)
          if (!reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
          // 终态:落盘 sessionId 供下轮续接(按侧)
          if (ev.type === 'result' && typeof ev.session_id === 'string') {
            await sessionStore.set(task.id.value, side, ev.session_id);
          }
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error('task chat 异常', { taskId: task.id.value, message: msg });
        const errEv: AgentEvent = { type: 'error', message: msg };
        if (!reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(errEv)}\n\n`);
      } finally {
        request.raw.off('close', onClose);
        // 客户端已断开时流可能已 end,再 end 会抛 → 卫语句兜底(CR1)
        if (!reply.raw.writableEnded) reply.raw.end();
      }
    },
  );
}
