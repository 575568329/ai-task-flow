// frontend/src/api/knowledge.ts
// 知识库 API 封装
import type { KnowledgeManifest, KnowledgeDocResponse, KnowledgeCreateRequest } from '@ai-task-flow/shared';

const BASE = '/api';

/** 获取 manifest(目录树 + 索引) */
export async function fetchManifest(): Promise<KnowledgeManifest> {
  const res = await fetch(`${BASE}/knowledge/manifest`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `请求失败 (${res.status})`);
  }
  return res.json();
}

/** 读取单个文档 */
export async function fetchDoc(path: string): Promise<KnowledgeDocResponse> {
  const res = await fetch(`${BASE}/knowledge/doc?path=${encodeURIComponent(path)}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `请求失败 (${res.status})`);
  }
  return res.json();
}

/** 获取原始文件 URL(用于 img/pdf/html/docx 的 src) */
export function getRawUrl(path: string): string {
  return `${BASE}/knowledge/raw?path=${encodeURIComponent(path)}`;
}

/** 删除文档 */
export async function deleteDoc(path: string): Promise<void> {
  const res = await fetch(`${BASE}/knowledge/doc?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `删除失败 (${res.status})`);
  }
}

/** 创建文档(文件名由服务端按命名规则生成,调用方只传语义字段) */
export async function createDoc(input: KnowledgeCreateRequest): Promise<{ path: string }> {
  const res = await fetch(`${BASE}/knowledge/doc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `创建失败 (${res.status})`);
  }
  return res.json();
}

/** 覆盖更新已有文档(content 即完整 md 正文) */
export async function saveDoc(path: string, content: string): Promise<{ path: string }> {
  const res = await fetch(`${BASE}/knowledge/doc?path=${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `保存失败 (${res.status})`);
  }
  return res.json();
}
