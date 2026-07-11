// shared/src/types/knowledge.ts
// 知识库模块类型定义

/** 文档类型(按扩展名区分预览器) */
export type DocKind = 'md' | 'pdf' | 'docx' | 'html' | 'img';

/** 文件节点 */
export interface KnowledgeFileNode {
  type: 'file';
  name: string;           // 原始文件名(含扩展名)
  title: string;          // 展示标题(去时间戳前缀 + 去扩展名)
  path: string;           // 相对 knowledge-base/ 的 posix 路径
  kind: DocKind;
  mtime: number;          // Unix 秒(UTC)
  tags?: string[];        // frontmatter 提取的 tags
  contentPreview?: string;// md 正文前 2000 字纯文本(供全文搜索)
  links?: string[];       // 出链:该文档引用的其他文档路径列表
}

/** 目录节点 */
export interface KnowledgeDirNode {
  type: 'dir';
  name: string;
  title: string;          // 目录名(去排序前缀)
  children: KnowledgeNode[];
}

export type KnowledgeNode = KnowledgeFileNode | KnowledgeDirNode;

/** 反向链接索引: targetPath → 引用它的文档路径列表 */
export type BacklinksIndex = Record<string, string[]>;

/** Manifest 完整数据(后端一次返回,前端缓存) */
export interface KnowledgeManifest {
  tree: KnowledgeDirNode;         // 嵌套目录树
  flatDocs: KnowledgeFileNode[];  // 扁平文件列表(供搜索/标签/链接解析)
  tags: string[];                 // 所有 tags 去重排序(供下拉筛选)
  backlinks: BacklinksIndex;      // 反向链接索引
  generatedAt: number;            // 生成时间戳(Unix 毫秒)
}

/** GET /api/knowledge/doc 返回 */
export interface KnowledgeDocResponse {
  path: string;
  kind: DocKind;
  content?: string;       // md 返回文本内容
  meta?: {                // 非 md 返回元信息
    name: string;
    size: number;
    mtime: number;
  };
}

/** POST /api/knowledge/doc 请求体:创建文档(文件名由服务端生成,调用方无法干预) */
export interface KnowledgeCreateRequest {
  title: string;
  content: string;
  tags?: string[];
  /** 可选子目录(相对 knowledge-base/),服务端校验越界 */
  dir?: string;
}

/** PUT /api/knowledge/doc 请求体:覆盖更新已有文档 */
export interface KnowledgeSaveRequest {
  content: string;
}

/** POST/PUT /api/knowledge/doc 成功响应 */
export interface KnowledgeDocWriteResponse {
  /** 相对 knowledge-base/ 的 posix 路径 */
  path: string;
}
