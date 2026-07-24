// backend/src/application/usage/UsageService.ts
// Claude Code 终端会话 Token 用量聚合服务(用量面板后端核心)。
//
// 数据源:ClaudeSessionScanner 扫本机所有 Claude home 的 jsonl(已累加成 SessionUsage)。
// 本服务做两件事:
//   1. 缓存扫描结果(L1 staleness 60s + L2 按 sessionId mtime 增量),避免每次请求全盘读 jsonl;
//   2. 五维度聚合(模型/任务/项目/天/会话)+ cost(调 modelPricing.estimateCost)。

import { ClaudeSessionScanner } from '../../infrastructure/system/ClaudeSessionScanner.js';
import { estimateCost } from '../../infrastructure/llm/modelPricing.js';
import { FileLogger } from '../../infrastructure/logging/FileLogger.js';
import type {
  ClaudeSessionMeta,
  ModelAccum,
  TokenUsage,
  UsageSummary,
  UsageSummaryQuery,
  UsageModelRow,
  UsageTaskRow,
  UsageProjectRow,
  UsageDayRow,
  UsageSessionRow,
} from '@ai-task-flow/shared';

const logger = new FileLogger('usage');

/** L1 缓存 staleness 窗口:窗口内跳过扫描,直接复用上次全量结果 */
const STALE_MS = 60_000;

function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0, cacheReadTokens: 0 };
}

/** 把 src 累加进 target(原地修改 target) */
function addUsage(target: TokenUsage, src: TokenUsage): void {
  target.inputTokens += src.inputTokens;
  target.outputTokens += src.outputTokens;
  target.cacheCreation5mTokens += src.cacheCreation5mTokens;
  target.cacheCreation1hTokens += src.cacheCreation1hTokens;
  target.cacheReadTokens += src.cacheReadTokens;
}

/** ISO timestamp → 本地日期 YYYY-MM-DD(matchesQuery 的 from/to 比对用) */
function localDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return d.toLocaleDateString('en-CA');
}

export class UsageService {
  /** L2:sessionId → {mtimeMs, meta} 缓存,只重新解析 mtime 变化的文件 */
  private readonly fileCache = new Map<string, { mtimeMs: number; meta: ClaudeSessionMeta }>();
  /** L1:全量会话结果 + 扫描时间,窗口内直接复用 */
  private allCache: { metas: ClaudeSessionMeta[]; scannedAt: number } | null = null;

  /** 用量聚合(面板主接口):全量扫描 → 按 query 过滤 → 五维度聚合 + cost */
  async getSummary(query: UsageSummaryQuery): Promise<UsageSummary> {
    const sessions = await this.getAllSessions();
    const filtered = sessions.filter(s => this.matchesQuery(s, query));
    return this.aggregate(filtered);
  }

  /** 取全量会话(L1 staleness 命中直接返回,否则 L2 增量扫描) */
  private async getAllSessions(): Promise<ClaudeSessionMeta[]> {
    if (this.allCache && Date.now() - this.allCache.scannedAt < STALE_MS) {
      return this.allCache.metas;
    }
    const metas = await this.scanIncremental();
    this.allCache = { metas, scannedAt: Date.now() };
    return metas;
  }

  /**
   * L2 增量扫描:list 所有 jsonl 的 mtime,与缓存比对——
   * mtime 未变的复用缓存 meta,变化的调 parseSessionFile 重新解析,消失的从缓存删除。
   * 避免每次请求都全量读所有 jsonl(WSL 跨界 IO 慢)。
   */
  private async scanIncremental(): Promise<ClaudeSessionMeta[]> {
    const files = await ClaudeSessionScanner.listAllSessionFiles();
    const liveIds = new Set<string>();
    const metas: ClaudeSessionMeta[] = [];
    let reused = 0;

    for (const f of files) {
      liveIds.add(f.sessionId);
      const cached = this.fileCache.get(f.sessionId);
      if (cached && cached.mtimeMs === f.mtimeMs) {
        metas.push(cached.meta); // mtime 未变,复用
        reused++;
        continue;
      }
      const meta = await ClaudeSessionScanner.parseSessionFile(f.filePath);
      if (meta) {
        this.fileCache.set(f.sessionId, { mtimeMs: f.mtimeMs, meta });
        metas.push(meta);
      }
    }
    // 清理已删除会话的缓存(防内存泄漏)
    for (const id of [...this.fileCache.keys()]) {
      if (!liveIds.has(id)) this.fileCache.delete(id);
    }

    logger.info('scanIncremental', { total: metas.length, reused, reparsed: metas.length - reused });
    return metas;
  }

  /** 会话是否匹配查询过滤(project/taskId/from/to) */
  private matchesQuery(s: ClaudeSessionMeta, q: UsageSummaryQuery): boolean {
    if (q.project && s.cwd !== q.project) return false;
    if (q.taskId && s.usage?.taskId !== q.taskId) return false;
    if (q.from || q.to) {
      const day = localDay(s.lastActiveAt);
      if (q.from && day < q.from) return false;
      if (q.to && day > q.to) return false;
    }
    return true;
  }

  /** 五维度聚合(纯函数,便于单测) */
  private aggregate(sessions: ClaudeSessionMeta[]): UsageSummary {
    const modelMap = new Map<string, UsageModelRow>();
    const taskMap = new Map<string, UsageTaskRow>();
    const projectMap = new Map<string, UsageProjectRow>();
    const dayMap = new Map<string, UsageDayRow>();
    const bySession: UsageSessionRow[] = [];

    let totalInput = 0, totalOutput = 0, totalCache5m = 0, totalCache1h = 0, totalCacheRead = 0;
    let totalCost = 0, totalRequests = 0;

    for (const s of sessions) {
      const u = s.usage;
      if (!u) continue;
      const cost = this.sessionCost(u.byModel);

      // byModel(按模型,精确 requestCount)
      for (const [model, mu] of Object.entries(u.byModel)) {
        const row = modelMap.get(model) ?? { model, ...emptyUsage(), cost: 0, requestCount: 0 };
        addUsage(row, mu);
        row.requestCount += mu.requests;
        modelMap.set(model, row);
      }

      // byTask(按任务,有 taskId 才纳入)
      if (u.taskId) {
        const row = taskMap.get(u.taskId) ?? { taskId: u.taskId, ...emptyUsage(), cost: 0, requestCount: 0, sessionCount: 0 };
        addUsage(row, u.total);
        row.cost += cost;
        row.requestCount += u.assistantCount;
        row.sessionCount += 1;
        taskMap.set(u.taskId, row);
      }

      // byProject(按 cwd 仓库路径,与看板任务 projectName 天然对应)
      if (s.cwd) {
        const row = projectMap.get(s.cwd) ?? { project: s.cwd, ...emptyUsage(), cost: 0, requestCount: 0, sessionCount: 0 };
        addUsage(row, u.total);
        row.cost += cost;
        row.requestCount += u.assistantCount;
        row.sessionCount += 1;
        projectMap.set(s.cwd, row);
      }

      // byDay(按本地日期,跨模型合计 token;按模型拆 cost 保证单价准确)
      for (const [day, models] of Object.entries(u.byDay)) {
        const row = dayMap.get(day) ?? { date: day, ...emptyUsage(), cost: 0, requestCount: 0 };
        for (const [model, du] of Object.entries(models)) {
          addUsage(row, du);
          row.requestCount += du.requests;
          row.cost += estimateCost(model, du) ?? 0;
        }
        dayMap.set(day, row);
      }

      // bySession(每会话一行)
      bySession.push({
        sessionId: s.sessionId,
        title: s.title,
        taskId: u.taskId,
        source: s.source,
        lastActiveAt: s.lastActiveAt,
        ...u.total,
        cost,
        requestCount: u.assistantCount,
      });

      // total
      totalInput += u.total.inputTokens;
      totalOutput += u.total.outputTokens;
      totalCache5m += u.total.cacheCreation5mTokens;
      totalCache1h += u.total.cacheCreation1hTokens;
      totalCacheRead += u.total.cacheReadTokens;
      totalCost += cost;
      totalRequests += u.assistantCount;
    }

    // byModel 各行 cost(单模型,按行 token 直接算)
    for (const row of modelMap.values()) {
      row.cost = estimateCost(row.model, row) ?? 0;
    }
    // byDay 各行 cost 收尾 round(累加过程保留精度)
    for (const row of dayMap.values()) {
      row.cost = Math.round(row.cost * 1e6) / 1e6;
    }

    const byCostDesc = <T extends { cost: number }>(a: T, b: T) => b.cost - a.cost;

    return {
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCacheCreationTokens: totalCache5m + totalCache1h,
      totalCacheReadTokens: totalCacheRead,
      totalCost: Math.round(totalCost * 1e6) / 1e6,
      totalRequests,
      byModel: Array.from(modelMap.values()).sort(byCostDesc),
      byTask: Array.from(taskMap.values()).sort(byCostDesc),
      byProject: Array.from(projectMap.values()).sort(byCostDesc),
      byDay: Array.from(dayMap.values()).sort((a, b) => b.date.localeCompare(a.date)),
      bySession: bySession.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt)),
    };
  }

  /** 单会话 cost:按模型拆(不同模型单价不同),Σ estimateCost(model, ModelAccum) */
  private sessionCost(byModel: Record<string, ModelAccum>): number {
    let sum = 0;
    for (const [model, mu] of Object.entries(byModel)) {
      sum += estimateCost(model, mu) ?? 0;
    }
    return Math.round(sum * 1e6) / 1e6;
  }
}
