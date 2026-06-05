// frontend/src/api/sse.ts

export interface SSEEvent {
  type: string;
  aggregateId?: string;
  eventId?: string;
  occurredAt?: string;
  payload?: any;
  timestamp?: string;
}

export type SSEHandler = (event: SSEEvent) => void;

/**
 * SSE 客户端
 * 用于接收后端实时推送的领域事件
 */
export class SSEClient {
  private eventSource: EventSource | null = null;
  private handlers: Set<SSEHandler> = new Set();
  private url: string;
  private reconnectInterval = 3000;
  private isClosed = false;

  constructor(url: string = '/api/events') {
    this.url = url;
  }

  connect(): void {
    if (this.eventSource) {
      return;
    }

    this.isClosed = false;
    this.eventSource = new EventSource(this.url);

    this.eventSource.onopen = () => {
      console.log('[SSE] Connected');
    };

    this.eventSource.onmessage = (event) => {
      try {
        const data: SSEEvent = JSON.parse(event.data);
        this.handlers.forEach((handler) => {
          try {
            handler(data);
          } catch (error) {
            console.error('[SSE] Handler error:', error);
          }
        });
      } catch (error) {
        console.error('[SSE] Parse error:', error);
      }
    };

    this.eventSource.onerror = (error) => {
      console.error('[SSE] Error:', error);
      this.eventSource?.close();
      this.eventSource = null;

      // 自动重连（除非主动关闭）
      if (!this.isClosed) {
        setTimeout(() => this.connect(), this.reconnectInterval);
      }
    };
  }

  on(handler: SSEHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  close(): void {
    this.isClosed = true;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.handlers.clear();
  }
}

// 单例
export const sseClient = new SSEClient();
