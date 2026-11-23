// backend/src/application/knowledge/frontmatter.ts
// 知识库 frontmatter 最小解析/序列化(不引入 yaml/gray-matter 等新依赖)。
// 只支持本项目写入的格式:单行 `key: value`、`tags: [a, b]` 内联数组;
// 未知键与多行值一律忽略,解析失败按「无 frontmatter」处理,不抛错。
import type { KnowledgeFrontmatter } from '@ai-task-flow/shared';

/** 匹配文档开头的 frontmatter 块(含首尾 --- 与块尾换行);空块也支持 */
const FRONTMATTER_BLOCK = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;
/** 单行 key: value(键限定为字母开头的标识符) */
const KV_LINE = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/;

export interface ParsedKnowledgeFrontmatter {
  /** 解析出的已知元数据(未知键被丢弃) */
  data: KnowledgeFrontmatter;
  /** 去掉 frontmatter 后的正文 */
  body: string;
  hasFrontmatter: boolean;
  /** 原始 frontmatter 块(含首尾 --- 与块尾换行);无则为空串 */
  raw: string;
}

/** 去掉成对的首尾引号(兼容外部工具写入的 "v_1" / 'v_1') */
function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2) {
    const first = v[0];
    const last = v[v.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return v.slice(1, -1);
    }
  }
  return v;
}

/** tags: [a, b] / tags: a, b → ['a', 'b'] */
function parseTags(value: string): string[] {
  const v = value.trim();
  const inner = v.startsWith('[') && v.endsWith(']') ? v.slice(1, -1) : v;
  return inner.split(',').map(unquote).filter(Boolean);
}

/**
 * 解析文档开头的 frontmatter。
 * 无闭合 `---`、非法行、多行值均按「跳过/无 frontmatter」处理,不抛错。
 */
export function parseFrontmatter(raw: string): ParsedKnowledgeFrontmatter {
  const match = FRONTMATTER_BLOCK.exec(raw);
  if (!match) {
    return { data: {}, body: raw, hasFrontmatter: false, raw: '' };
  }

  const data: KnowledgeFrontmatter = {};
  const block = match[1] ?? '';

  for (const line of block.split(/\r?\n/)) {
    const kv = KV_LINE.exec(line);
    if (!kv) continue; // 多行值/缩进列表/非法行:忽略

    const key = kv[1];
    const value = kv[2].trim();
    if (!value) continue;

    switch (key) {
      case 'tags': {
        const tags = parseTags(value);
        if (tags.length > 0) data.tags = tags;
        break;
      }
      case 'versionId':
        data.versionId = unquote(value);
        break;
      case 'requirementId':
        data.requirementId = unquote(value);
        break;
      case 'projectId':
        data.projectId = unquote(value);
        break;
      case 'stage':
        data.stage = unquote(value);
        break;
      default:
        // 未知键忽略
        break;
    }
  }

  return { data, body: raw.slice(match[0].length), hasFrontmatter: true, raw: match[0] };
}

/** 单值清洗:换行折叠为空格,避免破坏 frontmatter 的行结构 */
function sanitizeValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/**
 * 序列化 frontmatter。
 * 固定顺序:tags、versionId、requirementId、projectId、stage;空值不写。
 * 无任何有效字段时返回空串(调用方据此决定是否加块)。
 */
export function serializeFrontmatter(data: KnowledgeFrontmatter): string {
  const lines: string[] = [];

  const tags = (data.tags ?? [])
    .map((tag) => sanitizeValue(tag).replace(/,/g, ' ')) // tag 内逗号替换为空格,避免破坏内联数组
    .filter(Boolean);
  if (tags.length > 0) lines.push(`tags: [${tags.join(', ')}]`);

  const scalars: Array<[string, string | undefined]> = [
    ['versionId', data.versionId],
    ['requirementId', data.requirementId],
    ['projectId', data.projectId],
    ['stage', data.stage],
  ];
  for (const [key, value] of scalars) {
    const v = value === undefined ? '' : sanitizeValue(value);
    if (v) lines.push(`${key}: ${v}`);
  }

  if (lines.length === 0) return '';
  return `---\n${lines.join('\n')}\n---\n`;
}

/** 是否含任一可识别元数据(用于判断是否需要写 frontmatter) */
export function hasFrontmatterData(data: KnowledgeFrontmatter): boolean {
  return Boolean(
    (data.tags && data.tags.length > 0) ||
      data.versionId ||
      data.requirementId ||
      data.projectId ||
      data.stage,
  );
}
