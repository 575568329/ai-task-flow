// frontend/src/stores/projectChatStore.ts
// 项目对话(悬浮窗)状态:按项目聚合的会话列表 + per-project 当前对话记忆。
// 关键模型:每个项目(repoPath)在 conversations 里记一个"当前激活对话";
//   - 切项目 = 换 activeRepoPath,current 自动落到该项目的记忆对话(若有),否则 ensureActive 建空。
//   - 一个项目下可有多个历史会话,但悬浮窗里每项目只展示"当前那一个",靠顶栏历史按钮切换。
//   - 悬浮窗 chat-first:无"列表视图"入口,进入即对话;关窗不清 conversations(再开仍记得)。
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

/** 单个项目的当前对话(悬浮窗每项目记一个) */
export interface CurrentConversation {
  /** 对话的 cwd(项目仓库路径,发消息必带) */
  repoPath: string;
  /** 续接的历史会话 id;新建对话时 undefined,首轮 result 后填入 */
  sessionId?: string;
  /** 跑哪一侧的 claude */
  side: 'windows' | 'wsl';
  /** 对话标题(历史会话传入,顶栏展示);新建对话时 undefined */
  title?: string;
  /** 关联任务标题(该会话曾拉取过 MCP 任务,从 usage.taskId 反查) */
  taskTitle?: string;
  turns: ChatTurn[];
  streaming: boolean;
  /** 历史会话加载中(openSession 拉时间线期间,消息流区显示 spinner) */
  loading?: boolean;
  /** 输入框草稿(per-project 记忆:切项目不串草稿,切回恢复) */
  draft?: string;
  error?: string;
  usage?: ProjectTurnUsage;
}

interface ProjectChatStore {
  /** 按项目聚合的会话视图(项目 tab + 历史 Popover 数据源) */
  projects: ProjectChatGroup[];
  projectsLoading: boolean;
  /** 每个项目的当前对话(记忆:切项目恢复;关窗不清,页面刷新才重置) */
  conversations: Record<string, CurrentConversation>;
  /** 当前激活的项目 tab(repoPath) */
  activeRepoPath: string | null;
  /** 悬浮窗是否展开(悬浮球点击切换) */
  open: boolean;

  /** 悬浮球:展开悬浮窗(默认进对话视图) */
  openWindow: () => void;
  /** 任务卡片/详情入口:展开悬浮窗并定位到指定项目 tab */
  openForRepo: (repoPath: string) => void;
  closeWindow: () => void;
  /** 拉取项目聚合视图 */
  loadProjects: () => Promise<void>;
  /** 切换项目 tab(恢复该项目记忆对话,或建空) */
  selectProject: (repoPath: string) => void;
  /** 打开某历史会话(加载时间线,写入该项目的当前对话) */
  openSession: (
    repoPath: string,
    sessionId: string,
    side: 'windows' | 'wsl',
    meta?: { title?: string; taskTitle?: string },
  ) => Promise<void>;
  /** 在指定项目新建空对话(发首条消息才建会话);side 读当前项目对话记忆,默认 windows */
  startNew: (repoPath: string) => void;
  /** 更新某项目输入框草稿(per-project 记忆,切项目不串) */
  setDraft: (repoPath: string, text: string) => void;
  /** 发送一轮对话 */
  send: (message: string) => Promise<void>;
  /** 中断当前轮 */
  stop: () => void;
  /** 切换 claude 侧(清空当前项目对话,不同侧 session 池不同) */
  setSide: (side: 'windows' | 'wsl') => void;
}

/** 悬浮窗同一时刻只跑一个对话(切项目前先 stop),abort controller 用单例 */
let controller: AbortController | null = null;

/** 构造一个空对话(新建 / 切侧 / ensureActive 用) */
function emptyConv(repoPath: string, side: 'windows' | 'wsl' = 'windows'): CurrentConversation {
  return { repoPath, side, turns: [], streaming: false };
}

export const useProjectChatStore = create<ProjectChatStore>((set, get) => {
  // 当前激活项目是否正在流式(切换/关窗前据此 stop,避免悬空流的结果污染新会话)
  const activeStreaming = (): boolean => {
    const { activeRepoPath, conversations } = get();
    return activeRepoPath ? conversations[activeRepoPath]?.streaming ?? false : false;
  };

  // 写入/覆盖某项目的当前对话(openSession/startNew/setSide 用)
  const setConv = (repoPath: string, next: CurrentConversation) =>
    set((s) => ({ conversations: { ...s.conversations, [repoPath]: next } }));

  // 更新指定项目的对话(send 流式事件用闭包 repoPath:切项目后旧流仍写原项目,不污染新激活项目)
  const updateConv = (
    rp: string,
    updater: (cur: CurrentConversation) => CurrentConversation,
  ) =>
    set((s) => {
      const cur = s.conversations[rp];
      if (!cur) return {};
      return { conversations: { ...s.conversations, [rp]: updater(cur) } };
    });

  // 若某项目尚无记忆对话,写入空新对话。切项目/进窗时调用(记忆恢复或首次建空)
  const ensureActive = (repoPath: string) =>
    set((s) =>
      s.conversations[repoPath]
        ? {}
        : { conversations: { ...s.conversations, [repoPath]: emptyConv(repoPath) } },
    );

  return {
    projects: [],
    projectsLoading: false,
    conversations: {},
    activeRepoPath: null,
    open: false,

    // 展开=进对话视图。已有 projects 则 ensureActive 当前/首个项目;无则 loadProjects
    // (load 完内部 ensureActive 首个项目)。不先进列表。
    openWindow: () => {
      // 不中断正在跑的流(与 closeWindow 一致):再开窗时进行中的对话继续可见
      set({ open: true });
      const { projects, activeRepoPath, projectsLoading } = get();
      if (projects.length === 0 && !projectsLoading) {
        void get().loadProjects();
        return;
      }
      const target = activeRepoPath ?? projects[0]?.repoPath;
      if (target) {
        if (!activeRepoPath) set({ activeRepoPath: target });
        ensureActive(target);
      }
    },

    // 任务卡片/详情入口:定位到该项目 tab + 进对话视图(恢复记忆或建空)
    openForRepo: (repoPath) => {
      // 不中断正在跑的流(与 closeWindow 一致):旧流闭包锁旧项目,不污染新定位项目
      set({ open: true, activeRepoPath: repoPath });
      ensureActive(repoPath);
      if (get().projects.length === 0 && !get().projectsLoading) void get().loadProjects();
    },

    // 关窗=收起:不中断正在跑的流(用户要求)。流闭包锁项目,结果写入该项目对话记忆,再开窗仍可见
    closeWindow: () => {
      set({ open: false });
    },

    loadProjects: async () => {
      set({ projectsLoading: true });
      try {
        const { projects } = await fetchProjectChats();
        set({ projects, projectsLoading: false });
        if (projects.length > 0) {
          // 默认激活第一个(若当前无激活),并 ensureActive 让首项目进对话视图
          if (!get().activeRepoPath) set({ activeRepoPath: projects[0].repoPath });
          const active = get().activeRepoPath;
          if (active) ensureActive(active);
        }
      } catch (error) {
        set({ projectsLoading: false });
        // 加载失败留痕,不阻断(悬浮窗显示空/错误提示)
        console.warn('[projectChatStore] loadProjects 失败', error);
      }
    },

    // 切项目 tab = 看另一个项目当前那一个对话(恢复记忆;无记忆则建空)。不再回列表。
    selectProject: (repoPath) => {
      if (activeStreaming()) get().stop();
      set({ activeRepoPath: repoPath });
      ensureActive(repoPath);
    },

    openSession: async (repoPath, sessionId, side, meta) => {
      // 进入(切换)历史会话前先中断当前流,避免旧流结果污染新会话
      if (activeStreaming()) get().stop();
      // 先置 loading,顶栏/消息流显示加载态
      setConv(repoPath, {
        repoPath,
        sessionId,
        side,
        title: meta?.title,
        taskTitle: meta?.taskTitle,
        turns: [],
        streaming: false,
        loading: true,
      });
      try {
        const { turns } = await loadProjectSession(repoPath, sessionId);
        setConv(repoPath, {
          repoPath,
          sessionId,
          side,
          title: meta?.title,
          taskTitle: meta?.taskTitle,
          turns,
          streaming: false,
          loading: false,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        setConv(repoPath, {
          repoPath,
          sessionId,
          side,
          title: meta?.title,
          taskTitle: meta?.taskTitle,
          turns: [],
          streaming: false,
          loading: false,
          error: msg,
        });
      }
    },

    // 指定项目新建空对话(发首条消息才真正建 claude session,延迟创建)。
    // side 不由调用方传:统一读当前项目对话的 side(由 ConversationPanel 输入区 setSide 设置),
    // 默认 windows。side 选择权集中在输入区,符合"切侧仅新建对话时用"的交互(步骤 4),
    // 也避免 SessionList onNew 漏传 side 导致新会话进错池子(/resume 找不到)。
    startNew: (repoPath) => {
      if (activeStreaming()) get().stop();
      const side = get().conversations[repoPath]?.side ?? 'windows';
      setConv(repoPath, emptyConv(repoPath, side));
    },

    // 更新某项目输入框草稿(per-project 记忆)
    setDraft: (repoPath, text) => updateConv(repoPath, (c) => ({ ...c, draft: text })),

    setSide: (side) => {
      // 切侧:两套 claude session 池不同,清空当前项目对话(同 taskChatStore.setSide 理由)
      const { activeRepoPath } = get();
      if (!activeRepoPath) return;
      if (activeStreaming()) get().stop();
      setConv(activeRepoPath, emptyConv(activeRepoPath, side));
    },

    stop: () => {
      controller?.abort();
    },

    send: async (message) => {
      const { activeRepoPath, conversations } = get();
      if (!activeRepoPath) return;
      const cur = conversations[activeRepoPath];
      if (!cur || cur.streaming) return;

      // 闭包锁定本次发送所属项目:切项目后旧流仍写该项目,不污染新激活项目
      const { repoPath, sessionId, side } = cur;

      // 推入用户消息 + 开启流式
      const userTurn: ChatTurn = { id: chatEventUid(), role: 'user', text: message };
      updateConv(repoPath, (c) => ({
        ...c,
        turns: [...c.turns, userTurn],
        streaming: true,
        error: undefined,
        usage: undefined,
      }));

      controller = new AbortController();

      try {
        for await (const ev of streamProjectChat(repoPath, message, controller.signal, sessionId, side)) {
          if (ev.type === 'result') {
            const usage = ev.usage as ProjectTurnUsage | undefined;
            const prevSessionId = get().conversations[repoPath]?.sessionId;
            const newSessionId =
              typeof ev.session_id === 'string' ? (ev.session_id as string) : undefined;
            updateConv(repoPath, (c) => ({
              ...c,
              sessionId: newSessionId ?? c.sessionId,
              usage,
              error:
                ev.subtype === 'error' || ev.is_error === true
                  ? typeof ev.result === 'string'
                    ? ev.result
                    : '对话出错'
                  : undefined,
              streaming: false,
            }));
            // 新建会话(首次拿到 sessionId):刷新项目聚合,让新会话进左栏历史列表(步骤 7a)
            if (!prevSessionId && newSessionId) {
              void get().loadProjects();
            }
          } else if (ev.type === 'error') {
            const msg = typeof ev.message === 'string' ? ev.message : '对话异常';
            updateConv(repoPath, (c) => ({ ...c, error: msg, streaming: false }));
          } else {
            // assistant / user:归一化进 blocks
            updateConv(repoPath, (c) => ({ ...c, turns: applyChatEvent(c.turns, ev) }));
          }
        }
        // 流正常结束但没收到 result:兜底关闭 streaming
        const after = get().conversations[repoPath];
        if (after?.streaming) updateConv(repoPath, (c) => ({ ...c, streaming: false }));
      } catch (error) {
        const aborted = error instanceof DOMException && error.name === 'AbortError';
        updateConv(repoPath, (c) => ({
          ...c,
          streaming: false,
          error: aborted ? undefined : error instanceof Error ? error.message : String(error),
        }));
      } finally {
        controller = null;
      }
    },
  };
});
