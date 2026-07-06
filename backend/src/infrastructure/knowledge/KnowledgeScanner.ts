// backend/src/infrastructure/knowledge/KnowledgeScanner.ts
// 扫描 knowledge-base/ 目录,生成 manifest(目录树 + 元数据 + 链接索引)
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import type {
  KnowledgeNode,
  KnowledgeDirNode,
  KnowledgeFileNode,
  KnowledgeManifest,
  DocKind,
  BacklinksIndex,
} from '@ai-task-flow/shared';
import { toRelativePosix } from '../utils/safePath.js';

/** 支持的文件扩展名(白名单) */
const SUPPORTED_EXTS = new Set([
  '.md', '.markdown',
  '.pdf',
  '.docx', '.doc',
  '.html', '.htm',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico',
]);

/** 判断扩展名对应的文档类型 */
function getDocKind(name: string): DocKind | null {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.md' || ext === '.markdown') return 'md';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx' || ext === '.doc') return 'docx';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'].includes(ext)) return 'img';
  return null;
}

/** 去除文件名/目录名的排序前缀(如 20260701_ 或 01_) */
function stripPrefix(name: string): string {
  return name.replace(/^\d+[_\-\.\s]+/, '');
}

/** 去扩展名 */
function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

/** 生成展示标题:去前缀 + 去扩展名 */
function makeTitle(name: string, isFile: boolean): string {
  const noPrefix = stripPrefix(name);
  return isFile ? stripExt(noPrefix) : noPrefix;
}

/**
 * 提取 markdown 正文预览(去 frontmatter + 清洗语法,前 2000 字)
 */
function extractContentPreview(raw: string): string {
  // gray-matter 已去掉 frontmatter,content 是正文
  let text = raw;

  // 清洗 markdown 语法
  text = text.replace(/^#{1,6}\s+/gm, '');           // 标题符号
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // 链接 → 文本
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, ''); // 图片 → 删除
  text = text.replace(/[*_~`]{1,3}([^*_~`]+)[*_~`]{1,3}/g, '$1'); // 粗斜体/删除线/行内代码
  text = text.replace(/```[\s\S]*?```/g, '');        // 代码块
  text = text.replace(/\s+/g, ' ').trim();           // 多空白压缩

  return text.slice(0, 2000);
}

/**
 * 解析 markdown 中的 [[wiki]] 链接,返回目标标题列表
 * (后续 buildBacklinks 时会 resolve 到实际 path)
 */
function extractWikiLinks(content: string): string[] {
  const regex = /\[\[([^\]]+)\]\]/g;
  const targets: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const raw = match[1];
    // 支持 [[title|display]],取 | 前的 title
    const target = raw.split('|')[0].trim();
    if (target) targets.push(target);
  }

  return targets;
}

/**
 * 递归扫描目录,构建节点
 */
async function scanDir(
  absPath: string,
  root: string,
): Promise<KnowledgeDirNode | null> {
  const entries = await fs.readdir(absPath, { withFileTypes: true });

  const children: KnowledgeNode[] = [];

  for (const ent of entries) {
    // 跳过隐藏文件/目录
    if (ent.name.startsWith('.')) continue;

    const childAbs = path.join(absPath, ent.name);

    if (ent.isDirectory()) {
      const subDir = await scanDir(childAbs, root);
      if (subDir && subDir.children.length > 0) {
        children.push(subDir);
      }
    } else if (ent.isFile()) {
      const kind = getDocKind(ent.name);
      if (!kind) continue; // 不在白名单,跳过

      const stat = await fs.stat(childAbs);
      const relPath = toRelativePosix(root, childAbs);

      const fileNode: KnowledgeFileNode = {
        type: 'file',
        name: ent.name,
        title: makeTitle(ent.name, true),
        path: relPath,
        kind,
        mtime: Math.floor(stat.mtimeMs / 1000), // Unix 秒
      };

      // md 文件:解析 frontmatter + 提取正文预览 + 解析链接
      if (kind === 'md') {
        try {
          const raw = await fs.readFile(childAbs, 'utf-8');
          const parsed = matter(raw);

          // tags
          if (parsed.data.tags && Array.isArray(parsed.data.tags)) {
            fileNode.tags = parsed.data.tags.map(String).filter(Boolean);
          }

          // 正文预览
          if (parsed.content) {
            fileNode.contentPreview = extractContentPreview(parsed.content);
          }

          // 出链(wiki 链接目标,暂存标题,后续 resolve)
          const wikiTargets = extractWikiLinks(raw);
          if (wikiTargets.length > 0) {
            fileNode.links = wikiTargets;
          }
        } catch (err) {
          // 读取/解析失败不影响整体扫描,跳过
          console.warn(`[KnowledgeScanner] 解析 ${relPath} 失败:`, err);
        }
      }

      children.push(fileNode);
    }
  }

  // 空目录丢弃
  if (children.length === 0) return null;

  // 排序:目录在前、文件在后,各自按 name 排序
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const dirName = path.basename(absPath);
  return {
    type: 'dir',
    name: dirName,
    title: makeTitle(dirName, false),
    children,
  };
}

/**
 * 把树打平成文件列表
 */
function flattenTree(node: KnowledgeNode): KnowledgeFileNode[] {
  if (node.type === 'file') return [node];
  return node.children.flatMap(flattenTree);
}

/**
 * 收集所有 tags,去重排序
 */
function collectTags(flatDocs: KnowledgeFileNode[]): string[] {
  const tagSet = new Set<string>();
  flatDocs.forEach(doc => {
    if (doc.tags) doc.tags.forEach(t => tagSet.add(t));
  });
  return Array.from(tagSet).sort();
}

/**
 * 构建链接解析索引: title/name → path
 * (支持三级匹配:完整路径、文件名、去前缀标题)
 */
function buildLinkIndex(flatDocs: KnowledgeFileNode[]): Map<string, string> {
  const index = new Map<string, string>();

  flatDocs.forEach(doc => {
    // 1) 路径(带扩展名)
    index.set(doc.path.toLowerCase(), doc.path);
    // 2) 文件名(带扩展名)
    index.set(doc.name.toLowerCase(), doc.path);
    // 3) 标题(去前缀去扩展名)
    index.set(doc.title.toLowerCase(), doc.path);
  });

  return index;
}

/**
 * resolve 出链 + 构建反向链接索引
 */
function buildBacklinks(
  flatDocs: KnowledgeFileNode[],
  linkIndex: Map<string, string>,
): BacklinksIndex {
  const backlinks: BacklinksIndex = {};

  flatDocs.forEach(doc => {
    if (!doc.links || doc.links.length === 0) return;

    // resolve 出链的 wiki target → 实际 path
    const resolvedLinks: string[] = [];
    doc.links.forEach(target => {
      const key = target.toLowerCase();
      const targetPath = linkIndex.get(key);
      if (targetPath) {
        resolvedLinks.push(targetPath);
        // 反向记录
        if (!backlinks[targetPath]) backlinks[targetPath] = [];
        if (!backlinks[targetPath].includes(doc.path)) {
          backlinks[targetPath].push(doc.path);
        }
      }
    });

    // 替换 doc.links 为 resolved 后的 path 列表
    doc.links = resolvedLinks;
  });

  return backlinks;
}

/**
 * 扫描知识库目录,生成完整 manifest
 */
export async function scanKnowledge(root: string): Promise<KnowledgeManifest> {
  const tree = await scanDir(root, root);

  if (!tree) {
    // 空目录,返回空 manifest
    return {
      tree: { type: 'dir', name: 'knowledge-base', title: '知识库', children: [] },
      flatDocs: [],
      tags: [],
      backlinks: {},
      generatedAt: Date.now(),
    };
  }

  // 强制根节点名称
  tree.name = 'knowledge-base';
  tree.title = '知识库';

  const flatDocs = flattenTree(tree);
  const tags = collectTags(flatDocs);

  // 构建链接索引 + 反向链接
  const linkIndex = buildLinkIndex(flatDocs);
  const backlinks = buildBacklinks(flatDocs, linkIndex);

  return {
    tree,
    flatDocs,
    tags,
    backlinks,
    generatedAt: Date.now(),
  };
}
