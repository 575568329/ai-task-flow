// frontend/src/api/knowledge.ts
// 知识库 API 封装
import type {
  KnowledgeManifest,
  KnowledgeDocResponse,
  KnowledgeCreateRequest,
  KnowledgeDocMetaUpdateRequest,
  KnowledgeImportFile,
  KnowledgeImportReport,
} from '@ai-task-flow/shared';

const BASE = '/api';

/** 导入用户选择的文本文件/文件夹内容(保留相对路径,支持多选) */
export async function importKnowledgeFiles(files: KnowledgeImportFile[]): Promise<KnowledgeImportReport> {
  const res = await fetch(`${BASE}/knowledge/import/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `导入失败 (${res.status})`);
  }
  return res.json();
}

/** 导出整个知识库为 zip(解压后可用「选择文件夹」原样导回) */
export async function exportKnowledge(): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`${BASE}/knowledge/export`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `导出失败 (${res.status})`);
  }
  // 文件名由服务端给;取不到时前端兜底,保证下载可用
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const matched = /filename="([^"]+)"/.exec(disposition);
  return {
    blob: await res.blob(),
    filename: matched?.[1] || `knowledge-base-${Date.now()}.zip`,
  };
}

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

/** 编辑文档三项关联(版本/项目/阶段);空串=清除,其他 frontmatter 键保留 */
export async function updateDocMeta(
  input: KnowledgeDocMetaUpdateRequest,
): Promise<{ path: string }> {
  const res = await fetch(`${BASE}/knowledge/doc/meta`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `更新关联失败 (${res.status})`);
  }
  const data = await res.json();
  return { path: data.path };
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
