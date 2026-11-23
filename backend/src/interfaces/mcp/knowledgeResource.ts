// backend/src/interfaces/mcp/knowledgeResource.ts
// 知识库 MCP resource 文本拼装:正文前附一行关联元数据摘要(仅在有值时)。
// getDoc 已剥离 frontmatter(页面渲染需要干净正文),但 AI 通过 resource 读取时应能看到
// 版本/需求/项目/阶段/标签的软关联,否则读到的文档与工作记录脱节。
import type { KnowledgeDocResponse } from '@ai-task-flow/shared';

export function formatKnowledgeResourceText(doc: KnowledgeDocResponse): string {
  const content = doc.content ?? '';
  const fm = doc.frontmatter;
  if (!fm) return content;
  const parts = [
    fm.versionId ? `versionId=${fm.versionId}` : '',
    fm.requirementId ? `requirementId=${fm.requirementId}` : '',
    fm.projectId ? `projectId=${fm.projectId}` : '',
    fm.stage ? `stage=${fm.stage}` : '',
    fm.tags?.length ? `tags=${fm.tags.join(',')}` : '',
  ].filter(Boolean);
  if (!parts.length) return content;
  return `<!-- meta: ${parts.join(' ')} -->\n${content}`;
}
