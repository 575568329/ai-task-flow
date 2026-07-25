// frontend/src/stores/projectChatStore.ts
// 项目对话(悬浮窗)状态:按项目聚合的会话列表 + per-project 当前对话记忆。
// 关键模型:每个项目(repoPath)在 conversations 里记一个"当前激活对话";
//   - 切项目 = 换 activeRepoPath,current 自动落到该项目的记忆对话(若有),否则 ensureActive 建空。
//   - 一个项目下可有多个历史会话,但悬浮窗里每项目只展示"当前那一个",靠顶栏历史按钮切换。
//   - 悬浮窗 chat-first:无"列表视图"入口,进入即对话;关窗不清 conversations(再开仍记得)。
// 事件归一化复用 lib/chatEvents(applyChatEvent),SSE 复用 api/projectChat。
import { create } from 'zustand';
import type { ChatTurn, ImageAttachment, ProjectChatGroup } from '@ai-task-flow/shared';
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
  /** 在指定项目新建空对话(发首条消息才建会话);side 由 SessionList 新建按钮传入,未传则兜底当前项目或 windows */
  startNew: (repoPath: string, side?: 'windows' | 'wsl') => void;
  /** 更新某项目输入框草稿(per-project 记忆,切项目不串) */
  setDraft: (repoPath: string, text: string) => void;
  /** 发送一轮对话;images 为粘贴图片(复用 shared ImageAttachment) */
  send: (message: string, images?: ImageAttachment[]) => Promise<void>;
  /** 中断当前轮 */
  stop: () => void;
  /** 切换 claude 侧(清空当前项目对话,不同侧 session 池不同) */
  setSide: (side: 'windows' | 'wsl') => void;
}

/** per-repoPath 的 AbortController:stop() 只中止当前项目可见的流,后台流不受影响 */
const controllers: Record<string, AbortController | null> = {};

/** 流所有权:send() 分配自增 id,stream 回调验证自己仍是当前 owner 才写 store。
 *  openSession/startNew 不改变 owner(它们不再 stop 流),只有新的 send() 才会接管。
 *  旧流 owner 不匹配 → 跳过写入 → 流在后台继续跑,结果由后端持久化,用户切回该会话时可见。 */
let nextStreamId = 0;
const streamOwners: Record<string, number> = {};

/** 按 repoPath 跟踪 openSession 异步加载版本:startNew / 再次 openSession 时 +1,
 *  加载完成时校验——版本不匹配说明 stale,丢弃结果避免幽灵内容(#9c2269c0)。 */
const loadVersions: Record<string, number> = {};
function bumpLoadVersion(repoPath: string): number {
  const next = (loadVersions[repoPath] ?? 0) + 1;
  loadVersions[repoPath] = next;
  return next;
}

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

    // 切项目 tab = 看另一个项目当前那一个对话(恢复记忆;无记忆则建空)。
    // 不 stop 上一个项目的流:send() 用闭包锁了旧 repoPath,updateConv 写回旧项目,
    // 切项目后旧流继续在后台跑,互不污染。用户要求:切换对话不影响后台任务。
    selectProject: (repoPath) => {
      set({ activeRepoPath: repoPath });
      ensureActive(repoPath);
    },

    // openSession 异步加载历史会话期间,startNew 可能已被调用;用 version 检测 stale 写入避免幽灵内容。
    // 不 stop 当前流:send() 用 streamOwners 跟踪所有权,旧流检测到 owner 不匹配时跳过 store 写入,
    // 流仍在后台继续跑,结果由后端持久化,用户切回该会话时 openSession 重新加载即可看到。
    openSession: async (repoPath, sessionId, side, meta) => {
      const version = bumpLoadVersion(repoPath);
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
        // startNew / 再次 openSession 已触发,丢弃过期结果(否则旧会话 turns 写进新空对话)
        if (loadVersions[repoPath] !== version) return;
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
        if (loadVersions[repoPath] !== version) return;
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
    // side 优先取 SessionList 新建按钮传入的 side(用户明确选了 Win/WSL),
    // 否则兜底当前项目对话记忆,默认 windows。
    startNew: (repoPath, side) => {
      bumpLoadVersion(repoPath); // 废弃任何进行中的 openSession 异步加载
      // 不 stop 当前流:理由同 openSession——streamOwners 机制保证旧流不污染新对话
      const resolvedSide = side ?? get().conversations[repoPath]?.side ?? 'windows';
      setConv(repoPath, emptyConv(repoPath, resolvedSide));
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
      const { activeRepoPath } = get();
      if (activeRepoPath) controllers[activeRepoPath]?.abort();
    },

    send: async (message: string, images?: ImageAttachment[]) => {
      const { activeRepoPath, conversations } = get();
      if (!activeRepoPath) return;
      const cur = conversations[activeRepoPath];
      if (!cur || cur.streaming) return;

      // 闭包锁定本次发送所属项目:切项目后旧流仍写该项目,不污染新激活项目
      const { repoPath, sessionId, side } = cur;

      // 流所有权:openSession/startNew 不 stop 流,仅 send() 接管所有权。
      // 旧流回调检测 owner 不匹配 → 跳过 store 写入 → 流在后台继续跑。
      const myStreamId = ++nextStreamId;
      streamOwners[repoPath] = myStreamId;

      // 推入用户消息 + 开启流式;图片缩略图用 data URL 存储以便消息流渲染
      const userTurn: ChatTurn = {
        id: chatEventUid(),
        role: 'user',
        text: message,
        images: images?.map((img) => `data:${img.mediaType};base64,${img.data}`),
      };
      updateConv(repoPath, (c) => ({
        ...c,
        turns: [...c.turns, userTurn],
        streaming: true,
        error: undefined,
        usage: undefined,
      }));

      controllers[repoPath] = new AbortController();
      const signal = controllers[repoPath]!.signal;

      try {
        for await (const ev of streamProjectChat({ repoPath, message, signal, sessionId, side, images })) {
          // 即使不是当前 owner,也从 result 事件提取 sessionId 写入 conversation 元数据,
          // 避免快速连续 send 时旧 owner 的 sessionId 永久丢失(前端不知道孤立的会话)。
          if (streamOwners[repoPath] !== myStreamId) {
            if (ev.type === 'result') {
              const orphanSessionId = typeof ev.session_id === 'string' ? (ev.session_id as string) : undefined;
              if (orphanSessionId && !get().conversations[repoPath]?.sessionId) {
                updateConv(repoPath, (c) => ({ ...c, sessionId: orphanSessionId }));
                // 刷新项目聚合,让新会话进左栏历史列表(用户可手动 openSession 加载)
                void get().loadProjects();
              }
            }
            continue;
          }

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
        // 流正常结束但没收到 result:兜底关闭 streaming(仅当仍是 owner)
        if (streamOwners[repoPath] === myStreamId) {
          const after = get().conversations[repoPath];
          if (after?.streaming) updateConv(repoPath, (c) => ({ ...c, streaming: false }));
        }
      } catch (error) {
        // 仅当仍是 owner 时才写错误状态
        if (streamOwners[repoPath] !== myStreamId) return;
        const aborted = error instanceof DOMException && error.name === 'AbortError';
        updateConv(repoPath, (c) => ({
          ...c,
          streaming: false,
          error: aborted ? undefined : error instanceof Error ? error.message : String(error),
        }));
      } finally {
        controllers[repoPath] = null;
      }
    },
  };
});
