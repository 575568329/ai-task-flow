// backend/src/infrastructure/system/ClaudeSettingsTargetResolver.ts
// 探测本机所有可切换的 Claude Code settings.json 目标:
//   - Windows 侧:%USERPROFILE%\.claude\settings.json
//   - WSL 各 distro:\\wsl.localhost\<distro>\home\<user>\.claude\settings.json
//
// 全程纯 fs(UNC 路径直读 WSL 文件系统),不 spawn wsl.exe —— 与 ClaudeSessionScanner
// 同一套 distro 枚举(复用其缓存),运行时自探测、零配置(CLAUDE.md 1.1)。
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { listWslDistros } from './ClaudeSessionScanner.js';
import type { ClaudeSettingsTarget } from '@ai-task-flow/shared';

/** UNC 根:两种写法都试,不同 Windows 版本可读性不一 */
const WSL_UNC_ROOTS = ['\\\\wsl.localhost', '\\\\wsl$'];

/** key 用于备份文件名,必须文件名安全 */
function sanitizeKey(raw: string): string {
  return raw.replace(/[^A-Za-z0-9._-]/g, '-');
}

/** 目标是否值得列出:.claude 目录已存在(装过 Claude Code)即算,settings.json 可缺 */
function claudeDirExists(homeDir: string): boolean {
  try {
    return existsSync(path.join(homeDir, '.claude'));
  } catch {
    // UNC 无权限访问
    return false;
  }
}

function buildTarget(
  side: 'windows' | 'wsl',
  key: string,
  label: string,
  homeDir: string,
): ClaudeSettingsTarget {
  const settingsPath = path.join(homeDir, '.claude', 'settings.json');
  return {
    key: sanitizeKey(key),
    label,
    side,
    path: settingsPath,
    exists: existsSync(settingsPath),
  };
}

/** 枚举某 distro 下的 home 子目录(各用户) + root 兜底,返回 [用户名, home 路径] */
function listDistroHomes(distro: string): Array<[string, string]> {
  const homes: Array<[string, string]> = [];
  const seenUsers = new Set<string>();

  for (const uncRoot of WSL_UNC_ROOTS) {
    const homeRoot = path.join(uncRoot, distro, 'home');
    try {
      for (const user of readdirSync(homeRoot)) {
        if (seenUsers.has(user)) continue;
        const homeDir = path.join(homeRoot, user);
        if (!claudeDirExists(homeDir)) continue;
        seenUsers.add(user);
        homes.push([user, homeDir]);
      }
    } catch {
      // 该 UNC 根不可读或 distro 无 /home,试下一个
    }

    // Claude 以 root 运行的兜底
    const rootHome = path.join(uncRoot, distro, 'root');
    if (!seenUsers.has('root') && claudeDirExists(rootHome)) {
      seenUsers.add('root');
      homes.push(['root', rootHome]);
    }
  }

  return homes;
}

/**
 * 列出所有可切换目标。
 * Windows 侧无条件列出(即使 settings.json 还不存在,也可作为写入目标);
 * WSL 侧仅列出「已装 Claude Code(有 .claude 目录)」的 distro/用户,避免罗列一堆空壳。
 */
export function listClaudeSettingsTargets(): ClaudeSettingsTarget[] {
  const targets: ClaudeSettingsTarget[] = [];

  if (process.platform !== 'win32') {
    // 后端跑在 WSL/Linux/macOS:只有本机 home 一个目标
    targets.push(buildTarget('wsl', 'local', `本机 · ${os.homedir()}`, os.homedir()));
    return targets;
  }

  targets.push(buildTarget('windows', 'windows', 'Windows · 本机用户', os.homedir()));

  for (const distro of listWslDistros()) {
    for (const [user, homeDir] of listDistroHomes(distro)) {
      targets.push(
        buildTarget('wsl', `wsl-${distro}-${user}`, `WSL · ${distro} / ${user}`, homeDir),
      );
    }
  }

  return targets;
}

/** 按 key 找目标;找不到返回 null(路由据此回 404,不让调用方拼路径) */
export function findClaudeSettingsTarget(key: string): ClaudeSettingsTarget | null {
  return listClaudeSettingsTargets().find((target) => target.key === key) ?? null;
}
