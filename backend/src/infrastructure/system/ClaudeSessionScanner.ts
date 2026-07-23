// backend/src/infrastructure/system/ClaudeSessionScanner.ts
// 扫描本机所有 Claude home(Windows %USERPROFILE% + WSL \\wsl.localhost\)下的 projects/<encoded>/*.jsonl,
// 提取历史 Claude 会话元信息,供 OpenClaudeDialog 的"恢复历史会话"列表使用。
//
// Claude Code 每个会话存为一个 <sessionId>.jsonl,每行一条消息对象(JSON Lines)。
// 我们提取:sessionId(文件名)、首条 user 文本(作 title)、cwd(行内记录)、
//           lastActiveAt(文件 mtime)、messageCount(行数,近似活跃度)。

import fs from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';
import os from 'os';
import { encodeProjectPath, toWslPath } from './pathCodec.js';
import type { ClaudeSessionMeta } from '@ai-task-flow/shared';

/** WSL distro 列表缓存:distro 极少变动,首次枚举后缓存,避免每次 scan 都 spawn wsl.exe */
let cachedWslDistros: string[] | null = null;

/**
 * 枚举本机 WSL distro 列表。
 * 优先用 UNC 路径 readdir(快、无进程开销);若 UNC 不可读——部分 Windows 版本在 Node 里
 * readdir '\\wsl.localhost' 会返回空或抛错(本机"WSL 选项无历史会话"即由此导致),回退到
 * wsl.exe -l -q(可靠但慢,首次后缓存)。
 */
function listWslDistros(): string[] {
  if (cachedWslDistros) return cachedWslDistros;

  const distros = new Set<string>();
  // ① UNC 枚举(快)
  for (const wslRoot of ['\\\\wsl.localhost', '\\\\wsl$']) {
    try {
      for (const d of readdirSync(wslRoot)) {
        const name = d.trim();
        if (name) distros.add(name);
      }
    } catch {
      // 该 UNC 根不可读,试下一个或走兜底
    }
  }

  // ② wsl.exe 兜底(UNC 不可读时;慢,但结果缓存)
  if (distros.size === 0) {
    try {
      // wsl.exe 输出为 UTF-16LE,按 utf16le 解码避免中文/特殊 distro 名乱码
      const out = execFileSync('wsl.exe', ['-l', '-q'], {
        encoding: 'utf16le',
        windowsHide: true,
      });
      // wsl.exe 输出常带 UTF-16 BOM(﻿),去掉避免首个 distro 名带不可见前缀导致路径拼错
      const clean = out.charCodeAt(0) === 0xFEFF ? out.slice(1) : out;
      for (const line of clean.split(/\r?\n/)) {
        const name = (line.charCodeAt(0) === 0xFEFF ? line.slice(1) : line).trim();
        // 过滤 "(默认)" 标记等干扰项
        if (name && !name.startsWith('(')) distros.add(name);
      }
    } catch {
      // 未装 WSL 或 wsl.exe 不在 PATH
    }
  }

  cachedWslDistros = Array.from(distros);
  if (cachedWslDistros.length > 0) {
    console.log(`[ClaudeSessionScanner] WSL distros: ${cachedWslDistros.join(', ')}`);
  }
  return cachedWslDistros;
}

/**
 * 收集本机所有 Claude Code 的 projects 目录(去重 + 仅保留存在项)。
 *
 * 为什么不只是 os.homedir():cmd 与 wsl 是两个独立的 Claude Code 安装、两个独立的 home——
 *   - cmd/pwsh 会话在 %USERPROFILE%\.claude\projects(原生 Windows Claude)
 *   - wsl 会话在 \\wsl.localhost\<distro>\home\<user>\.claude\projects(WSL 内的 Claude)
 * 只扫一个 home 会漏掉另一侧。这里枚举 \\wsl.localhost / \\wsl$ 下所有 distro,
 * 自动发现 distro/user,无需硬编码。移植自 kanban-code 的 resolve_all_claude_dirs。
 */
function resolveAllClaudeDirs(): string[] {
  const dirs: string[] = [];
  const seen = new Set<string>();
  const addIfExists = (p: string) => {
    try {
      if (existsSync(p) && !seen.has(p)) {
        seen.add(p);
        dirs.push(p);
      }
    } catch {
      // 某些 UNC 路径无权限访问时忽略,不影响其他目录
    }
  };

  if (process.platform === 'win32') {
    // ① 原生 Windows Claude Code:cmd/pwsh 产生的会话
    addIfExists(path.join(os.homedir(), '.claude', 'projects'));

    // ② WSL 各 distro:wsl 内 Claude 产生的会话(distro 名来自 listWslDistros,带 wsl.exe 兜底)
    const distros = listWslDistros();
    for (const distro of distros) {
      for (const wslRoot of ['\\\\wsl.localhost', '\\\\wsl$']) {
        const homeDir = path.join(wslRoot, distro, 'home');
        try {
          for (const user of readdirSync(homeDir)) {
            addIfExists(path.join(homeDir, user, '.claude', 'projects'));
          }
        } catch {
          // 该 root/distro 无 /home/<user> 或 UNC 子目录不可读,跳过
        }
        // Claude 以 root 身份运行的兜底
        addIfExists(path.join(wslRoot, distro, 'root', '.claude', 'projects'));
      }
    }
  } else {
    // Linux/macOS:本机 home(后端跑在 WSL 内时即 /home/<user>)
    addIfExists(path.join(os.homedir(), '.claude', 'projects'));
  }

  return dirs;
}

/**
 * 根据会话 cwd 推断来源(供前端按 cmd/wsl 过滤历史会话列表)。
 *   - Windows 盘符路径(C:\、D:\、C:/ …)→ 'windows'(原生 cmd/pwsh Claude 的会话)
 *   - / 开头(/mnt/c…、/home… …)→ 'wsl'(WSL 内 Claude 的会话)
 *   - cwd 为空无法判断 → 默认 'windows'
 */
function inferSessionSource(cwd: string): 'windows' | 'wsl' {
  if (/^[A-Za-z]:[\\/]/.test(cwd)) return 'windows';
  if (cwd.startsWith('/')) return 'wsl';
  return 'windows';
}

export class ClaudeSessionScanner {
  /**
   * 扫描指定项目工作目录下的历史 Claude 会话(跨 cmd/wsl 两个 home 合并)。
   *
   * repoPath 同时尝试 Windows 形态(C:\...)与 WSL 形态(/mnt/c/...)两种编码目录名;
   * 并遍历本机所有 Claude home(见 resolveAllClaudeDirs):Windows %USERPROFILE% 侧(cmd/pwsh 会话)
   * + 各 WSL distro 的 home(wsl 会话)。两侧命中后按 sessionId 去重合并,故列表同时含 cmd 与 wsl 会话。
   *
   * @returns 按 lastActiveAt 倒序、按 sessionId 去重后的会话列表
   */
  static async scan(repoPath: string): Promise<ClaudeSessionMeta[]> {
    // repoPath 可能是 Windows 形态(C:\...)或 WSL 形态(/mnt/c/...),两种编码目录名都作为候选
    const dirNameCandidates = new Set<string>([
      encodeProjectPath(repoPath),
      encodeProjectPath(toWslPath(repoPath)),
    ]);

    // 本机所有 Claude home:Windows 侧 + 各 WSL distro 侧,cmd/wsl 会话都能扫到
    const claudeDirs = resolveAllClaudeDirs();

    // 诊断日志:定位"WSL 选项无历史会话"类问题——看 repoPath 形态、候选目录名、扫了哪些 home
    console.log(
      `[ClaudeSessionScanner] scan repoPath="${repoPath}" ` +
        `dirNameCandidates=[${Array.from(dirNameCandidates).join(', ')}] ` +
        `claudeDirs(${claudeDirs.length})=${JSON.stringify(claudeDirs)}`,
    );

    const byId = new Map<string, ClaudeSessionMeta>();

    for (const projectsRoot of claudeDirs) {
      for (const dirName of dirNameCandidates) {
        const dir = path.join(projectsRoot, dirName);
        let files: string[];
        try {
          files = await fs.readdir(dir);
        } catch (error: any) {
          // 目录不存在 = 该 home 下无该编码的会话,跳过(不报错)
          if (error.code === 'ENOENT') continue;
          throw error;
        }

        for (const file of files.filter(f => f.endsWith('.jsonl'))) {
          const meta = await this.parseSessionFile(path.join(dir, file));
          if (meta && !byId.has(meta.sessionId)) {
            byId.set(meta.sessionId, { ...meta, source: inferSessionSource(meta.cwd) });
          }
        }
      }
    }

    const result = Array.from(byId.values()).sort((a, b) =>
      b.lastActiveAt.localeCompare(a.lastActiveAt)
    );
    console.log(`[ClaudeSessionScanner] scan 命中 ${result.length} 个会话`);
    return result;
  }

  /** 解析单个 jsonl 会话文件为元信息;失败返回 null(不影响整体扫描) */
  private static async parseSessionFile(filePath: string): Promise<ClaudeSessionMeta | null> {
    try {
      const [stat, content] = await Promise.all([
        fs.stat(filePath),
        fs.readFile(filePath, 'utf-8'),
      ]);
      const lines = content.split('\n').filter(l => l.trim());
      const { title, cwd } = this.extractFromLines(lines);

      return {
        sessionId: path.basename(filePath, '.jsonl'),
        title,
        cwd,
        lastActiveAt: stat.mtime.toISOString(),
        messageCount: lines.length,
      };
    } catch {
      return null;
    }
  }

  /** 从 jsonl 行中提取首条 user 文本(作 title)与 cwd */
  private static extractFromLines(lines: string[]): { title: string; cwd: string } {
    let title = '(无标题)';
    let cwd = '';

    for (const line of lines) {
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }

      if (!cwd) {
        cwd = msg.cwd || msg.message?.cwd || '';
      }

      if (title === '(无标题)') {
        const role = msg.type || msg.message?.role;
        const text = this.extractText(msg.message?.content ?? msg.content);
        // 跳过 tool_result 等非用户主动输入的 user 消息
        if (role === 'user' && text) {
          title = text.slice(0, 60);
        }
      }

      if (cwd && title !== '(无标题)') break;
    }

    return { title, cwd };
  }

  /** 从消息 content(string 或 content blocks 数组)中提取纯文本 */
  private static extractText(content: any): string {
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
      return content
        .filter((b: any) => b.type === 'text' && typeof b.text === 'string')
        .map((b: any) => b.text)
        .join(' ')
        .trim();
    }
    return '';
  }
}
