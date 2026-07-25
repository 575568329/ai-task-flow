// frontend/src/lib/chatEvents.ts
// 对话事件归一化纯函数:把后端透传的 Claude stream-json 事件(AgentEvent)
// 累积成渲染用的 turns/blocks。任务对话(taskChatStore)与项目对话(projectChatStore)共用。
// 第二步整合时 taskChatStore 改用此处(消除内联副本)。
import type { AgentEvent, ChatTurn } from '@ai-task-flow/shared';

/** 生成稳定唯一 id(turn/turn-blocks 用,渲染 key) */
export function chatEventUid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** 从 assistant/user 事件取 message.content 数组(兼容缺失) */
function contentOf(ev: AgentEvent): unknown[] {
  const msg = (ev as { message?: { content?: unknown[] } }).message;
  return Array.isArray(msg?.content) ? (msg.content as unknown[]) : [];
}

/** tool_result.content(字符串或 [{type:'text',text}] 数组)→ 纯文本 */
function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        const block = c as { type?: string; text?: string };
        if (block?.type === 'text' && typeof block.text === 'string') return block.text;
        return '';
      })
      .join('\n')
      .trim();
  }
  return JSON.stringify(content);
}

/**
 * 累积单个 AgentEvent 到 turns(不可变更新),返回新数组。
 * - assistant:确保末尾有 assistant 轮,把 content 的 text/thinking/tool_use 合并进 blocks
 * - user:tool_result 按 tool_use_id 回填到对应 tool_use 块
 * - result/error/init:不影响 turns(由调用方处理终态)
 */
export function applyChatEvent(turns: ChatTurn[], ev: AgentEvent): ChatTurn[] {
  if (ev.type === 'assistant') {
    let next = turns;
    const last = turns[turns.length - 1];
    if (!last || last.role !== 'assistant') {
      next = [...turns, { id: chatEventUid(), role: 'assistant', blocks: [] }];
    }
    const assistant = next[next.length - 1];
    let blocks = assistant.blocks ?? [];

    for (const raw of contentOf(ev)) {
      const block = raw as { type?: string; [k: string]: unknown };
      if (block?.type === 'text' && typeof block.text === 'string') {
        // text:合并到最后一个 text 块,避免碎片
        const lastBlock = blocks[blocks.length - 1];
        if (lastBlock && lastBlock.kind === 'text') {
          blocks = [...blocks.slice(0, -1), { kind: 'text', text: lastBlock.text + block.text }];
        } else {
          blocks = [...blocks, { kind: 'text', text: block.text }];
        }
      } else if (block?.type === 'thinking' && typeof block.thinking === 'string') {
        const lastBlock = blocks[blocks.length - 1];
        if (lastBlock && lastBlock.kind === 'thinking') {
          blocks = [
            ...blocks.slice(0, -1),
            { kind: 'thinking', thinking: lastBlock.thinking + block.thinking },
          ];
        } else {
          blocks = [...blocks, { kind: 'thinking', thinking: block.thinking }];
        }
      } else if (block?.type === 'tool_use' && typeof block.id === 'string') {
        // tool_use:同 id 已存在则更新 input,否则新增
        const idx = blocks.findIndex((b) => b.kind === 'tool_use' && b.id === block.id);
        const newBlock = {
          kind: 'tool_use' as const,
          id: block.id,
          name: typeof block.name === 'string' ? block.name : 'tool',
          input: block.input,
        };
        if (idx >= 0) {
          blocks = [...blocks.slice(0, idx), newBlock, ...blocks.slice(idx + 1)];
        } else {
          blocks = [...blocks, newBlock];
        }
      }
    }

    const updated = { ...assistant, blocks };
    return [...next.slice(0, -1), updated];
  }

  if (ev.type === 'user') {
    // tool_result:按 tool_use_id 回填到对应 tool_use 块
    const results = contentOf(ev)
      .filter(
        (r): r is { type: 'tool_result'; tool_use_id: string; content: unknown; is_error?: boolean } => {
          const tr = r as { type?: string; tool_use_id?: string };
          return tr?.type === 'tool_result' && typeof tr.tool_use_id === 'string';
        },
      )
      .map((tr) => ({
        id: tr.tool_use_id,
        result: { content: toolResultText(tr.content), isError: tr.is_error === true },
      }));
    if (results.length === 0) return turns;
    return turns.map((t) =>
      t.blocks
        ? {
            ...t,
            blocks: t.blocks.map((b) => {
              if (b.kind !== 'tool_use') return b;
              const r = results.find((x) => x.id === b.id);
              return r ? { ...b, result: r.result } : b;
            }),
          }
        : t,
    );
  }

  return turns;
}
