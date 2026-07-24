// backend/src/infrastructure/system/ClaudeSessionScanner.ts
// 扫描本机所有 Claude home(Windows %USERPROFILE% + WSL \\wsl.localhost\)下的 projects/<encoded>/*.jsonl,
// 提取历史 Claude 会话元信息 + Token 用量,供 OpenClaudeDialog 的"恢复历史会话"列表 & 用量面板使用。
//
// Claude Code 每个会话存为一个 <sessionId>.jsonl,每行一条消息对象(JSON Lines)。我们提取:
//   - sessionId(文件名)、首条 user 文本(作 title)、cwd(行内记录)、lastActiveAt(mtime)、messageCount
//   - usage:遍历全会所有 assistant 行累加 message.usage,同时按模型 / 按本地日期分桶,含缓存 5m/1h 拆分
//   - taskId:扫 user 行(get_task 的 tool_result)里的 <!-- ai-task-flow: task=xxx --> 标记,取众数

import fs from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';
import os from 'os';
import { encodeProjectPath, toWslPath } from './pathCodec.js';
import type { ClaudeSessionMeta, ModelAccum, SessionUsage, TokenUsage, ChatTurn, ChatBlock } from '@ai-task-flow/shared';

/** 诊断日志开关:scan 命中数等默认静默,DEBUG_AI_TASK_FLOW=1 时打印,避免常态刷屏(IM3) */
const DEBUG_SCAN = !!process.env.DEBUG_AI_TASK_FLOW;
function debugLog(...args: unknown[]): void {
  if (DEBUG_SCAN) console.log(...args);
}

/** 空用量块(累加起点) */
function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0, cacheReadTokens: 0 };
}

// ── jsonl 时间线解析的最小类型(替代 any) ──────────────────────────────────
// Claude Code 的 stream-json 行结构松散,这里只声明 loadTimeline 用到的字段。
interface ClaudeToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: unknown;
  is_error?: boolean;
}
interface ClaudeContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}
interface ClaudeTimelineMessage {
  role?: string;
  content?: ClaudeContentBlock[];
}
interface ClaudeTimelineLine {
  type?: string;
  message?: ClaudeTimelineMessage;
  role?: string;
  content?: ClaudeContentBlock[];
}

/** 把单条 assistant message 的 usage 累加进 target(cache_creation 拆 5m 默认 / 1h) */
function accumulateUsage(target: TokenUsage, message: any): void {
  const u = message.usage;
  const cacheTotal = u.cache_creation_input_tokens ?? 0;
  const cache1h = message.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  // 剩余(5m + 无 TTL)统一按 5m 计费(无 TTL 极少见,影响可忽略)
  const cache5m = Math.max(0, cacheTotal - cache1h);
  target.inputTokens += u.input_tokens ?? 0;
  target.outputTokens += u.output_tokens ?? 0;
  target.cacheCreation5mTokens += cache5m;
  target.cacheCreation1hTokens += cache1h;
  target.cacheReadTokens += u.cache_read_input_tokens ?? 0;
}

/** ISO timestamp → 本地日期 YYYY-MM-DD(用量「按天」维度;以后端运行时区为准) */
function localDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return d.toLocaleDateString('en-CA'); // en-CA 输出 YYYY-MM-DD
}

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
    debugLog(`[ClaudeSessionScanner] WSL distros: ${cachedWslDistros.join(', ')}`);
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
 * 自动发现 distro/user,无需硬编码。
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

    // ② WSL 各 distro:wsl 内 Claude 产生的会话
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
 * 根据会话 cwd 推断来源(供前端按 cmd/wsl 过滤 & 用量面板挂 WSL/Win 小标签)。
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
   * 并遍历本机所有 Claude home:Windows %USERPROFILE% 侧(cmd/pwsh 会话)
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
    debugLog(
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
            byId.set(meta.sessionId, meta); // source 已在 parseSessionFile 内推断
          }
        }
      }
    }

    const result = Array.from(byId.values()).sort((a, b) =>
      b.lastActiveAt.localeCompare(a.lastActiveAt)
    );
    debugLog(`[ClaudeSessionScanner] scan 命中 ${result.length} 个会话`);
    return result;
  }

  /**
   * 扫描本机所有 Claude home 下「所有项目」的历史会话(用量面板用)。
   *
   * 与 scan(repoPath) 的区别:不限单个 repoPath,遍历每个 home 下所有 encoded 项目目录,
   * 全量收集会话元信息(含 usage)。用量面板的「按项目/按任务/按模型」维度都依赖此全量视图。
   * 首次扫描较慢(全盘 jsonl),UsageService 用会话级缓存(staleness + mtime)避免每次请求都扫。
   *
   * @returns 按 sessionId 去重后的会话列表(不含排序,由调用方按需排)
   */
  static async scanAllProjects(): Promise<ClaudeSessionMeta[]> {
    const claudeDirs = resolveAllClaudeDirs();
    const byId = new Map<string, ClaudeSessionMeta>();

    for (const projectsRoot of claudeDirs) {
      let projectDirs: string[];
      try {
        projectDirs = await fs.readdir(projectsRoot);
      } catch {
        // 该 home 无 projects 目录,跳过
        continue;
      }

      for (const projectDir of projectDirs) {
        const dir = path.join(projectsRoot, projectDir);
        let files: string[];
        try {
          files = await fs.readdir(dir);
        } catch {
          continue;
        }

        for (const file of files.filter(f => f.endsWith('.jsonl'))) {
          const meta = await this.parseSessionFile(path.join(dir, file));
          if (meta && !byId.has(meta.sessionId)) {
            byId.set(meta.sessionId, meta); // source 已在 parseSessionFile 内推断
          }
        }
      }
    }

    debugLog(`[ClaudeSessionScanner] scanAllProjects 命中 ${byId.size} 个会话`);
    return Array.from(byId.values());
  }

  /** 解析单个 jsonl 会话文件为元信息(含用量);失败返回 null(不影响整体扫描)。
   *  public:供 UsageService 做 mtime 增量缓存——比对的文件才重新解析,避免全盘每次全读。 */
  static async parseSessionFile(filePath: string): Promise<ClaudeSessionMeta | null> {
    try {
      const [stat, content] = await Promise.all([
        fs.stat(filePath),
        fs.readFile(filePath, 'utf-8'),
      ]);
      const lines = content.split('\n').filter(l => l.trim());
      const { title, cwd, usage } = this.parseSessionMeta(lines);

      return {
        sessionId: path.basename(filePath, '.jsonl'),
        title,
        cwd,
        lastActiveAt: stat.mtime.toISOString(),
        messageCount: lines.length,
        usage,
        source: inferSessionSource(cwd),
      };
    } catch {
      return null;
    }
  }

  /**
   * 定位某 repoPath + sessionId 对应的 jsonl 文件(跨 Windows/WSL 两个 home、两种路径编码)。
   * 用于「加载历史会话时间线」:前端选中某历史会话后,据此找文件解析。
   */
  static async findSessionFile(repoPath: string, sessionId: string): Promise<string | null> {
    // 安全:sessionId 来自 URL param,直接拼 `${sessionId}.jsonl` 会路径穿越(../../foo 读任意 jsonl)。
    // claude sessionId 是 UUID 形态,只允许字母数字与连字符(S8)
    if (!/^[A-Za-z0-9-]+$/.test(sessionId)) return null;
    const dirNameCandidates = new Set<string>([
      encodeProjectPath(repoPath),
      encodeProjectPath(toWslPath(repoPath)),
    ]);
    for (const projectsRoot of resolveAllClaudeDirs()) {
      for (const dirName of dirNameCandidates) {
        const candidate = path.join(projectsRoot, dirName, `${sessionId}.jsonl`);
        if (existsSync(candidate)) return candidate;
      }
    }
    return null;
  }

  /**
   * 解析某历史会话 jsonl 为前端可渲染的 turns/blocks(与实时流归一化形态一致)。
   * 只保留 user 真实文本 + assistant 回复;tool_result 回填到对应 tool_use(按 id)。
   * 系统注入行(<local-command-...> 等)不计为用户消息。
   */
  static async loadTimeline(repoPath: string, sessionId: string): Promise<ChatTurn[] | null> {
    const filePath = await this.findSessionFile(repoPath, sessionId);
    if (!filePath) return null;
    const content = await fs.readFile(filePath, 'utf-8');
    const turns: ChatTurn[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let msg: ClaudeTimelineLine;
      try {
        msg = JSON.parse(line) as ClaudeTimelineLine;
      } catch {
        continue;
      }
      const message = msg.message ?? msg;
      const role = msg.type || message?.role;
      const blocks0: ClaudeContentBlock[] = Array.isArray(message?.content) ? message.content : [];

      if (role === 'assistant') {
        const blocks: ChatBlock[] = [];
        for (const b of blocks0) {
          if (b.type === 'text' && typeof b.text === 'string') {
            const last = blocks[blocks.length - 1];
            if (last && last.kind === 'text') last.text += b.text;
            else blocks.push({ kind: 'text', text: b.text });
          } else if (b.type === 'thinking' && typeof b.thinking === 'string') {
            const last = blocks[blocks.length - 1];
            if (last && last.kind === 'thinking') last.thinking += b.thinking;
            else blocks.push({ kind: 'thinking', thinking: b.thinking });
          } else if (b.type === 'tool_use' && typeof b.id === 'string') {
            blocks.push({
              kind: 'tool_use',
              id: b.id,
              name: typeof b.name === 'string' ? b.name : 'tool',
              input: b.input,
            });
          }
        }
        if (blocks.length > 0) turns.push({ id: `${turns.length}-a`, role: 'assistant', blocks });
      } else if (role === 'user') {
        // tool_result:回填到最近的同名 tool_use
        const toolResults = blocks0.filter((b): b is ClaudeToolResultBlock => b.type === 'tool_result');
        for (const tr of toolResults) {
          const text = this.collectAllText(tr.content);
          const target = this.findLastToolUse(turns, tr.tool_use_id);
          if (target) target.result = { content: text, isError: tr.is_error === true };
        }
        // user 行若同时含真实文本(非纯 tool_result),作为用户消息
        const userText = this.extractText(message?.content);
        if (userText && !this.isSystemInjection(userText)) {
          turns.push({ id: `${turns.length}-u`, role: 'user', text: userText });
        }
      }
    }
    return turns;
  }

  /** 在 turns 里按 tool_use_id 找最后一个匹配的 tool_use 块(回填 result 用) */
  private static findLastToolUse(turns: ChatTurn[], id: string): Extract<ChatBlock, { kind: 'tool_use' }> | undefined {
    for (let i = turns.length - 1; i >= 0; i--) {
      const t = turns[i];
      if (!t.blocks) continue;
      for (let j = t.blocks.length - 1; j >= 0; j--) {
        const b = t.blocks[j];
        if (b.kind === 'tool_use' && b.id === id) return b;
      }
    }
    return undefined;
  }

  /**
   * 列出所有 Claude home 下「所有项目」的 jsonl 文件(仅 stat,不解析内容)。
   * 供 UsageService 做 mtime 增量:比对该列表的 mtimeMs,只对变化的文件调 parseSessionFile,
   * 未变的复用缓存——避免每次请求都全量读所有 jsonl(WSL 跨界 IO 慢)。
   */
  static async listAllSessionFiles(): Promise<Array<{ filePath: string; sessionId: string; mtimeMs: number }>> {
    const claudeDirs = resolveAllClaudeDirs();
    const out: Array<{ filePath: string; sessionId: string; mtimeMs: number }> = [];

    for (const projectsRoot of claudeDirs) {
      let projectDirs: string[];
      try {
        projectDirs = await fs.readdir(projectsRoot);
      } catch {
        continue;
      }
      for (const projectDir of projectDirs) {
        const dir = path.join(projectsRoot, projectDir);
        let files: string[];
        try {
          files = await fs.readdir(dir);
        } catch {
          continue;
        }
        for (const file of files.filter(f => f.endsWith('.jsonl'))) {
          const filePath = path.join(dir, file);
          try {
            const stat = await fs.stat(filePath);
            out.push({ filePath, sessionId: file.replace(/\.jsonl$/, ''), mtimeMs: stat.mtimeMs });
          } catch {
            // 文件在 stat 前被删,跳过
          }
        }
      }
    }
    return out;
  }

  /**
   * 一遍遍历 jsonl 行,同时提取:标题、cwd、用量(按模型 + 按本地日期累加)、关联任务标记。
   *
   * 标题优先级(高→低):
   *   1. Claude Code 记录的「用户命名会话名」(<system-reminder> The user named this session "xxx".)
   *   2. 首条「真实」user 文本(跳过 < 开头的系统注入;tool_result 无顶层 text 块,extractText 自然取不到)。
   *
   * 用量累加:每条 assistant 行的 message.usage 同时累加进 byModel(按模型)与 byDay(按本地日期),
   *   cache_creation 拆 5m(默认)/1h(ephemeral_1h)——1h×2、其余×1.25 计费。
   *
   * 任务标记:扫 user 行 tool_result 里的 <!-- ai-task-flow: task=xxx -->,取出现最多的主任务。
   *
   * 注意:不再像旧版"拿到命名+cwd 就 break"——用量/任务标记必须扫全会,故遍历到底。
   */
  private static parseSessionMeta(lines: string[]): { title: string; cwd: string; usage: SessionUsage } {
    let title = '(无标题)';
    let namedTitle = '';
    let cwd = '';

    const byModel: Record<string, ModelAccum> = {};
    const byDay: Record<string, Record<string, ModelAccum>> = {};
    const taskIdCounts: Record<string, number> = {};
    let assistantCount = 0;

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

      const message = msg.message ?? msg;
      const role = msg.type || message?.role;

      // 累加 assistant 行 usage(同时按模型 + 按本地日期分桶)
      if (role === 'assistant' && message?.usage) {
        const model = message.model ?? 'unknown';
        const day = msg.timestamp ? localDay(msg.timestamp) : 'unknown';
        if (!byModel[model]) byModel[model] = { ...emptyUsage(), requests: 0 };
        if (!byDay[day]) byDay[day] = {};
        if (!byDay[day][model]) byDay[day][model] = { ...emptyUsage(), requests: 0 };
        accumulateUsage(byModel[model], message);
        accumulateUsage(byDay[day][model], message);
        byModel[model].requests++;
        byDay[day][model].requests++;
        assistantCount++;
      }

      // 扫 user 行(get_task 的 tool_result)里的任务标记
      if (role === 'user') {
        const fullText = this.collectAllText(message?.content ?? msg.content);
        const m = fullText.match(/ai-task-flow:\s*task=([A-Z0-9-]+)/i);
        if (m) {
          taskIdCounts[m[1]] = (taskIdCounts[m[1]] ?? 0) + 1;
        }
      }

      // 标题提取(仅顶层 text 块;tool_result 不当标题)
      const text = this.extractText(message?.content ?? msg.content);
      if (!namedTitle) {
        namedTitle = this.extractSessionName(text);
      }
      if (title === '(无标题)' && role === 'user' && text && !this.isSystemInjection(text)) {
        title = text.slice(0, 60);
      }
    }

    // 汇总会话总计(各模型之和)
    const total = emptyUsage();
    for (const m of Object.values(byModel)) {
      total.inputTokens += m.inputTokens;
      total.outputTokens += m.outputTokens;
      total.cacheCreation5mTokens += m.cacheCreation5mTokens;
      total.cacheCreation1hTokens += m.cacheCreation1hTokens;
      total.cacheReadTokens += m.cacheReadTokens;
    }

    return {
      title: namedTitle || title,
      cwd,
      usage: { byModel, byDay, total, assistantCount, taskId: this.modeKey(taskIdCounts) },
    };
  }

  /**
   * 递归收集消息 content 里所有 text 字符串(含 tool_result.content 嵌套)。
   * 任务标记注入在 get_task 返回的 markdown 里,作为 tool_result 的 text 出现——
   * extractText 只扫顶层 text 块取不到它,故这里递归拍平。
   */
  private static collectAllText(content: any): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((b: any) => {
          if (typeof b === 'string') return b;
          if (b?.type === 'text' && typeof b.text === 'string') return b.text;
          if (b?.type === 'tool_result') return this.collectAllText(b.content);
          return '';
        })
        .join('\n');
    }
    return '';
  }

  /** 取计数字典里出现最多的 key(任务关联用,一会话多任务时取主任务) */
  private static modeKey(counts: Record<string, number>): string | undefined {
    let best: string | undefined;
    let bestN = 0;
    for (const [k, n] of Object.entries(counts)) {
      if (n > bestN) {
        best = k;
        bestN = n;
      }
    }
    return best;
  }

  /** 从消息 content(string 或 content blocks 数组)中提取纯文本(仅顶层 text 块) */
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

  /**
   * 从 system-reminder 文本中提取用户命名的会话名。
   * 匹配 Claude Code 写入格式:`The user named this session "xxx".`
   */
  private static extractSessionName(text: string): string {
    const match = text.match(/The user named this session "([^"]+)"/);
    return match ? match[1].trim() : '';
  }

  /**
   * 判断 user 消息文本是否为系统注入(非真实用户输入)。
   * Claude Code 用 < 标签包裹注入:<local-command-caveat>、<system-reminder>、
   * <command-name> 等。我们的任务标记 <!-- ai-task-flow: ... --> 同样 < 开头,
   * 会被当作注入跳过标题提取(符合预期:它不是标题),但任务标记扫描在 collectAllText 里单独做,不受此影响。
   */
  private static isSystemInjection(text: string): boolean {
    return /^\s*</.test(text);
  }
}
