// frontend/src/api/http.ts
import { toast } from '@/components/ui/toaster';

const BASE = '/api';

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** 静默模式:不弹错误 toast(调用方自行处理) */
  silent?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, silent } = options;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let message = `请求失败 (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      // 响应非 JSON,用默认消息
    }
    if (!silent) toast.error(message);
    throw new Error(message);
  }

  // 204 无内容
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const http = {
  get: <T>(path: string, silent?: boolean) => request<T>(path, { silent }),
  post: <T>(path: string, body?: unknown, silent?: boolean) =>
    request<T>(path, { method: 'POST', body, silent }),
  put: <T>(path: string, body?: unknown, silent?: boolean) =>
    request<T>(path, { method: 'PUT', body, silent }),
  patch: <T>(path: string, body?: unknown, silent?: boolean) =>
    request<T>(path, { method: 'PATCH', body, silent }),
  delete: <T>(path: string, silent?: boolean) =>
    request<T>(path, { method: 'DELETE', silent }),
};
