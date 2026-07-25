// backend/src/application/agent/PushableInputStream.ts
// 可推送的 AsyncIterable<SDKUserMessage>:AgentRuntime 持有它作为 SDK query 的 prompt 输入流。
// executeTurn 时 push 一条 user message,SDK query 在常驻 for-await 中按序消费;
// turn 之间**不 end**(end 会让 claude 判定会话结束退出——见 spike/runtime-persistent 实测),
// 只有 dispose 时才 end()(配合 query.close() 让 for-await 正常 done 退出)。
//
// 单 waiter 设计:SDK query 只有一个消费者(单条 for-await),不存在并发拉取,单 waiter 足够且无竞态。
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

export class PushableInputStream implements AsyncIterable<SDKUserMessage> {
  private buffer: SDKUserMessage[] = [];
  /** 当前挂起的 next() 等待者;单消费者场景至多一个 */
  private waiter: ((value: SDKUserMessage | null) => void) | null = null;
  private isEnded = false;

  /** 推入一条 user message;若消费者正挂起等待,立即唤醒 */
  push(message: SDKUserMessage): void {
    if (this.isEnded) return; // end 后再 push(dispose 与 executeTurn 的异常竞态):忽略,避免已 done 后无效入队
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve(message);
    } else {
      this.buffer.push(message);
    }
  }

  /** 标记流结束;若消费者正挂起,唤醒并返回 done。幂等 */
  end(): void {
    if (this.isEnded) return;
    this.isEnded = true;
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve(null);
    }
  }

  get ended(): boolean {
    return this.isEnded;
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage>> => {
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift()!, done: false });
        }
        if (this.isEnded) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve) => {
          this.waiter = (m) => {
            if (m === null) resolve({ value: undefined, done: true });
            else resolve({ value: m, done: false });
          };
        });
      },
    };
  }
}
