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

/**
 * SSE 客户端:接收后端领域事件,自动重连。
 */
export class SSEClient {
  private eventSource: EventSource | null = null;
  private handlers = new Set<SSEHandler>();
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
      es.close();
      this.eventSource = null;
      if (!this.closed) setTimeout(() => this.connect(), this.reconnectMs);
    };
  }

  on(handler: SSEHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(): void {
    this.closed = true;
    this.eventSource?.close();
    this.eventSource = null;
    this.handlers.clear();
  }
}

export const sseClient = new SSEClient();
