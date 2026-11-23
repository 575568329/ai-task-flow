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
  /** md 的 frontmatter 元数据(含关联字段);无 frontmatter 时缺省 */
  frontmatter?: KnowledgeFrontmatter;
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
  /** 知识库物理根目录绝对路径(前端拼「复制磁盘路径」用:basePath + '/' + doc.path) */
  basePath: string;
}

/** Markdown frontmatter:本项目写入的元数据(软关联,不级联) */
export interface KnowledgeFrontmatter {
  tags?: string[];
  versionId?: string;
  requirementId?: string;
  projectId?: string;
  /** 唯一阶段标签(与 worklog stage 同源,类型上保持宽松以便解析历史文档) */
  stage?: string;
}

/** GET /api/knowledge/doc 返回 */
export interface KnowledgeDocResponse {
  path: string;
  kind: DocKind;
  /** md 返回文本内容(已去掉 frontmatter,避免页面显示 ---) */
  content?: string;
  /** md 返回解析出的 frontmatter;文档没有 frontmatter 时缺省 */
  frontmatter?: KnowledgeFrontmatter;
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
  /** 可选软关联:版本/需求/项目/阶段,写入 frontmatter 供知识库归类 */
  versionId?: string;
  requirementId?: string;
  projectId?: string;
  stage?: string;
}

/** PUT /api/knowledge/doc 请求体:覆盖更新已有文档 */
export interface KnowledgeSaveRequest {
  content: string;
}

/** 文档的四项软关联(版本/需求/项目/阶段);空串或 undefined 表示清除 */
export interface KnowledgeAssociation {
  versionId?: string;
  requirementId?: string;
  projectId?: string;
  stage?: string;
}

/** PUT /api/knowledge/doc/meta 请求体:替换关联字段(保留其他 frontmatter 键) */
export interface KnowledgeDocMetaUpdateRequest extends KnowledgeAssociation {
  /** 相对 knowledge-base/ 的 posix 路径 */
  path: string;
}

/** POST/PUT /api/knowledge/doc 成功响应 */
export interface KnowledgeDocWriteResponse {
  /** 相对 knowledge-base/ 的 posix 路径 */
  path: string;
}

/** 一次性导入单条冲突:源相对路径 → 目标落盘相对路径(均为 posix 风格) */
export interface KnowledgeImportConflict {
  from: string;
  to: string;
}

/** 一次性导入单条失败:出错文件相对路径 + 错误信息(不中断整体导入) */
export interface KnowledgeImportError {
  path: string;
  message: string;
}

/** POST /api/knowledge/import 响应(前后端共用单一来源) */
export interface KnowledgeImportReport {
  copied: number;
  /** 目标中已存在内容相同的文件,跳过数(内容级幂等) */
  skipped: number;
  conflicts: KnowledgeImportConflict[];
  errors: KnowledgeImportError[];
}

/** GET /api/knowledge/import/suggestion 响应:仓库知识库尚未导入的引导 */
export interface KnowledgeImportSuggestion {
  /** 是否建议导入(sourceCount > 0 且 targetCount < sourceCount) */
  suggested: boolean;
  /** 源目录(仓库 knowledge-base)可导入文件数;源目录缺失为 0 */
  sourceCount: number;
  /** 目标目录(用户知识库)现有文件数 */
  targetCount: number;
}
