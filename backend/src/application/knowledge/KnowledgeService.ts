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
  KnowledgeFrontmatter,
  KnowledgeAssociation,
} from '@ai-task-flow/shared';
import { scanKnowledge } from '../../infrastructure/knowledge/KnowledgeScanner.js';
import { safeResolve, toRelativePosix } from '../../infrastructure/utils/safePath.js';
import {
  extractFrontmatterBlock,
  hasFrontmatterData,
  parseFrontmatter,
  serializeFrontmatter,
} from './frontmatter.js';

/** 文件名非法字符(跨 Windows/Linux) */
const ILLEGAL_FILENAME_CHARS = /[\/\\:\*\?"<>\|]/g;
/** sanitize 后标题最大长度 */
const MAX_TITLE_LEN = 60;
/** 标题清洗后为空时的兜底名 */
const FALLBACK_TITLE = 'untitled';
/** UTF-8 BOM(外部工具可能写入;解析前剥离,写回时不再保留) */
const UTF8_BOM = '\uFEFF';
/**
 * 元数据编辑只替换这三项,其余 frontmatter 行原样保留。
 * 旧文档的 requirementId 行不在白名单内,编辑关联时原样保留(不再写入/展示)。
 */
const ASSOCIATION_LINE = /^(versionId|projectId|stage)\s*:/;

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

  /** 知识库根目录(供导入等跨模块流程定位目标目录) */
  getRoot(): string {
    return this.root;
  }

  /**
   * 获取 manifest(有缓存则返回缓存,无则扫描)
   */
  async getManifest(forceRefresh = false): Promise<KnowledgeManifest> {
    if (!forceRefresh && this.manifestCache) {
      return this.manifestCache;
    }

    const manifest = await scanKnowledge(this.root);
    await this.fillFrontmatter(manifest);
    this.manifestCache = manifest;
    return manifest;
  }

  /**
   * 给 flatDocs 补 frontmatter(版本/项目/阶段/tags)。
   * Scanner 已遍历过文件,这里再读一次 md 原文做纯字符串解析:
   * 个人知识库量级(百篇内)可接受,换取 manifest 自带关联字段供前端多视图直接分组。
   */
  private async fillFrontmatter(manifest: KnowledgeManifest): Promise<void> {
    await Promise.all(
      manifest.flatDocs.map(async (doc) => {
        if (doc.kind !== 'md') return;
        try {
          const raw = await fs.readFile(this.getRawPath(doc.path), 'utf-8');
          const parsed = parseFrontmatter(raw);
          if (parsed.hasFrontmatter) {
            doc.frontmatter = parsed.data;
          }
        } catch {
          // 单个文件读取失败不影响整份 manifest
        }
      }),
    );
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

    // md 返回文本内容(去掉 frontmatter,正文交给页面渲染;元数据单独返回)
    if (kind === 'md') {
      const raw = await fs.readFile(abs, 'utf-8');
      const parsed = parseFrontmatter(raw);
      const response: KnowledgeDocResponse = { path: relPath, kind, content: parsed.body };
      if (parsed.hasFrontmatter) {
        response.frontmatter = parsed.data;
      }
      return response;
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
   * 文件名 = <YYYYMMDDHHMMSS>_<sanitizedTitle>.md;
   * tags 与版本/项目/阶段非空时拼 frontmatter。
   * 原子写(临时文件 + rename),防中途崩溃产生半截文件。
   */
  async createDoc(input: KnowledgeCreateRequest): Promise<KnowledgeDocWriteResponse> {
    const { title, content, tags, dir, versionId, projectId, stage } = input;

    if (!title || !title.trim()) {
      throw new Error('标题不能为空');
    }

    const fileName = this.buildFileName(title);
    // dir 越界校验由 safeResolve 负责(抛错 → route 层映射 403)
    const dirAbs = safeResolve(this.root, dir);
    await fs.mkdir(dirAbs, { recursive: true });

    const abs = path.join(dirAbs, fileName);
    const body = this.withFrontmatter(content, { tags, versionId, projectId, stage });

    await this.atomicWrite(abs, body);
    await this.refreshManifest();

    return { path: toRelativePosix(this.root, abs) };
  }

  /**
   * 覆盖更新已有文档(content 即 md 正文)。
   * - 新内容自带 frontmatter:按新内容原样写入;
   * - 否则沿用旧文档的 frontmatter(避免编辑一次就丢元数据)。
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

    let body = content;
    // 按语法判断新内容是否自带前导块(与块内是否含可识别键无关)
    if (!extractFrontmatterBlock(content).hasBlock) {
      const oldRaw = await fs.readFile(abs, 'utf-8');
      const oldBlock = extractFrontmatterBlock(oldRaw);
      // 原样沿用旧 frontmatter 块,保留含 title/date 等本项目不识别的外部键;
      // 旧文件以 --- 结尾且无换行时补一个 \n,否则会和正文粘连导致块不再被识别
      if (oldBlock.hasBlock) {
        const header = oldBlock.raw.endsWith('\n') ? oldBlock.raw : `${oldBlock.raw}\n`;
        body = `${header}${content}`;
      }
    }

    await this.atomicWrite(abs, body);
    await this.refreshManifest();

    return { path: toRelativePosix(this.root, abs) };
  }

  /**
   * 编辑文档的三项关联(版本/项目/阶段)。
   * - 传入非空值 → 写入/覆盖;
   * - 传入空串或 undefined → 清除;
   * - 其余 frontmatter 键(title/date/tags 及任何外部键,含旧 requirementId)原样保留。
   * 只支持 md 文档。
   */
  async updateDocMeta(
    relPath: string,
    association: KnowledgeAssociation,
  ): Promise<KnowledgeDocWriteResponse> {
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
    if (this.getDocKind(path.basename(abs)) !== 'md') {
      throw new Error('仅支持编辑 Markdown 文档的关联');
    }

    const raw = await fs.readFile(abs, 'utf-8');
    const body = this.rewriteAssociation(raw, association);
    await this.atomicWrite(abs, body);
    await this.refreshManifest();

    return { path: toRelativePosix(this.root, abs) };
  }

  /**
   * 重写 frontmatter 中的三项关联,保留其他键与正文。
   * 无前导块时按需新建;三项清空且无其他键时整块移除。
   */
  private rewriteAssociation(raw: string, association: KnowledgeAssociation): string {
    // extractFrontmatterBlock 内部会剥离 BOM 再匹配,返回的 raw 偏移基于剥离后的串,
    // 这里先自行剥离,保证 slice 对齐(写回不保留 BOM)
    const normalized = raw.startsWith(UTF8_BOM) ? raw.slice(UTF8_BOM.length) : raw;
    const block = extractFrontmatterBlock(normalized);
    const body = block.hasBlock ? normalized.slice(block.raw.length) : normalized;

    // 拆出块内行(去掉首行 --- 与结尾 ---),其余行原样保留
    const keptLines = block.hasBlock
      ? block.raw
          .replace(/^---[ \t]*\r?\n?/, '')
          .replace(/\r?\n?---[ \t]*\r?\n?$/, '')
          .split(/\r?\n/)
          .filter((line) => line.trim() !== '' && !ASSOCIATION_LINE.test(line))
      : [];

    // 复用 frontmatter.ts 的序列化(含换行清洗/空值跳过),只取块内行
    const newLines = serializeFrontmatter({
      versionId: association.versionId,
      projectId: association.projectId,
      stage: association.stage,
    })
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '' && line.trim() !== '---');

    const lines = [...keptLines, ...newLines];
    const header = lines.length > 0 ? `---\n${lines.join('\n')}\n---\n` : '';
    return `${header}${body}`;
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

  /**
   * 拼接 frontmatter:正文语法上没有前导块时前置。
   * 正文已带任意前导块时保持原样(避免出现两个 --- 块),此时元数据不写入并打印告警。
   */
  private withFrontmatter(content: string, meta: KnowledgeFrontmatter): string {
    if (extractFrontmatterBlock(content).hasBlock) {
      if (hasFrontmatterData(meta)) {
        console.warn('[KnowledgeService] 文档自带 frontmatter,本次元数据未写入(tags/版本/项目/阶段)');
      }
      return content;
    }
    return serializeFrontmatter(meta) + content;
  }

  /** 原子写:先写同目录临时文件再 rename,避免半截文件 */
  private async atomicWrite(abs: string, content: string): Promise<void> {
    const tmp = `${abs}.tmp`;
    await fs.writeFile(tmp, content, 'utf-8');
    await fs.rename(tmp, abs);
  }
}
