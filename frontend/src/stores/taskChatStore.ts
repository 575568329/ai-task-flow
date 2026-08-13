// frontend/src/stores/taskChatStore.ts
// 任务对话状态:按 taskId 分桶,消费后端透传的 stream-json 事件并编排渲染用 turns/blocks。
// 归一化逻辑(applyEvent)抽到 ./chat/applyEvent(纯函数,可单测 + Phase 2 历史回放复用);
// 本文件负责状态编排与 SSE 消费。终态 result → 落 sessionId(供下轮续接)+ usage,流结束。
import { create } from 'zustand';
import type { AgentEvent, ChatBlock, ChatTurn, ChatSessionSummary } from '@ai-task-flow/shared';
import { streamTaskChat, listTaskChatSessions, loadTaskChatSession, renameTaskChatSession } from '@/api/taskChat';
import { applyEvent, uid } from './chat/applyEvent';

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
  /** 重命名会话(看板侧自定义标题),更新本地 sessions 列表 */
  renameSession: (taskId: string, sessionId: string, title: string) => Promise<void>;
  /** 取某任务的对话状态(无则返回空态) */
  getState: (taskId: string) => TaskChatState;
  /** 清空某任务的对话(不含 sessionId,sessionId 留着以便续接) */
  clearMessages: (taskId: string) => void;
}

const EMPTY: TaskChatState = { turns: [], streaming: false, side: 'windows' };

/** 每任务当前的 AbortController(停止用) */
const controllers = new Map<string, AbortController>();

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

  renameSession: async (taskId, sessionId, title) => {
    try {
      await renameTaskChatSession(taskId, sessionId, title);
      set((state) => {
        const cur = state.chats[taskId];
        if (!cur?.sessions) return {};
        return {
          chats: {
            ...state.chats,
            [taskId]: {
              ...cur,
              sessions: cur.sessions.map((s) =>
                s.sessionId === sessionId ? { ...s, title } : s,
              ),
            },
          },
        };
      });
    } catch (error) {
      // 重命名失败不阻断,留痕排查(CLAUDE.md 禁止空 catch)
      console.warn('[taskChatStore] renameSession 失败', error);
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

    // I4 节流:thinking_delta 高频(百级/秒)逐条 set 会卡顿。累积 stream_event 到 pending,
    // 用 requestAnimationFrame 每帧批量 applyEvent + set 一次(60fps → 60 set/秒,流畅)。
    // assistant/user/result/error 等「非 stream_event」到达前先 flushNow,保证顺序——
    // 终态 assistant 的 thinking 去重依赖 stream_event 已构建的末尾 thinking block。
    let pendingStreamEvs: AgentEvent[] = [];
    let rafId: number | null = null;
    const flushStream = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      const evs = pendingStreamEvs;
      pendingStreamEvs = [];
      if (evs.length === 0) return;
      set((state) => {
        const prev = state.chats[taskId] ?? EMPTY;
        let turns = prev.turns;
        for (const e of evs) turns = applyEvent(turns, e);
        return { chats: { ...state.chats, [taskId]: { ...prev, turns } } };
      });
    };
    const scheduleFlush = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(flushStream);
    };

    try {
      for await (const ev of streamTaskChat(taskId, message, controller.signal, resumeSessionId, side)) {
        if (ev.type === 'result') {
          flushStream(); // 先冲掉残留的 thinking 增量,再落终态
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
          flushStream();
          const msg = typeof ev.message === 'string' ? ev.message : '对话异常';
          set((state) => ({
            chats: {
              ...state.chats,
              [taskId]: { ...(state.chats[taskId] ?? EMPTY), error: msg, streaming: false },
            },
          }));
        } else if (ev.type === 'stream_event') {
          // 累积到帧缓冲,由 rAF 批量 flush(高频增量合批,降 set 次数)
          pendingStreamEvs.push(ev);
          scheduleFlush();
        } else {
          // assistant / user:先冲掉残留增量,再归一化(保证去重依赖的顺序)
          flushStream();
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
      flushStream();
      set((state) => {
        const cur = state.chats[taskId];
        if (!cur?.streaming) return {};
        return { chats: { ...state.chats, [taskId]: { ...cur, streaming: false } } };
      });
    } catch (error) {
      flushStream();
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
      // 流结束:取消未触发的 rAF,避免泄漏(已 flush 过则 rafId 为 null,no-op)
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      controllers.delete(taskId);
    }
  },
}));
