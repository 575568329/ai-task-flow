// backend/src/application/knowledge/__tests__/KnowledgeExportService.test.ts
// 知识库导出单测:递归收集、保留 posix 相对路径、跳过隐藏项、空库返回 0 篇
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exportKnowledge } from '../KnowledgeExportService.js';

/** 从 zip 字节流里读 EOCD(末尾 22 字节固定结构)取条目数与中央目录位置 */
function readEndOfCentral(buffer: Buffer) {
  const end = buffer.subarray(buffer.length - 22);
  return {
    entries: end.readUInt16LE(10),
    centralSize: end.readUInt32LE(12),
    centralOffset: end.readUInt32LE(16),
  };
}

describe('exportKnowledge', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'kexp-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('should pack nested files with posix paths', async () => {
    await fs.mkdir(path.join(root, '技术方案'), { recursive: true });
    await fs.writeFile(path.join(root, '技术方案', 'a.md'), '# a');
    await fs.writeFile(path.join(root, 'b.md'), '# b');

    const { buffer, fileCount } = await exportKnowledge(root);

    expect(fileCount).toBe(2);
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('PK\u0003\u0004');
    const end = readEndOfCentral(buffer);
    expect(end.entries).toBe(2);
    // 中央目录紧跟本地文件数据之后,EOCD 记录的偏移必须落在缓冲区内
    expect(end.centralOffset + end.centralSize).toBe(buffer.length - 22);
    expect(buffer.includes(Buffer.from('技术方案/a.md', 'utf8'))).toBe(true);
  });

  it('should skip hidden files and directories', async () => {
    await fs.mkdir(path.join(root, '.obsidian'), { recursive: true });
    await fs.writeFile(path.join(root, '.obsidian', 'x.json'), '{}');
    await fs.writeFile(path.join(root, '.secret.md'), 's');
    await fs.writeFile(path.join(root, 'visible.md'), '# v');

    const { fileCount, buffer } = await exportKnowledge(root);

    expect(fileCount).toBe(1);
    expect(buffer.includes(Buffer.from('.secret.md', 'utf8'))).toBe(false);
  });

  it('should return an empty zip for a missing root', async () => {
    const { buffer, fileCount } = await exportKnowledge(path.join(root, 'missing'));

    expect(fileCount).toBe(0);
    // 空包只有 EOCD
    expect(buffer.length).toBe(22);
    expect(readEndOfCentral(buffer).entries).toBe(0);
  });
});
