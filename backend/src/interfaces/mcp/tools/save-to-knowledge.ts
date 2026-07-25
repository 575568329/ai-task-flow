// backend/src/interfaces/mcp/tools/save-to-knowledge.ts
import type { ToolDeps } from './types.js';

export const toolDef = {
  name: 'save_to_knowledge' as const,
  description: '将调研结论/笔记写入知识库(创建新 Markdown 文档,文件名由服务端按命名规则生成,调用方无法干预物理文件名)',
  inputSchema: {
    type: 'object' as const,
    properties: {
      title: {
        type: 'string' as const,
        description: '文档标题(用作文件名一部分,特殊字符会被清洗)',
      },
      content: {
        type: 'string' as const,
        description: 'Markdown 正文',
      },
      tags: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: '可选标签(写入 frontmatter)',
      },
      dir: {
        type: 'string' as const,
        description: '可选子目录(相对 knowledge-base/),不传则写根目录',
      },
    },
    required: ['title', 'content'],
  },
};

export async function handle(args: any, deps: ToolDeps) {
  const { title, content, tags, dir } = args;

  if (!title || !title.trim()) {
    throw new Error('title is required');
  }
  if (!content) {
    throw new Error('content is required');
  }

  try {
    const result = await deps.knowledgeService.createDoc({ title, content, tags, dir });
    return {
      content: [{
        type: 'text' as const,
        text: [
          '✅ 已写入知识库',
          '',
          `**路径**: \`${result.path}\``,
          '',
          '文档已创建,前端知识库看板刷新即可见。',
        ].join('\n'),
      }],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text' as const, text: `❌ 写入知识库失败: ${error.message}` }],
    };
  }
}
