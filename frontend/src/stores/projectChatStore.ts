// frontend/src/stores/projectChatStore.ts
// 项目对话(悬浮窗)状态:按项目聚合的会话列表 + 当前对话视图(列表/对话双态)。
// 与 taskChatStore 的区别:不绑 taskId,对话以 repoPath(项目)为根;一次只看一个对话(非多 tab)。
// 事件归一化复用 lib/chatEvents(applyChatEvent),SSE 复用 api/projectChat。
import { create } from 'zustand';
import type { ChatTurn, ProjectChatGroup } from '@ai-task-flow/shared';
import { applyChatEvent, chatEventUid } from '@/lib/chatEvents';
import { fetchProjectChats, loadProjectSession, streamProjectChat } from '@/api/projectChat';

/** 终态 usage(result 事件,与 taskChatStore.TurnUsage 同形) */
export interface ProjectTurnUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
}

/** 当前打开的对话(列表视图时为 null) */
interface CurrentConversation {
  /** 对话的 cwd(项目仓库路径,发消息必带) */
  repoPath: string;
  /** 续接的历史会话 id;新建对话时 undefined,首轮 result 后填入 */
  sessionId?: string;
  /** 跑哪一侧的 claude */
  side: 'windows' | 'wsl';
  /** 对话标题(列表项传入,顶栏展示);新建对话时 undefined */
  title?: string;
  /** 关联任务标题(该会话曾拉取过 MCP 任务,从 usage.taskId 反查) */
  taskTitle?: string;
  turns: ChatTurn[];
  streaming: boolean;
  error?: string;
  usage?: ProjectTurnUsage;
}

interface ProjectChatStore {
  /** 按项目聚合的会话视图(项目 tab + 对话列表) */
  projects: ProjectChatGroup[];
  projectsLoading: boolean;
  /** 当前视图:列表 / 对话 */
  view: 'list' | 'chat';
  /** 当前激活的项目 tab(repoPath) */
  activeRepoPath: string | null;
  /** 当前对话(对话视图时非空) */
  current: CurrentConversation | null;
  /** 悬浮窗是否展开(悬浮球点击切换) */
  open: boolean;

  /** 悬浮球:展开悬浮窗(默认列表视图) */
  openWindow: () => void;
  /** 任务卡片/详情入口:展开悬浮窗并定位到指定项目 tab */
  openForRepo: (repoPath: string) => void;
  closeWindow: () => void;
  /** 拉取项目聚合视图 */
  loadProjects: () => Promise<void>;
  /** 切换项目 tab */
  selectProject: (repoPath: string) => void;
  /** 打开某历史会话(加载时间线 + 进对话视图 resume) */
  openSession: (
    repoPath: string,
    sessionId: string,
    side: 'windows' | 'wsl',
    meta?: { title?: string; taskTitle?: string },
  ) => Promise<void>;
  /** 在当前项目新建对话(空对话视图,发首条消息才建会话) */
  startNew: (repoPath: string, side: 'windows' | 'wsl') => void;
  /** 发送一轮对话 */
  send: (message: string) => Promise<void>;
  /** 中断当前轮 */
  stop: () => void;
  /** 切换 claude 侧(清空当前对话,不同侧 session 池不同) */
  setSide: (side: 'windows' | 'wsl') => void;
  /** 返回列表视图(并刷新,新对话可能已产生新 session) */
  backToList: () => void;
}

/** 悬浮窗同一时刻只跑一个对话,abort controller 用单例 key */
let controller: AbortController | null = null;

export const useProjectChatStore = create<ProjectChatStore>((set, get) => ({
  projects: [],
  projectsLoading: false,
  view: 'list',
  activeRepoPath: null,
  current: null,
  open: false,

  openWindow: () => {
    set({ open: true });
    // 首次展开拉一次项目列表(后续 backToList 也会刷新)
    if (get().projects.length === 0 && !get().projectsLoading) {
      void get().loadProjects();
    }
  },

  // 任务卡片/详情入口:定位到指定项目 tab。
  // 先设 activeRepoPath 再触发 loadProjects;loadProjects 内部仅「无激活时」才默认第一个,
  // 已设的 activeRepoPath 不会被覆盖,加载完成后直接落在目标项目 tab。
  openForRepo: (repoPath) => {
    set({ open: true, activeRepoPath: repoPath });
    if (get().projects.length === 0 && !get().projectsLoading) void get().loadProjects();
  },

  closeWindow: () => set({ open: false }),

  loadProjects: async () => {
    set({ projectsLoading: true });
    try {
      const { projects } = await fetchProjectChats();
      set({ projects, projectsLoading: false });
      // 默认激活第一个项目 tab(若当前无激活)
      if (!get().activeRepoPath && projects.length > 0) {
        set({ activeRepoPath: projects[0].repoPath });
      }
    } catch (error) {
      set({ projectsLoading: false });
      // 加载失败留痕,不阻断(悬浮窗显示空/错误提示)
      console.warn('[projectChatStore] loadProjects 失败', error);
    }
  },

  selectProject: (repoPath) => set({ activeRepoPath: repoPath }),

  openSession: async (repoPath, sessionId, side, meta) => {
    try {
      const { turns } = await loadProjectSession(repoPath, sessionId);
      set({
        view: 'chat',
        current: {
          repoPath,
          sessionId,
          side,
          title: meta?.title,
          taskTitle: meta?.taskTitle,
          turns,
          streaming: false,
          error: undefined,
          usage: undefined,
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      set({
        view: 'chat',
        current: {
          repoPath,
          sessionId,
          side,
          title: meta?.title,
          taskTitle: meta?.taskTitle,
          turns: [],
          streaming: false,
          error: msg,
        },
      });
    }
  },

  startNew: (repoPath, side) =>
    set({
      view: 'chat',
      current: { repoPath, side, turns: [], streaming: false, error: undefined },
    }),

  setSide: (side) => {
    const cur = get().current;
    if (!cur) return;
    // 切侧:两套 claude session 池不同,清空当前对话与续接 id(同 taskChatStore.setSide 理由)
    set({ current: { repoPath: cur.repoPath, side, turns: [], streaming: false } });
  },

  backToList: () => {
    set({ current: null, view: 'list' });
    // 返回列表刷新:刚新建/续接的对话可能产生新 session,列表需反映
    void get().loadProjects();
  },

  stop: () => {
    controller?.abort();
  },

  send: async (message) => {
    const cur = get().current;
    if (!cur || cur.streaming) return;

    // 推入用户消息 + 开启流式
    const userTurn: ChatTurn = { id: chatEventUid(), role: 'user', text: message };
    set({
      current: { ...cur, turns: [...cur.turns, userTurn], streaming: true, error: undefined, usage: undefined },
    });

    controller = new AbortController();
    const { repoPath, sessionId, side } = get().current!;

    try {
      for await (const ev of streamProjectChat(repoPath, message, controller.signal, sessionId, side)) {
        if (ev.type === 'result') {
          const usage = ev.usage as ProjectTurnUsage | undefined;
          set((s) => ({
            current: s.current
              ? {
                  ...s.current,
                  sessionId:
                    typeof ev.session_id === 'string'
                      ? (ev.session_id as string)
                      : s.current.sessionId,
                  usage,
                  error:
                    ev.subtype === 'error' || ev.is_error === true
                      ? typeof ev.result === 'string'
                        ? ev.result
                        : '对话出错'
                      : undefined,
                  streaming: false,
                }
              : s.current,
          }));
        } else if (ev.type === 'error') {
          const msg = typeof ev.message === 'string' ? ev.message : '对话异常';
          set((s) => ({ current: s.current ? { ...s.current, error: msg, streaming: false } : s.current }));
        } else {
          // assistant / user:归一化进 blocks
          set((s) => ({
            current: s.current ? { ...s.current, turns: applyChatEvent(s.current.turns, ev) } : s.current,
          }));
        }
      }
      // 流正常结束但没收到 result:兜底关闭 streaming
      set((s) => {
        if (!s.current?.streaming) return {};
        return { current: { ...s.current, streaming: false } };
      });
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      set((s) => ({
        current: s.current
          ? {
              ...s.current,
              streaming: false,
              error: aborted ? undefined : error instanceof Error ? error.message : String(error),
            }
          : s.current,
      }));
    } finally {
      controller = null;
    }
  },
}));
