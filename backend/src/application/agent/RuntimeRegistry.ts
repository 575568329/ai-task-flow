// backend/src/application/agent/RuntimeRegistry.ts
// 常驻 runtime 注册表:按 (side, sessionId) 双池管理 runtime,GC 回收过期/空闲,closed 用 unref sweeper。
//
// runtime 的具体形态(SDK query / 进程)由 #3 AgentRuntime 实现;本注册表只依赖 RuntimeRecord
// (GC 关心的字段 + dispose),不耦合 SDK。生命周期常量抄 jetbrains-cc-gui runtime-registry.js(:7-10),
// 按单机调小。Windows / WSL 两套独立 runtime 池(两个不同 claude 进程,绝不共享)。
import { FileLogger } from '../../infrastructure/logging/FileLogger.js';

const logger = new FileLogger('runtime-registry');

/** 绝对寿命:超过即回收(无论是否活跃),防累积泄漏 */
export const RUNTIME_MAX_ABSOLUTE_LIFETIME_MS = 6 * 60 * 60 * 1000; // 6h
/** 空闲回收:无活跃 turn 且超过此空闲时长则回收 */
export const RUNTIME_MAX_IDLE_MS = 30 * 60 * 1000; // 30min
/** 后台 sweeper 扫描间隔 */
export const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5min

/**
 * 注册表存储的 runtime 记录:GC 关心的字段 + dispose。
 * #3 的 AgentRuntime 实现本接口(额外含 SDK query / inputStream)。
 */
export interface RuntimeRecord {
  /** claude session id;新 session 首次 query 前为 null(Manager 用临时 signature 注册,result 后 rekey) */
  sessionId: string | null;
  side: 'windows' | 'wsl';
  createdAt: number;
  lastUsedAt: number;
  /** 正在进行的 turn 数;> 0 不回收(避免中断活跃会话) */
  activeTurnCount: number;
  closed: boolean;
  /** 关闭底层 SDK query / 进程;必须幂等(重复调用安全) */
  dispose(): Promise<void>;
}

const keyOf = (side: string, sessionId: string): string => `${side}:${sessionId}`;

/**
 * 判断 runtime 是否应被 GC 回收(纯函数,便于单测)。
 * 回收条件(任一):已 closed / 超绝对寿命 / 无活跃 turn 且空闲超期。
 */
export function isStale(record: RuntimeRecord, now: number): boolean {
  if (record.closed) return true;
  if (now - record.createdAt > RUNTIME_MAX_ABSOLUTE_LIFETIME_MS) return true;
  if (record.activeTurnCount === 0 && now - record.lastUsedAt > RUNTIME_MAX_IDLE_MS) return true;
  return false;
}

export class RuntimeRegistry {
  private runtimes = new Map<string, RuntimeRecord>();
  private sweeper: NodeJS.Timeout | null = null;

  get(side: 'windows' | 'wsl', sessionId: string): RuntimeRecord | undefined {
    return this.runtimes.get(keyOf(side, sessionId));
  }

  set(side: 'windows' | 'wsl', sessionId: string, record: RuntimeRecord): void {
    this.runtimes.set(keyOf(side, sessionId), record);
  }

  delete(side: 'windows' | 'wsl', sessionId: string): void {
    this.runtimes.delete(keyOf(side, sessionId));
  }

  /** 更新 lastUsedAt(turn 开始 / 事件到达时调) */
  touch(record: RuntimeRecord, now: number = Date.now()): void {
    record.lastUsedAt = now;
  }

  /** 回收所有过期 runtime,返回回收数 */
  async cleanupStale(now: number = Date.now()): Promise<number> {
    // 用 map 的真实 key 驱逐(而非从 record.sessionId 推算):二者语义上应一致,但 Registry 用 map key
    // 更健壮——不受调用方 record.sessionId 与 set 时传入 sessionId 不一致的干扰
    const expired: Array<[string, RuntimeRecord]> = [];
    for (const [key, record] of this.runtimes) {
      if (isStale(record, now)) expired.push([key, record]);
    }
    for (const [key, record] of expired) {
      await this.evict(key, record);
    }
    if (expired.length > 0) {
      logger.info('GC 回收 runtime', { count: expired.length, remaining: this.runtimes.size });
    }
    return expired.length;
  }

  /** 驱逐:dispose + 移除(dispose 失败不阻塞回收,只记日志——避免坏 runtime 卡住 GC) */
  private async evict(key: string, record: RuntimeRecord): Promise<void> {
    try {
      await record.dispose();
    } catch (e) {
      logger.warn('runtime dispose 失败,仍从注册表移除', {
        key,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    this.runtimes.delete(key);
  }

  /** 启动后台 sweeper(每 SWEEP_INTERVAL_MS 跑一次 cleanupStale);unref 不阻塞进程退出 */
  startSweeper(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => {
      this.cleanupStale().catch((e) =>
        logger.warn('sweeper cleanupStale 失败', { error: e instanceof Error ? e.message : String(e) }),
      );
    }, SWEEP_INTERVAL_MS);
    // unref:进程退出时不被这个 timer 拖住(单机服务,无人值守退出要干脆)
    this.sweeper.unref();
  }

  stopSweeper(): void {
    if (this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = null;
    }
  }

  /** sweeper 是否在跑(测试 / 诊断用) */
  get isSweeping(): boolean {
    return this.sweeper !== null;
  }

  getSnapshot(): { windowsCount: number; wslCount: number; total: number } {
    let windowsCount = 0;
    let wslCount = 0;
    for (const r of this.runtimes.values()) {
      if (r.side === 'windows') windowsCount++;
      else wslCount++;
    }
    return { windowsCount, wslCount, total: this.runtimes.size };
  }

  /** 全量清空(进程关闭时):dispose 所有 runtime */
  async clear(): Promise<void> {
    const all = [...this.runtimes.values()];
    this.runtimes.clear();
    await Promise.all(
      all.map((r) =>
        r.dispose().catch((e) =>
          logger.warn('clear 时 dispose 失败', { error: e instanceof Error ? e.message : String(e) }),
        ),
      ),
    );
  }
}
