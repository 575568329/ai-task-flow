// backend/src/application/knowledge/KnowledgeService.ts
// 知识库应用服务:manifest 生成、文档读取、写入(创建/覆盖)、缓存管理
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  KnowledgeManifest,
  KnowledgeDocResponse,
  DocKind,
  KnowledgeCreateRequest,
  KnowledgeDocWriteResponse,
} from '@ai-task-flow/shared';
import { scanKnowledge } from '../../infrastructure/knowledge/KnowledgeScanner.js';
import { safeResolve, toRelativePosix } from '../../infrastructure/utils/safePath.js';

/** 文件名非法字符(跨 Windows/Linux) */
const ILLEGAL_FILENAME_CHARS = /[\/\\:\*\?"<>\|]/g;
/** sanitize 后标题最大长度 */
const MAX_TITLE_LEN = 60;
/** 标题清洗后为空时的兜底名 */
const FALLBACK_TITLE = 'untitled';

/** 生成 YYYYMMDDHHMMSS 本地时区时间戳(与 Scanner 展示一致) */
function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

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

  /**
   * 创建文档:文件名由服务端按命名规则生成,调用方只传语义字段(无法干预物理文件名)。
   * 文件名 = <YYYYMMDDHHMMSS>_<sanitizedTitle>.md;tags 非空时拼 frontmatter。
   * 原子写(临时文件 + rename),防中途崩溃产生半截文件。
   */
  async createDoc(input: KnowledgeCreateRequest): Promise<KnowledgeDocWriteResponse> {
    const { title, content, tags, dir } = input;

    if (!title || !title.trim()) {
      throw new Error('标题不能为空');
    }

    const fileName = this.buildFileName(title);
    // dir 越界校验由 safeResolve 负责(抛错 → route 层映射 403)
    const dirAbs = safeResolve(this.root, dir);
    await fs.mkdir(dirAbs, { recursive: true });

    const abs = path.join(dirAbs, fileName);
    const body = this.withFrontmatter(content, tags);

    await this.atomicWrite(abs, body);
    await this.refreshManifest();

    return { path: toRelativePosix(this.root, abs) };
  }

  /**
   * 覆盖更新已有文档(content 即完整 md 正文)。
   * 不自动保留旧 frontmatter——如需保留由调用方拼好再传。
   */
  async saveDoc(relPath: string, content: string): Promise<KnowledgeDocWriteResponse> {
    const abs = safeResolve(this.root, relPath);

    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(abs);
    } catch {
      throw new Error('文件不存在');
    }
    if (!stat.isFile()) {
      throw new Error('目标不是文件');
    }

    await this.atomicWrite(abs, content);
    await this.refreshManifest();

    return { path: toRelativePosix(this.root, abs) };
  }

  /** 生成文件名:<14位时间戳>_<sanitizedTitle>.md */
  private buildFileName(title: string): string {
    const ts = formatTimestamp(new Date());
    return `${ts}_${this.sanitizeTitle(title)}.md`;
  }

  /** 清洗标题:去文件系统非法字符、压缩空白、截断;清洗后为空兜底 untitled */
  private sanitizeTitle(title: string): string {
    const cleaned = title
      .replace(ILLEGAL_FILENAME_CHARS, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_TITLE_LEN);
    return cleaned || FALLBACK_TITLE;
  }

  /** tags 非空时拼 frontmatter,否则原样返回 content */
  private withFrontmatter(content: string, tags?: string[]): string {
    if (!tags || tags.length === 0) return content;
    const tagList = tags.map(t => t.trim()).filter(Boolean);
    if (tagList.length === 0) return content;
    // tag 内逗号替换为空格,避免破坏 YAML 内联数组
    const safe = tagList.map(t => t.replace(/,/g, ' '));
    return `---\ntags: [${safe.join(', ')}]\n---\n${content}`;
  }

  /** 原子写:先写同目录临时文件再 rename,避免半截文件 */
  private async atomicWrite(abs: string, content: string): Promise<void> {
    const tmp = `${abs}.tmp`;
    await fs.writeFile(tmp, content, 'utf-8');
    await fs.rename(tmp, abs);
  }
}
