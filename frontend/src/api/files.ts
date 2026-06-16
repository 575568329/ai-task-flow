// frontend/src/api/files.ts
export interface FileEntry {
  name: string;
  type: 'dir' | 'file';
  path: string; // 相对 root 的 posix 路径
}

export interface ListResult {
  root: string;
  sub: string;
  entries: FileEntry[];
}

const BASE = '/api';

export async function listFiles(root: string, sub?: string): Promise<ListResult> {
  const res = await fetch(`${BASE}/files/list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root, sub }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `请求失败 (${res.status})`);
  }
  return res.json();
}

export async function readFile(root: string, filePath: string): Promise<string> {
  const res = await fetch(`${BASE}/files/read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root, path: filePath }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `请求失败 (${res.status})`);
  }
  const data = await res.json();
  return data.content as string;
}
