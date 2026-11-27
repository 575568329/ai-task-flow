// backend/src/application/knowledge/KnowledgeExportService.ts
// 知识库导出:把根目录下全部非隐藏文件按相对路径打进一个 zip,
// 解压后可直接用「选择文件夹」原样导回(路径结构、冲突策略都对得上)。
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildZip, type ZipEntry } from '../../infrastructure/utils/zipArchive.js';

/** 单次导出上限:超过就提示分批,避免把整盘读进内存 */
const MAX_EXPORT_FILES = 5000;
const MAX_EXPORT_BYTES = 200 * 1024 * 1024;

export interface KnowledgeExportResult {
  buffer: Buffer;
  /** 实际打进包的文件数(0 表示知识库为空) */
  fileCount: number;
}

/**
 * 递归导出知识库。隐藏文件/目录(.git、.obsidian 等)与扫描器口径一致,一并跳过。
 * 根目录不存在时返回空包(前端按 fileCount 提示),不抛错。
 */
export async function exportKnowledge(root: string): Promise<KnowledgeExportResult> {
  const entries: ZipEntry[] = [];
  let totalBytes = 0;

  async function walk(rel: string): Promise<void> {
    let items;
    try {
      items = await fs.readdir(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }

    for (const item of items) {
      if (item.name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${item.name}` : item.name;

      if (item.isDirectory()) {
        await walk(childRel);
        continue;
      }
      // 符号链接等特殊文件跳过,避免把知识库外的内容打进包
      if (!item.isFile()) continue;

      if (entries.length >= MAX_EXPORT_FILES) {
        throw new Error(`文件数超过 ${MAX_EXPORT_FILES},请分批导出`);
      }
      const abs = path.join(root, childRel);
      const stat = await fs.stat(abs);
      totalBytes += stat.size;
      if (totalBytes > MAX_EXPORT_BYTES) {
        throw new Error('知识库超过 200MB,请分批导出');
      }
      entries.push({ path: childRel, content: await fs.readFile(abs), mtime: stat.mtime });
    }
  }

  await walk('');
  return { buffer: await buildZip(entries), fileCount: entries.length };
}
