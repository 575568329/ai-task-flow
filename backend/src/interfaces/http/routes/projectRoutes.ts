// backend/src/interfaces/http/routes/projectRoutes.ts
import { FastifyInstance } from 'fastify';
import { simpleGit } from 'simple-git';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import type {
  InspectProjectRequest,
  InspectProjectResponse,
  BrowseDirEntry,
  BrowseDirResponse,
} from '@ai-task-flow/shared';

/** 检查目录是否含 .git（视为 git 仓库根） */
async function isGitRepoDir(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(p, '.git'));
    return stat.isDirectory() || stat.isFile(); // .git 可以是目录也可以是 file（worktree 链接）
  } catch {
    return false;
  }
}

/** Windows 列出可用驱动器（C:\ D:\ ...）；其他平台返回空 */
async function listDrives(): Promise<string[]> {
  if (process.platform !== 'win32') return [];
  const drives: string[] = [];
  await Promise.all(
    'CDEFGHIJKLMNOPQRSTUVWXYZAB'.split('').map(async (letter) => {
      const root = `${letter}:\\`;
      try {
        await fs.access(root);
        drives.push(root);
      } catch {
        // 该驱动器不存在
      }
    })
  );
  return drives.sort();
}

/** 算父目录路径——到根/盘符顶时返回 null */
function parentOf(p: string): string | null {
  const parent = path.dirname(p);
  // path.dirname('/') === '/'，path.dirname('C:\\') === 'C:\\'
  return parent === p ? null : parent;
}

export async function registerProjectRoutes(fastify: FastifyInstance) {
  // GET /api/projects/browse?path=... - 浏览目录子项（用于前端目录选择器）
  fastify.get<{ Querystring: { path?: string } }>(
    '/api/projects/browse',
    async (request, reply) => {
      // 默认起点：用户主目录
      const requested = request.query.path?.trim();
      const target = requested ? path.normalize(requested) : os.homedir();

      try {
        const stat = await fs.stat(target);
        if (!stat.isDirectory()) {
          return reply.status(400).send({ error: '路径不是目录' });
        }
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === 'ENOENT') return reply.status(404).send({ error: '路径不存在' });
        if (code === 'EACCES' || code === 'EPERM') return reply.status(403).send({ error: '无访问权限' });
        return reply.status(400).send({ error: (err as Error).message });
      }

      // 列子目录
      let dirents;
      try {
        dirents = await fs.readdir(target, { withFileTypes: true });
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === 'EACCES' || code === 'EPERM') return reply.status(403).send({ error: '无访问权限' });
        throw err;
      }

      // 仅保留目录、过滤隐藏（. 开头），按字母序
      const subDirs = dirents
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => d.name)
        .sort((a, b) => a.localeCompare(b));

      // 并发判断每个子目录是否 git 仓库（容忍权限错误）
      const entries: BrowseDirEntry[] = await Promise.all(
        subDirs.map(async (name) => ({
          name,
          isGitRepo: await isGitRepoDir(path.join(target, name)),
        }))
      );

      const response: BrowseDirResponse = {
        path: target,
        parent: parentOf(target),
        isGitRepo: await isGitRepoDir(target),
        entries,
        home: os.homedir(),
        drives: await listDrives(),
      };
      return reply.send(response);
    }
  );

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
