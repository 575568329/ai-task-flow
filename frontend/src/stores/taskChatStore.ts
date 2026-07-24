// frontend/src/stores/taskChatStore.ts
// 任务对话状态:按 taskId 分桶,把后端透传的 stream-json 事件归一化为渲染用的 turns/blocks。
// - assistant.content[] → text/thinking/tool_use block
// - user.content[] → tool_result 关联回对应 tool_use(按 tool_use_id)
// - result → 终态:落 sessionId(供下轮续接)+ usage,流结束
import { create } from 'zustand';
import type { AgentEvent, ChatBlock, ChatTurn, ChatSessionSummary } from '@ai-task-flow/shared';
import { streamTaskChat, listTaskChatSessions, loadTaskChatSession } from '@/api/taskChat';

// 复用 shared 统一形态;导出别名让组件 import { Block, Turn } 不破。
export type Block = ChatBlock;
export type Turn = ChatTurn;

/** 终态 usage(result 事件) */
export interface TurnUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
}

interface TaskChatState {
  turns: Turn[];
  streaming: boolean;
  /** 续接用 claude session_id(来自 result 事件) */
  sessionId?: string;
  error?: string;
  usage?: TurnUsage;
  /** 该仓库下的历史会话列表 */
  sessions?: ChatSessionSummary[];
  /** 跑哪一侧的 claude:windows(默认)/ wsl。切侧会换 session 池 */
  side: 'windows' | 'wsl';
}

interface TaskChatStore {
  chats: Record<string, TaskChatState>;
  /** 发送一轮对话:推入用户消息 → 流式拉取并归一化 assistant 回复 */
  send: (taskId: string, message: string) => Promise<void>;
  /** 中断当前轮(用户点「停止」):abort fetch → 后端 kill claude 子进程 */
  stop: (taskId: string) => void;
  /** 切换 claude 侧(windows/wsl);切侧清空当前 turns 与 sessionId(不同侧 session 池不同) */
  setSide: (taskId: string, side: 'windows' | 'wsl') => void;
  /** 拉取该任务仓库下的历史会话列表 */
  loadSessions: (taskId: string) => Promise<void>;
  /** 加载某历史会话的消息时间线,并把它设为续接 sessionId(接着聊) */
  loadHistory: (taskId: string, sessionId: string, side: 'windows' | 'wsl') => Promise<void>;
  /** 取某任务的对话状态(无则返回空态) */
  getState: (taskId: string) => TaskChatState;
  /** 清空某任务的对话(不含 sessionId,sessionId 留着以便续接) */
  clearMessages: (taskId: string) => void;
}

const EMPTY: TaskChatState = { turns: [], streaming: false, side: 'windows' };

/** 每任务当前的 AbortController(停止用) */
const controllers = new Map<string, AbortController>();

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** 从 assistant 事件里取 message.content 数组(兼容缺失情况) */
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
 * 处理单个 AgentEvent,就地更新某任务的 assistant 当前轮(blocks 末尾追加/合并)。
 * 返回新的 turns 数组(不可变更新)。
 */
function applyEvent(turns: Turn[], ev: AgentEvent): Turn[] {
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

export const useTaskChatStore = create<TaskChatStore>((set, get) => ({
  chats: {},

  getState: (taskId) => get().chats[taskId] ?? EMPTY,

  clearMessages: (taskId) =>
    set((state) => ({
      chats: {
        ...state.chats,
        [taskId]: { ...state.chats[taskId], turns: [], error: undefined },
      },
    })),

  stop: (taskId) => {
    controllers.get(taskId)?.abort();
  },

  setSide: (taskId, side) =>
    set((state) => ({
      chats: {
        ...state.chats,
        // 切侧:两套 claude 的 session 池不同(Windows/WSL home 不同),清空当前对话与续接 id,
        // 避免拿 Windows 的 sessionId 去 resume WSL claude(会报 session 不存在)。
        [taskId]: { ...EMPTY, side, sessions: state.chats[taskId]?.sessions },
      },
    })),

  loadSessions: async (taskId) => {
    try {
      const { sessions } = await listTaskChatSessions(taskId);
      set((state) => ({
        chats: { ...state.chats, [taskId]: { ...(state.chats[taskId] ?? EMPTY), sessions } },
      }));
    } catch (error) {
      // 历史列表加载失败不阻塞对话,但留痕便于排查(CLAUDE.md 禁止空 catch)
      console.warn('[taskChatStore] loadSessions 失败', error);
    }
  },

  loadHistory: async (taskId, sessionId, side) => {
    try {
      const { turns } = await loadTaskChatSession(taskId, sessionId);
      set((state) => ({
        chats: {
          ...state.chats,
          [taskId]: {
            ...(state.chats[taskId] ?? EMPTY),
            turns,
            sessionId, // 设为续接目标,下一轮 send 走 --resume
            side, // 历史会话属于哪一侧,续接必须在同侧 claude
            error: undefined,
            usage: undefined,
          },
        },
      }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      set((state) => ({
        chats: { ...state.chats, [taskId]: { ...(state.chats[taskId] ?? EMPTY), error: msg } },
      }));
    }
  },

  send: async (taskId, message) => {
    // 推入用户消息 + 占位 assistant 轮
    const userTurn: Turn = { id: uid(), role: 'user', text: message };
    set((state) => {
      const prev = state.chats[taskId] ?? EMPTY;
      return {
        chats: {
          ...state.chats,
          [taskId]: {
            ...prev,
            turns: [...prev.turns, userTurn],
            streaming: true,
            error: undefined,
            usage: undefined,
          },
        },
      };
    });

    // 本轮的 AbortController(停止用)
    const controller = new AbortController();
    controllers.set(taskId, controller);
    const cur = useTaskChatStore.getState().chats[taskId];
    // 续接 sessionId:加载历史后接着聊,或沿用上次 result 的 sessionId
    const resumeSessionId = cur?.sessionId;
    const side = cur?.side ?? 'windows';

    try {
      for await (const ev of streamTaskChat(taskId, message, controller.signal, resumeSessionId, side)) {
        if (ev.type === 'result') {
          const usage = ev.usage as TurnUsage | undefined;
          set((state) => ({
            chats: {
              ...state.chats,
              [taskId]: {
                ...(state.chats[taskId] ?? EMPTY),
                sessionId:
                  typeof ev.session_id === 'string'
                    ? (ev.session_id as string)
                    : state.chats[taskId]?.sessionId,
                usage,
                error:
                  ev.subtype === 'error' || ev.is_error === true
                    ? typeof ev.result === 'string'
                      ? ev.result
                      : '对话出错'
                    : undefined,
                streaming: false,
              },
            },
          }));
        } else if (ev.type === 'error') {
          const msg = typeof ev.message === 'string' ? ev.message : '对话异常';
          set((state) => ({
            chats: {
              ...state.chats,
              [taskId]: { ...(state.chats[taskId] ?? EMPTY), error: msg, streaming: false },
            },
          }));
        } else {
          // assistant / user:归一化进 blocks
          set((state) => {
            const prev = state.chats[taskId] ?? EMPTY;
            return {
              chats: {
                ...state.chats,
                [taskId]: { ...prev, turns: applyEvent(prev.turns, ev) },
              },
            };
          });
        }
      }
      // 流正常结束但没收到 result 事件:兜底关闭 streaming
      set((state) => {
        const cur = state.chats[taskId];
        if (!cur?.streaming) return {};
        return { chats: { ...state.chats, [taskId]: { ...cur, streaming: false } } };
      });
    } catch (error) {
      // 用户主动停止(AbortError):不报错,只关闭 streaming,保留已生成的内容
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      set((state) => ({
        chats: {
          ...state.chats,
          [taskId]: {
            ...(state.chats[taskId] ?? EMPTY),
            streaming: false,
            error: aborted ? undefined : error instanceof Error ? error.message : String(error),
          },
        },
      }));
    } finally {
      controllers.delete(taskId);
    }
  },
}));
