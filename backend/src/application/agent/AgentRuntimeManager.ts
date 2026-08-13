// backend/src/application/agent/AgentRuntimeManager.ts
// 常驻 runtime 池管理:持有 RuntimeRegistry,提供 executeTurn / interrupt / dispose / GC 委托。
//
// 关键职责:
// - acquire:已知 sessionId→命中复用 / 未命中新建(并 resume 续接)/ 新会话→临时 key
// - 首 turn 后 rekey:临时 key(__pending__*)或 resume 传入 id → runtime 真实 sessionId
// - crash/dispose 后 evict:从注册表移除所有相关 key,下次 acquire 重建
// - GC:委托 RuntimeRegistry.cleanupStale(构造即启动 sweeper)
//
// 不负责同会话串行(由 #5 路由层 taskId mutex 保证);Manager 只管 runtime 池。
// 同 sessionId 并发 executeTurn 由 AgentRuntime 内部 turnChain 串行。
import type { Options, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, ImageAttachment } from '@ai-task-flow/shared';
import { AgentRuntime } from './AgentRuntime.js';
import { RuntimeRegistry } from './RuntimeRegistry.js';
import { buildSdkSpawnOptions, type AgentSide } from '../../utils/sdk-loader.js';
import { FileLogger } from '../../infrastructure/logging/FileLogger.js';

const logger = new FileLogger('agent-runtime-manager');

export interface ExecuteTurnParams {
  side: AgentSide;
  /** 已有 sessionId→命中复用 / 未命中新建并 resume 续接;缺省→新会话(首 turn 后 rekey) */
  sessionId?: string;
  cwd: string;
  text: string;
  /** 粘贴的图片(base64 数据 + MIME 类型) */
  images?: ImageAttachment[];
  onEvent: (event: AgentEvent) => void;
  /** 中断信号:abort 时 interrupt 当前 turn(进程不死,以中断态 result 正常 resolve);客户端断开 / 前端停止用 */
  signal?: AbortSignal;
  /** 额外 SDK options(allowedTools / mcpServers / settings 等,#4/#5 注入;resume 由本层按 sessionId 补) */
  sdkOptions?: Partial<Options>;
}

export interface ExecuteTurnResult {
  /** runtime 真实 sessionId(首 turn 后填充;上层据此持久化到 TaskSessionStore) */
  sessionId: string;
  result: SDKResultMessage;
}

interface RuntimeKey {
  side: AgentSide;
  id: string;
}

interface Acquired {
  runtime: AgentRuntime;
  key: RuntimeKey;
  isTemp: boolean;
}

export class AgentRuntimeManager {
  private readonly registry = new RuntimeRegistry();
  private tempSeq = 0;
  /** 并发 acquire 锁:同 key 的创建请求排队,防重复创建 runtime 进程泄漏 */
  private readonly pendingAcquires = new Map<string, Promise<AgentRuntime>>();

  constructor() {
    // 启动后台 GC sweeper(unref,进程退出不阻塞);常驻 runtime 池必须有回收机制防泄漏
    this.registry.startSweeper();
  }

  /** 执行一轮对话:acquire runtime → executeTurn → 首 turn rekey;runtime 不可用时 evict */
  async executeTurn(params: ExecuteTurnParams): Promise<ExecuteTurnResult> {
    const { runtime, key, isTemp } = await this.acquire(params.side, params.sessionId, params.cwd, params.sdkOptions);
    // 中断:signal abort → runtime.interrupt(进程不死,当前 turn 以中断态 result 正常 resolve,
    // runtime 仍在池中供下次复用)。覆盖客户端断开 / 前端停止(都是 abort fetch)。
    const onAbort = () => {
      void runtime.interrupt().catch((e) =>
        logger.warn('signal abort 后 interrupt 失败', {
          side: runtime.side,
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    };
    if (params.signal) {
      if (params.signal.aborted) onAbort();
      else params.signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const { result } = await runtime.executeTurn(params.text, params.onEvent, params.images);
      const realSessionId = runtime.sessionId;
      if (!realSessionId) throw new Error('turn 完成但 runtime 未拿到 sessionId(不应发生)');
      // rekey:临时 key 或 resume 传入 id 与 claude 实际 sessionId 不符 → 迁移到真实 sessionId
      if (isTemp || key.id !== realSessionId) {
        this.registry.delete(key.side, key.id);
        this.registry.set(runtime.side, realSessionId, runtime);
        logger.info('runtime rekey', { side: runtime.side, from: key.id, to: realSessionId });
      }
      return { sessionId: realSessionId, result };
    } catch (e) {
      // runtime 不可用(closed / sessionId 异常为 null):evict 所有相关 key,下次 acquire 重建
      if (runtime.closed || !runtime.sessionId) this.evictAll(runtime, key);
      throw e;
    } finally {
      if (params.signal) params.signal.removeEventListener('abort', onAbort);
    }
  }

  /** 类型安全地从注册表获取 AgentRuntime(封装 as 断言,单点维护) */
  private getRuntime(side: AgentSide, sessionId: string): AgentRuntime | undefined {
    const record = this.registry.get(side, sessionId);
    // 本 Manager 只往注册表存 AgentRuntime,故 record 必为 AgentRuntime 或 undefined
    return record as AgentRuntime | undefined;
  }

  /** 中断指定 runtime 的当前 turn(进程不死) */
  async interrupt(side: AgentSide, sessionId: string): Promise<void> {
    const runtime = this.getRuntime(side, sessionId);
    await runtime?.interrupt();
  }

  /** 显式释放指定 runtime(杀进程);从注册表移除 */
  async dispose(side: AgentSide, sessionId: string): Promise<void> {
    const runtime = this.getRuntime(side, sessionId);
    if (!runtime) return;
    await runtime.dispose();
    this.registry.delete(side, sessionId);
  }

  /** 回收过期/空闲 runtime(诊断 / 手动触发;后台 sweeper 自动调) */
  async cleanupStale(): Promise<number> {
    return this.registry.cleanupStale();
  }

  getSnapshot(): { windowsCount: number; wslCount: number; total: number } {
    return this.registry.getSnapshot();
  }

  /** 进程关闭:停 sweeper + dispose 所有 runtime */
  async shutdown(): Promise<void> {
    this.registry.stopSweeper();
    await this.registry.clear();
  }

  private async acquire(
    side: AgentSide,
    sessionId: string | undefined,
    cwd: string,
    sdkOptions: Partial<Options> | undefined,
  ): Promise<Acquired> {
    if (sessionId) {
      const existing = this.getRuntime(side, sessionId);
      if (existing) return { runtime: existing, key: { side, id: sessionId }, isTemp: false };
      // 未命中:新建并 resume 续接该 session(runtime 被 GC 过 / 进程重启后的恢复路径)
      // Promise-based 锁:同 key 并发 acquire 排队,防重复创建 runtime(孤儿进程泄漏)
      const lockKey = `resume:${side}:${sessionId}`;
      const runtime = await this.lockedCreate(lockKey, side, cwd, { ...sdkOptions, resume: sessionId });
      // 二次检查:等锁期间可能已有其他请求创建并注册(极罕见但防御)
      const recheck = this.getRuntime(side, sessionId);
      if (recheck) return { runtime: recheck, key: { side, id: sessionId }, isTemp: false };
      this.registry.set(side, sessionId, runtime);
      return { runtime, key: { side, id: sessionId }, isTemp: false };
    }
    // 新会话:临时 key,首 turn result 后 rekey 到 claude 分配的真实 sessionId
    const tempId = this.nextTempId();
    const runtime = await this.create(side, cwd, sdkOptions);
    this.registry.set(side, tempId, runtime);
    return { runtime, key: { side, id: tempId }, isTemp: true };
  }

  /** 带锁的 create:同 lockKey 并发调用排队,后续调用等第一个完成并复用其 runtime */
  private async lockedCreate(
    lockKey: string,
    side: AgentSide,
    cwd: string,
    sdkOptions: Partial<Options> | undefined,
  ): Promise<AgentRuntime> {
    const inflight = this.pendingAcquires.get(lockKey);
    if (inflight) return inflight;
    const promise = this.create(side, cwd, sdkOptions);
    this.pendingAcquires.set(lockKey, promise);
    try {
      return await promise;
    } finally {
      this.pendingAcquires.delete(lockKey);
    }
  }

  private async create(side: AgentSide, cwd: string, sdkOptions: Partial<Options> | undefined): Promise<AgentRuntime> {
    const spawnOpts = await buildSdkSpawnOptions(side, cwd);
    return new AgentRuntime({ side, cwd, spawnOpts, sdkOptions });
  }

  private nextTempId(): string {
    // pid + 自增:进程内唯一,避免与 claude UUID 冲突(__pending__ 前缀也不会撞)
    return `__pending__${process.pid}_${++this.tempSeq}`;
  }

  /** 从注册表移除 runtime 的所有相关 key(注册 key + 真实 sessionId,二者可能不同) */
  private evictAll(runtime: AgentRuntime, key: RuntimeKey): void {
    this.registry.delete(key.side, key.id);
    if (runtime.sessionId && runtime.sessionId !== key.id) {
      this.registry.delete(runtime.side, runtime.sessionId);
    }
  }
}
