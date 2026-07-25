// backend/src/interfaces/http/routes/taskChatRoutes.ts
// 任务对话流式接口:POST /api/tasks/:id/chat → spawn claude(headless stream-json)→ SSE 透传事件。
// 旁路通道:不写 tasks.json、不转状态机(状态回写仍走 MCP 那条通道)。sessionId 续接存 task-sessions.json。
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { TaskRepository } from '../../../domain/workflow/repositories/TaskRepository.js';
import { TaskId } from '../../../domain/workflow/value-objects/TaskId.js';
import { AgentRuntimeManager } from '../../../application/agent/AgentRuntimeManager.js';
import type { TaskSessionStore } from '../../../infrastructure/persistence/TaskSessionStore.js';
import type { SessionTitleStore } from '../../../infrastructure/persistence/SessionTitleStore.js';
import { FileLogger } from '../../../infrastructure/logging/FileLogger.js';
import { ClaudeSessionScanner } from '../../../infrastructure/system/ClaudeSessionScanner.js';
import type { AgentEvent, ChatSessionSummary, TaskDTO } from '@ai-task-flow/shared';

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

/**
 * 拼接任务上下文(首轮注入 prompt):让 Claude 在任务对话里"认识"当前任务。
 * 含编号/标题/项目/关联文件/描述/步骤,并指向任务 markdown 存档供读取完整细节。
 */
function buildTaskContext(dto: TaskDTO): string {
  const lines: string[] = ['【当前任务上下文】', `任务编号: ${dto.id}`, `标题: ${dto.title}`];
  if (dto.projectName) lines.push(`项目: ${dto.projectName}`);
  if (dto.relatedFiles.length > 0) lines.push(`关联文件: ${dto.relatedFiles.join(', ')}`);
  if (dto.description.trim()) lines.push('', '任务描述:', dto.description.trim());

  const steps = dto.steps
    .map((s, i) => {
      // blocks 为准,旧字段 description 仅兼容历史数据(types/task.ts 注释约定)
      const text = (s.blocks ?? [])
        .map((b) => (b.type === 'text' ? b.content : ''))
        .join(' ')
        .trim();
      const content = text || s.description?.trim();
      return content ? `${i + 1}. ${content}` : null;
    })
    .filter((x): x is string => x !== null);
  if (steps.length > 0) lines.push('', '任务步骤:', ...steps);

  if (dto.taskFilePath) lines.push('', `完整任务详情见文件: ${dto.taskFilePath}`);
  return lines.join('\n');
}

export async function registerTaskChatRoutes(
  fastify: FastifyInstance,
  taskRepository: TaskRepository,
  agentRuntimeManager: AgentRuntimeManager,
  sessionStore: TaskSessionStore,
  sessionTitleStore: SessionTitleStore,
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
        // 合并用户自定义标题(看板侧重命名),覆盖 scanner 从 jsonl 推断的 title
        const titles = await sessionTitleStore.getAll();
        const sessions: ChatSessionSummary[] = metas.map((m) => ({
          sessionId: m.sessionId,
          title: titles.get(m.sessionId) ?? m.title,
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

  // PUT /api/tasks/:id/chat/sessions/:sessionId/title — 重命名会话(看板侧自定义标题,不碰 Claude jsonl)
  fastify.put<{ Params: { id: string; sessionId: string }; Body: { title?: string } }>(
    '/api/tasks/:id/chat/sessions/:sessionId/title',
    async (request, reply) => {
      const taskId = parseTaskId(reply, request.params.id);
      if (!taskId) return;
      const title = request.body?.title?.trim();
      if (!title) return reply.status(400).send({ error: 'title 不能为空' });
      // sessionId 校验(同 findSessionFile:防路径穿越,仅 UUID 形态)
      if (!/^[A-Za-z0-9-]+$/.test(request.params.sessionId)) {
        return reply.status(400).send({ error: '无效的 sessionId' });
      }
      await sessionTitleStore.set(request.params.sessionId, title);
      return { sessionId: request.params.sessionId, title };
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

      // 任务上下文注入:首轮(无续接)把任务信息塞进 prompt,让 Claude 知道在做哪个任务;
      // 续接轮 Claude 已有历史记忆,不重复注入(省 token、避免每轮冗余)。经 stdin 写入,零注入风险。
      const prompt = resumeSessionId ? message : `${buildTaskContext(dto)}\n\n---\n\n${message}`;

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      // 中断控制:客户端断开(用户点「停止」→ fetch abort / 关抽屉)时 abort,
      // manager 收到信号 interrupt 当前 turn(runtime 不死,下次复用)。
      const abortController = new AbortController();
      const onClose = () => abortController.abort();
      request.raw.on('close', onClose);

      try {
        const { sessionId: realSessionId } = await agentRuntimeManager.executeTurn({
          side,
          sessionId: resumeSessionId,
          cwd,
          text: prompt,
          signal: abortController.signal,
          onEvent: (ev) => {
            // 客户端可能已断开(abort/关抽屉),写已结束的流会抛 → 卫语句兜底(CR1)
            if (!reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
          },
        });
        // 终态:落盘 sessionId 供下轮续接(按侧);客户端已断开则跳过
        if (!reply.raw.writableEnded) await sessionStore.set(task.id.value, side, realSessionId);
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
