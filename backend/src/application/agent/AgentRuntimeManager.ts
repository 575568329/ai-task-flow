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
import type { AgentEvent } from '@ai-task-flow/shared';
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
  onEvent: (event: AgentEvent) => void;
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

  constructor() {
    // 启动后台 GC sweeper(unref,进程退出不阻塞);常驻 runtime 池必须有回收机制防泄漏
    this.registry.startSweeper();
  }

  /** 执行一轮对话:acquire runtime → executeTurn → 首 turn rekey;runtime 不可用时 evict */
  async executeTurn(params: ExecuteTurnParams): Promise<ExecuteTurnResult> {
    const { runtime, key, isTemp } = await this.acquire(params.side, params.sessionId, params.cwd, params.sdkOptions);
    try {
      const { result } = await runtime.executeTurn(params.text, params.onEvent);
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
      // runtime 不可用(closed:crash / dispose / closed 前提前退出):evict 所有相关 key,下次 acquire 重建
      if (runtime.closed) this.evictAll(runtime, key);
      throw e;
    }
  }

  /** 中断指定 runtime 的当前 turn(进程不死) */
  async interrupt(side: AgentSide, sessionId: string): Promise<void> {
    const runtime = this.registry.get(side, sessionId) as AgentRuntime | undefined;
    await runtime?.interrupt();
  }

  /** 显式释放指定 runtime(杀进程);从注册表移除 */
  async dispose(side: AgentSide, sessionId: string): Promise<void> {
    const runtime = this.registry.get(side, sessionId) as AgentRuntime | undefined;
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
      const existing = this.registry.get(side, sessionId) as AgentRuntime | undefined;
      if (existing) return { runtime: existing, key: { side, id: sessionId }, isTemp: false };
      // 未命中:新建并 resume 续接该 session(runtime 被 GC 过 / 进程重启后的恢复路径)
      const runtime = await this.create(side, cwd, { ...sdkOptions, resume: sessionId });
      this.registry.set(side, sessionId, runtime);
      return { runtime, key: { side, id: sessionId }, isTemp: false };
    }
    // 新会话:临时 key,首 turn result 后 rekey 到 claude 分配的真实 sessionId
    const tempId = this.nextTempId();
    const runtime = await this.create(side, cwd, sdkOptions);
    this.registry.set(side, tempId, runtime);
    return { runtime, key: { side, id: tempId }, isTemp: true };
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
