// backend/src/application/knowledge/KnowledgeService.ts
// 知识库应用服务:manifest 生成、文档读取、缓存管理
import fs from 'node:fs/promises';
import path from 'node:path';
import type { KnowledgeManifest, KnowledgeDocResponse, DocKind } from '@ai-task-flow/shared';
import { scanKnowledge } from '../../infrastructure/knowledge/KnowledgeScanner.js';
import { safeResolve } from '../../infrastructure/utils/safePath.js';

export class KnowledgeService {
  private root: string;
  private manifestCache: KnowledgeManifest | null = null;

  constructor(knowledgeRoot: string) {
    this.root = knowledgeRoot;
  }

  /**
   * 获取 manifest(有缓存则返回缓存,无则扫描)
   */
  async getManifest(forceRefresh = false): Promise<KnowledgeManifest> {
    if (!forceRefresh && this.manifestCache) {
      return this.manifestCache;
    }

    this.manifestCache = await scanKnowledge(this.root);
    return this.manifestCache;
  }

  /**
   * 刷新 manifest(扫描后更新缓存)
   */
  async refreshManifest(): Promise<KnowledgeManifest> {
    return this.getManifest(true);
  }

  /**
   * 判断文档类型
   */
  private getDocKind(name: string): DocKind | null {
    const ext = path.extname(name).toLowerCase();
    if (ext === '.md' || ext === '.markdown') return 'md';
    if (ext === '.pdf') return 'pdf';
    if (ext === '.docx' || ext === '.doc') return 'docx';
    if (ext === '.html' || ext === '.htm') return 'html';
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'].includes(ext)) return 'img';
    return null;
  }

  /**
   * 读取单个文档
   * @param relPath 相对 knowledge-base/ 的路径
   */
  async getDoc(relPath: string): Promise<KnowledgeDocResponse> {
    // 路径安全校验
    const abs = safeResolve(this.root, relPath);

    const stat = await fs.stat(abs);
    if (!stat.isFile()) {
      throw new Error('目标不是文件');
    }

    const name = path.basename(abs);
    const kind = this.getDocKind(name);
    if (!kind) {
      throw new Error('不支持的文件类型');
    }

    // md 返回文本内容
    if (kind === 'md') {
      const content = await fs.readFile(abs, 'utf-8');
      return { path: relPath, kind, content };
    }

    // 非 md 返回元信息(前端通过 /raw 拿二进制)
    return {
      path: relPath,
      kind,
      meta: {
        name,
        size: stat.size,
        mtime: Math.floor(stat.mtimeMs / 1000),
      },
    };
  }

  /**
   * 获取原始文件路径(供静态服务或 sendFile 用)
   */
  getRawPath(relPath: string): string {
    return safeResolve(this.root, relPath);
  }

  /**
   * 删除文档
   */
  async deleteDoc(relPath: string): Promise<void> {
    const abs = safeResolve(this.root, relPath);
    const stat = await fs.stat(abs);
    if (!stat.isFile()) {
      throw new Error('目标不是文件');
    }
    await fs.unlink(abs);
    // 删除后刷新 manifest
    await this.refreshManifest();
  }
}
