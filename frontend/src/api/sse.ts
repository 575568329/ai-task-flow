// frontend/src/api/sse.ts

export interface SSEEvent {
  type: string;
  aggregateId?: string;
  eventId?: string;
  occurredAt?: string;
  payload?: unknown;
  timestamp?: string;
}

export type SSEHandler = (event: SSEEvent) => void;
export type SSEStatusHandler = (connected: boolean) => void;

/**
 * SSE 客户端:接收后端领域事件,自动重连。
 */
export class SSEClient {
  private eventSource: EventSource | null = null;
  private handlers = new Set<SSEHandler>();
  private statusHandlers = new Set<SSEStatusHandler>();
  private readonly url: string;
  private readonly reconnectMs = 3000;
  private closed = false;

  constructor(url = '/api/events') {
    this.url = url;
  }

  connect(): void {
    if (this.eventSource) return;
    this.closed = false;
    const es = new EventSource(this.url);
    this.eventSource = es;

    es.onopen = () => this.notifyStatus(true);

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as SSEEvent;
        this.handlers.forEach((h) => {
          try {
            h(data);
          } catch (err) {
            console.error('[SSE] handler error', err);
          }
        });
      } catch (err) {
        console.error('[SSE] parse error', err);
      }
    };

    es.onerror = () => {
      this.notifyStatus(false);
      es.close();
      this.eventSource = null;
      if (!this.closed) setTimeout(() => this.connect(), this.reconnectMs);
    };
  }

  on(handler: SSEHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /**
   * 订阅连接状态变化(UI 连接指示用)。
   * 注册时立即按当前 readyState 回调一次(1=OPEN 视为已连接),后续 onopen/onerror 自动通知。
   */
  onStatusChange(cb: SSEStatusHandler): () => void {
    this.statusHandlers.add(cb);
    if (this.eventSource) cb(this.eventSource.readyState === 1);
    return () => this.statusHandlers.delete(cb);
  }

  close(): void {
    this.closed = true;
    this.eventSource?.close();
    this.eventSource = null;
    this.handlers.clear();
    this.notifyStatus(false);
  }

  private notifyStatus(connected: boolean): void {
    this.statusHandlers.forEach((cb) => {
      try {
        cb(connected);
      } catch (err) {
        console.error('[SSE] status handler error', err);
      }
    });
  }
}

export const sseClient = new SSEClient();
