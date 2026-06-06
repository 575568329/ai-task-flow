// backend/src/interfaces/http/routes/projectRoutes.ts
import { FastifyInstance } from 'fastify';
import { simpleGit } from 'simple-git';
import path from 'path';
import fs from 'fs/promises';
import type { InspectProjectRequest, InspectProjectResponse } from '@ai-task-flow/shared';

export async function registerProjectRoutes(fastify: FastifyInstance) {
  // POST /api/projects/inspect - 检查项目路径
  fastify.post<{ Body: InspectProjectRequest }>(
    '/api/projects/inspect',
    async (request, reply) => {
      const { path: repoPath } = request.body;

      if (!repoPath) {
        return reply.status(400).send({ error: 'path is required' });
      }

      try {
        // 检查路径是否存在
        await fs.access(repoPath);

        // 检查是否为 git 仓库
        const git = simpleGit(repoPath);
        const isRepo = await git.checkIsRepo();

        if (!isRepo) {
          const response: InspectProjectResponse = {
            projectName: path.basename(repoPath),
            valid: false,
          };
          return reply.send(response);
        }

        // 尝试从 git remote 提取项目名
        let projectName = path.basename(repoPath);
        try {
          const remotes = await git.getRemotes(true);
          if (remotes.length > 0) {
            const originUrl = remotes.find((r: { name: string }) => r.name === 'origin')?.refs.fetch || remotes[0].refs.fetch;
            // 从 git URL 提取项目名 (支持 https 和 ssh)
            // https://github.com/user/repo.git -> repo
            // git@github.com:user/repo.git -> repo
            const match = originUrl.match(/\/([^\/]+?)(\.git)?$/);
            if (match) {
              projectName = match[1];
            }
          }
        } catch {
          // 如果获取 remote 失败,使用文件夹名
        }

        const response: InspectProjectResponse = {
          projectName,
          valid: true,
        };

        return reply.send(response);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(400).send({ error: `Invalid path: ${message}` });
      }
    }
  );
}
