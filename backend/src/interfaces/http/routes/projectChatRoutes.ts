// backend/src/interfaces/http/routes/projectChatRoutes.ts
// 项目对话接口(悬浮窗用,不绑任务):按项目聚合历史 + cwd-based 新建/续接对话。
//
// 与 taskChatRoutes 的区别:对话以 repoPath(项目)为根,不预设任务、不注入任务上下文
// (自由对话);关联任务是 claude 在对话中 get_task 时自然产生(jsonl 埋 task 标记),
// 由 ClaudeSessionScanner 反向扫出(usage.taskId),聚合时反查任务表得 taskTitle。
// 续接 sessionId 由前端持有(按会话续接,无 task→session 映射),故不依赖 TaskSessionStore。
//
// 注意:backend 已有 chatRoutes.ts(知识库 ChatService 对话,占用 /api/chat),
// 本文件用 /api/project-chat/* 前缀避让,职责分离。
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { TaskRepository } from '../../../domain/workflow/repositories/TaskRepository.js';
import { AgentRuntimeManager } from '../../../application/agent/AgentRuntimeManager.js';
import type { SessionTitleStore } from '../../../infrastructure/persistence/SessionTitleStore.js';
import { FileLogger } from '../../../infrastructure/logging/FileLogger.js';
import { ClaudeSessionScanner } from '../../../infrastructure/system/ClaudeSessionScanner.js';
import type { AgentEvent, ClaudeSessionMeta, ProjectChatGroup, ProjectSessionSummary, TaskDTO } from '@ai-task-flow/shared';
import { collectKnownRepos, normalizeRepoKey } from './projectChatHelpers.js';

const logger = new FileLogger('project-chat');

export async function registerProjectChatRoutes(
  fastify: FastifyInstance,
  taskRepository: TaskRepository,
  agentRuntimeManager: AgentRuntimeManager,
  sessionTitleStore: SessionTitleStore,
) {
  // GET /api/project-chat/projects — 按项目(repoPath)聚合所有任务的会话,每条带关联任务
  fastify.get('/api/project-chat/projects', async () => {
    const tasks = await taskRepository.findAll();
    const dtoById = new Map<string, TaskDTO>();
    for (const task of tasks) {
      const dto = task.toJSON();
      dtoById.set(dto.id, dto);
    }
    // 已知项目(repoPath 优先,缺失从 worktree.path 反推根;归一化去重)——
    // 逻辑抽到 projectChatHelpers.collectKnownRepos,与 POST 白名单共用、可单测
    const knownRepos = collectKnownRepos([...dtoById.values()]);

    const titles = await sessionTitleStore.getAll();
    const projects: ProjectChatGroup[] = [];
    for (const info of knownRepos) {
      let metas: ClaudeSessionMeta[];
      try {
        metas = await ClaudeSessionScanner.scan(info.repoPath);
      } catch (error: unknown) {
        // 单个项目扫描失败不阻断其余项目:记日志 + 该项目空列表
        logger.error('scan projects 异常', {
          repoPath: info.repoPath,
          message: error instanceof Error ? error.message : String(error),
        });
        metas = [];
      }
      const sessions: ProjectSessionSummary[] = metas.map((m) => {
        const taskId = m.usage?.taskId;
        const taskTitle = taskId ? dtoById.get(taskId)?.title : undefined;
        return {
          sessionId: m.sessionId,
          title: titles.get(m.sessionId) ?? m.title,
          lastActiveAt: m.lastActiveAt,
          messageCount: m.messageCount,
          source: m.source,
          taskId,
          taskTitle,
        };
      });
      projects.push({ repoPath: info.repoPath, projectName: info.projectName, sessions });
    }
    return { projects };
  });

  // GET /api/project-chat/sessions/:sessionId?repoPath=... — 加载某历史会话时间线(cwd-based)
  // sessionId 校验:防路径穿越(仅 UUID 形态),同 findSessionFile
  fastify.get<{ Params: { sessionId: string }; Querystring: { repoPath?: string } }>(
    '/api/project-chat/sessions/:sessionId',
    async (request, reply) => {
      const repoPath = request.query.repoPath;
      if (!repoPath) return reply.status(400).send({ error: 'repoPath 必填' });
      if (!/^[A-Za-z0-9-]+$/.test(request.params.sessionId)) {
        return reply.status(400).send({ error: '无效的 sessionId' });
      }
      const turns = await ClaudeSessionScanner.loadTimeline(repoPath, request.params.sessionId);
      if (!turns) return reply.status(404).send({ error: '历史会话不存在' });
      return { turns };
    },
  );

  // POST /api/project-chat — cwd-based 对话(新建 / resume)。
  // 自由对话:不注入任务上下文(prompt = 用户原话);关联任务靠 claude 后续 get_task 自然产生。
  fastify.post<{ Body: { repoPath?: string; message?: string; sessionId?: string; side?: 'windows' | 'wsl'; images?: { data: string; mediaType: string }[] } }>(
    '/api/project-chat',
    async (
      request: FastifyRequest<{
        Body: { repoPath?: string; message?: string; sessionId?: string; side?: 'windows' | 'wsl'; images?: { data: string; mediaType: string }[] };
      }>,
      reply: FastifyReply,
    ) => {
      const repoPath = request.body?.repoPath?.trim();
      if (!repoPath) return reply.status(400).send({ error: 'repoPath 不能为空' });

      // 安全校验:cwd 必须是 tasks 已登记的项目路径(白名单),防止任意目录 spawn claude。
      // 本服务监听 localhost,但浏览器扩展/其他页面仍可打,不能让前端自由指定任意 cwd。
      const knownRepos = collectKnownRepos((await taskRepository.findAll()).map((t) => t.toJSON()));
      const knownKeys = new Set(knownRepos.map((r) => normalizeRepoKey(r.repoPath)));
      if (!knownKeys.has(normalizeRepoKey(repoPath))) {
        return reply.status(403).send({ error: '该路径未登记为项目,无法在此对话' });
      }

      const message = request.body?.message?.trim();
      if (!message) return reply.status(400).send({ error: 'message 不能为空' });

      const side = request.body?.side === 'wsl' ? 'wsl' : 'windows';
      const resumeSessionId = request.body?.sessionId?.trim() || undefined;
      const images = request.body?.images ?? undefined;

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      // 中断控制:客户端断开(停止/关窗)时 abort,manager interrupt 当前 turn(runtime 不死,下次复用)
      const abortController = new AbortController();
      const onClose = () => abortController.abort();
      request.raw.on('close', onClose);

      try {
        await agentRuntimeManager.executeTurn({
          side,
          sessionId: resumeSessionId,
          cwd: repoPath,
          text: message,
          images,
          signal: abortController.signal,
          onEvent: (ev) => {
            // 客户端可能已断开,写已结束的流会抛 → 卫语句兜底
            if (!reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
          },
        });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error('project chat 异常', { repoPath, message: msg });
        const errEv: AgentEvent = { type: 'error', message: msg };
        if (!reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(errEv)}\n\n`);
      } finally {
        request.raw.off('close', onClose);
        if (!reply.raw.writableEnded) reply.raw.end();
      }
    },
  );
}
