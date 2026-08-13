// frontend/src/stores/chat/applyEvent.ts
// AgentEvent → ChatTurn[] 的纯函数归一化(从 taskChatStore 抽出,便于单测 + Phase 2 历史回放复用)。
// 不依赖任何前端运行时模块:仅 shared 的类型 import(运行时擦除),node 环境即可单测。
import type { AgentEvent, ChatTurn } from '@ai-task-flow/shared';

/** 生成 turn id(Math.random + 时间戳;非密码学用途,仅作 React key) */
export function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** 从 assistant/user 事件里取 message.content 数组(兼容缺失情况) */
function contentOf(ev: AgentEvent): unknown[] {
  const msg = (ev as { message?: { content?: unknown[] } }).message;
  return Array.isArray(msg?.content) ? (msg.content as unknown[]) : [];
}

/** 把 content 数组里的 text 拼成纯文本(tool_result 的 content 是 [{type:'text',text}] 或字符串) */
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
 * 处理单个 AgentEvent,返回新的 turns 数组(不可变更新,就地更新某任务的 assistant 当前轮)。
 *
 * 分支:
 * - stream_event thinking_delta:逐字增量,合并到末尾 assistant turn 的末尾 thinking block
 *   (无 assistant turn 则新建;末尾非 thinking 则新建 thinking block)。partial 流式渲染用。
 * - assistant:text/thinking/tool_use 合并到末尾 assistant turn;thinking 末尾已有则跳过
 *   (partial 下 stream_event 已逐字构建,终态再发完整 thinking 会翻倍)。
 * - user:tool_result 按 tool_use_id 回填到对应 tool_use 块(跨 turn 遍历)。
 * - result/system/error:不影响 turns(由调用方处理终态)。
 */
export function applyEvent(turns: ChatTurn[], ev: AgentEvent): ChatTurn[] {
  // partial 思考流式:thinking_delta 逐字增量,合并到当前 assistant turn 末尾 thinking block
  if (ev.type === 'stream_event') {
    const e = (ev as { event?: { type?: string; delta?: { type?: string; thinking?: string } } }).event;
    if (e?.type !== 'content_block_delta' || e.delta?.type !== 'thinking_delta') return turns;
    const chunk = e.delta.thinking;
    if (typeof chunk !== 'string' || chunk === '') return turns;
    let next = turns;
    const last = turns[turns.length - 1];
    if (!last || last.role !== 'assistant') {
      next = [...turns, { id: uid(), role: 'assistant', blocks: [] }];
    }
    const assistant = next[next.length - 1];
    let blocks = assistant.blocks ?? [];
    const lastBlock = blocks[blocks.length - 1];
    blocks =
      lastBlock && lastBlock.kind === 'thinking'
        ? [...blocks.slice(0, -1), { kind: 'thinking', thinking: lastBlock.thinking + chunk }]
        : [...blocks, { kind: 'thinking', thinking: chunk }];
    const updated = { ...assistant, blocks };
    return [...next.slice(0, -1), updated];
  }

  if (ev.type === 'assistant') {
    // 确保 assistant 轮存在(末尾是 assistant 轮则复用,否则新建)
    let next = turns;
    const last = turns[turns.length - 1];
    if (!last || last.role !== 'assistant') {
      next = [...turns, { id: uid(), role: 'assistant', blocks: [] }];
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
        // 去重:partial 下 stream_event 已逐字构建 thinking(末尾 block),终态 assistant 再发
        // 完整 thinking 会翻倍;末尾已是 thinking 则跳过(partial 未发 thinking 时末尾非 thinking,正常合并兜底)
        const lastBlock = blocks[blocks.length - 1];
        if (!lastBlock || lastBlock.kind !== 'thinking') {
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
    // tool_result:按 tool_use_id 回填到对应 tool_use 块(就地遍历每个 turn 的 blocks)
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

  // result/system/error 在 send() 里处理终态,这里不影响 turns
  return turns;
}
