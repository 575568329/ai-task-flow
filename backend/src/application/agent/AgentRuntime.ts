// backend/src/application/agent/AgentRuntime.ts
// 常驻对话 runtime:封装一个长期存活的 SDK query(streaming-input 模式),实现 RuntimeRecord。
//
// 模式(经 spike/runtime-persistent 实测三假设成立):
// - 单次 query({ prompt: inputStream }) 常驻;executeTurn 时 push 一条 user message,turn 间不 end
// - query 输出流由唯一 consumeLoop 消费,routeMessage 路由:result→resolve 当前 turn,其余→onEvent
// - interrupt():query.interrupt() 只中断当前 turn,进程不死(再发消息仍能收到 result)
// - dispose():inputStream.end() + query.close() 杀进程,幂等
//
// 串行:同一 runtime 同时只跑一个 turn(turnChain 排队)。activeTurnCount 串行下至多 1。
// pending 生命周期由 consumeLoop(resolve)/dispose(reject)/crash(reject)唯一管理;
// runTurn 的 .finally 只调 activeTurnCount-- / touch,绝不碰 pending(否则误清下一个 turn)。
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Options, Query, SDKResultMessage, SDKUserMessage, Settings } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, ImageAttachment } from '@ai-task-flow/shared';
import { PushableInputStream } from './PushableInputStream.js';
import { routeMessage } from './routeMessage.js';
import { withCleanSettings } from './cleanSettings.js';
import type { SdkSpawnOptions, AgentSide } from '../../utils/sdk-loader.js';
import type { RuntimeRecord } from './RuntimeRegistry.js';
import { FileLogger } from '../../infrastructure/logging/FileLogger.js';

const logger = new FileLogger('agent-runtime');

const userMsg = (text: string, images?: ImageAttachment[]): SDKUserMessage => {
  if (!images || images.length === 0) {
    return {
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
    };
  }
  // 多图片:content 数组,[text, image1, image2, ...]
  // media_type 强制转为 SDK 要求的字面量联合类型(上游已校验 MIME)
  type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  const content = [
    { type: 'text' as const, text },
    ...images.map((img) => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: img.mediaType as ImageMediaType, data: img.data },
    })),
  ];
  return {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
  };
};

export interface AgentRuntimeOptions {
  side: AgentSide;
  cwd: string;
  spawnOpts: SdkSpawnOptions;
  /** 额外 SDK options(allowedTools / mcpServers / resume / settings 等,#4/#5 注入) */
  sdkOptions?: Partial<Options>;
}

/** executeTurn 的返回:本 turn 的 result(含 session_id / subtype / is_error;interrupt 后 subtype=error_during_execution) */
export interface TurnResult {
  result: SDKResultMessage;
}

interface PendingTurn {
  onEvent: (event: AgentEvent) => void;
  resolve: (t: TurnResult) => void;
  reject: (e: Error) => void;
}

export class AgentRuntime implements RuntimeRecord {
  // —— RuntimeRecord 字段(GC 关心)——
  sessionId: string | null = null;
  readonly side: AgentSide;
  readonly createdAt: number;
  lastUsedAt: number;
  activeTurnCount = 0;
  closed = false;

  readonly cwd: string;
  private readonly inputStream: PushableInputStream;
  private readonly queryHandle: Query;
  /** 后台消费循环的 Promise(用于诊断/等待收尾);构造时启动,不 await */
  private readonly consumePromise: Promise<void>;

  /** 当前进行中的 turn;串行下至多一个 */
  private pending: PendingTurn | null = null;
  /** turn 串行链:前一个 turn settle 后才跑下一个 */
  private turnChain: Promise<void> = Promise.resolve();
  /** turn 序号(诊断:关联每轮日志,排查"第几轮慢") */
  private turnSeq = 0;

  constructor(opts: AgentRuntimeOptions) {
    this.side = opts.side;
    this.cwd = opts.cwd;
    const now = Date.now();
    this.createdAt = now;
    this.lastUsedAt = now;

    this.inputStream = new PushableInputStream();
    // clean settings(SDK flag 层)覆盖 superpowers hooks/permissions,隔离 SessionStart 注入;
    // 保留 settingSources 默认(全读,含 CLAUDE.md)。调用方 sdkOptions.settings 经 withCleanSettings 合并。
    const userSettings = opts.sdkOptions?.settings;
    const settings: string | Settings =
      typeof userSettings === 'string' ? userSettings : withCleanSettings(userSettings);
    const options: Options = {
      includePartialMessages: true,
      cwd: opts.spawnOpts.cwd,
      spawnClaudeCodeProcess: opts.spawnOpts.spawnClaudeCodeProcess,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      ...opts.sdkOptions,
      settings,
    };
    this.queryHandle = query({ prompt: this.inputStream, options });
    this.consumePromise = this.runConsumeLoop();
    logger.info('runtime 创建', { side: this.side, cwd: this.cwd });
  }

  touch(now: number = Date.now()): void {
    this.lastUsedAt = now;
  }

  /**
   * 发送一轮对话,流式回调 onEvent,result 到达时 resolve。
   * 同一 runtime 串行:并发调用按 turnChain 排队,不会重叠(防 pending 单槽被覆盖)。
   */
  async executeTurn(
    text: string,
    onEvent: (event: AgentEvent) => void,
    images?: ImageAttachment[],
  ): Promise<TurnResult> {
    const run = this.turnChain.then(() => this.runTurn(text, onEvent, images));
    // 无论本 turn 成败都放行下一个,不把错误串进链(单个 turn 失败不应阻塞后续 turn)
    this.turnChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** 中断当前 turn:进程不死,当前 turn 会以 result(subtype=error_during_execution)resolve */
  async interrupt(): Promise<void> {
    if (this.closed) return;
    try {
      await this.queryHandle.interrupt();
    } catch (e) {
      logger.warn('interrupt 失败', { side: this.side, error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** 关闭 runtime(杀进程);幂等。RuntimeRecord.dispose 实现 */
  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // 先 reject 在途 turn(不等 consumeLoop 异步收尾,调用方 await dispose 后状态即确定)
    if (this.pending) {
      this.pending.reject(new Error('runtime disposed'));
      this.pending = null;
    }
    try {
      this.inputStream.end();
    } catch {
      // 已结束,忽略
    }
    try {
      this.queryHandle.close();
    } catch (e) {
      logger.warn('query.close 失败', { side: this.side, error: e instanceof Error ? e.message : String(e) });
    }
    logger.info('runtime 关闭', { side: this.side, sessionId: this.sessionId });
  }

  private async runTurn(
    text: string,
    onEvent: (event: AgentEvent) => void,
    images?: ImageAttachment[],
  ): Promise<TurnResult> {
    if (this.closed) throw new Error('runtime already closed');
    // closed 检查在 Promise 外:避免触发 .finally 的 activeTurnCount-- 造成计数不平衡
    const turnNo = ++this.turnSeq;
    const startedAt = Date.now();
    return new Promise<TurnResult>((resolve, reject) => {
      this.activeTurnCount++;
      this.touch();
      this.pending = { onEvent, resolve, reject };
      try {
        this.inputStream.push(userMsg(text, images));
      } catch (e) {
        // push 同步抛错(极端情况:内部 buffer 异常)→ 清理 pending,避免悬空泄漏
        this.pending = null;
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    }).finally(() => {
      // 注意:不碰 pending(由 consumeLoop/dispose/crash 唯一清),否则会误清下一个已排队的 turn
      this.activeTurnCount--;
      this.touch();
      // turn 计时:成功 / 中断(subtype=error_during_execution)/ crash(reject)统一在此落点,
      // 配合 consumeLoop 的 result/crash 日志,可定位"第几轮、耗时多久、是否中断"
      logger.info('turn 结束', {
        side: this.side,
        turnNo,
        sessionId: this.sessionId,
        ms: Date.now() - startedAt,
      });
    });
  }

  /** 唯一常驻消费者:for-await query 输出流,routeMessage 路由。构造时启动,dispose/进程退出时结束 */
  private async runConsumeLoop(): Promise<void> {
    try {
      for await (const msg of this.queryHandle) {
        const routed = routeMessage(msg);
        if (routed.kind === 'turnEnd') {
          if (this.sessionId === null) this.sessionId = routed.result.session_id;
          const pending = this.pending;
          this.pending = null; // 先清再 resolve(resolve 后下一个 turn 才能占 pending)
          // result 也透传给上层 onEvent(前端据此判断 turn 结束 + 拿 session_id / 用量),
          // 与旧 AgentRunner yield result 一致;再 resolve 本 turn(executeTurn 返回)
          if (pending) {
            try {
              // 构造明确的 AgentEvent 而非强转 SDKResultMessage(避免类型断言掩盖结构差异)
              const resultEvent: AgentEvent = { ...routed.result };
              pending.onEvent(resultEvent);
            } catch (e) {
              logger.warn('onEvent(result) 回调抛错,已忽略', {
                side: this.side,
                error: e instanceof Error ? e.message : String(e),
              });
            }
          }
          pending?.resolve({ result: routed.result });
        } else if (routed.kind === 'stream' && this.pending) {
          try {
            this.pending.onEvent(routed.event);
          } catch (e) {
            // onEvent(上层推 SSE)异常不应打断 runtime
            logger.warn('onEvent 回调抛错,已忽略', { side: this.side, error: e instanceof Error ? e.message : String(e) });
          }
        }
      }
      // 流自然结束(dispose 后 query.close 触发,或进程自行退出)
      this.closed = true;
      if (this.pending) {
        this.pending.reject(new Error('runtime closed before turn completed'));
        this.pending = null;
      }
      logger.info('consumeLoop 流结束', { side: this.side, sessionId: this.sessionId });
    } catch (e) {
      // claude 进程 crash / 流异常:runtime 不可再用,标记 closed + reject 在途 turn
      this.closed = true;
      if (this.pending) {
        this.pending.reject(e instanceof Error ? e : new Error(String(e)));
        this.pending = null;
      }
      logger.error('consumeLoop 异常,runtime 不可再用', {
        side: this.side,
        sessionId: this.sessionId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
