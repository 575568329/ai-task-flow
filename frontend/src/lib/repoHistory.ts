// frontend/src/lib/repoHistory.ts
// 全局仓库路径历史(localStorage 单一来源)。
// 看板「打开终端」/ 编辑任务仓库路径 / 文档中心项目文件夹 等 repo-path
// 选择器共享此历史:任意一处确认的合法路径都写入,其它入口立即可见,
// 避免每处各自从任务字段挖掘(会混入任务标题/描述等脏数据)。

const STORAGE_KEY = 'ai-task-flow-repo-history';
const MAX_HISTORY = 20;
const EVENT = 'repo-history-changed';

/** 合法仓库路径:Windows 盘符根(D:\ / D:/)或 POSIX 绝对路径(/...)。
 *  用此过滤误存的脏数据(任务标题/描述片段,如「使用者手机号…」)。 */
export const VALID_REPO_PATH = /^[A-Za-z]:[\\/]|^\//;

export function loadRepoHistory(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (p): p is string => typeof p === 'string' && VALID_REPO_PATH.test(p),
    );
  } catch {
    return [];
  }
}

function persist(list: string[]): string[] {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  // 同 tab 通知已挂载的选择器重载(storage 事件只跨 tab,不触发本 tab)
  window.dispatchEvent(new CustomEvent(EVENT));
  return list;
}

/** 加入历史(去重、置顶、截断上限);非法路径静默忽略。 */
export function addRepoHistory(path: string): string[] {
  const trimmed = path.trim();
  if (!trimmed || !VALID_REPO_PATH.test(trimmed)) return loadRepoHistory();
  const next = [trimmed, ...loadRepoHistory().filter((p) => p !== trimmed)].slice(
    0,
    MAX_HISTORY,
  );
  return persist(next);
}

export function removeRepoHistory(path: string): string[] {
  return persist(loadRepoHistory().filter((p) => p !== path));
}

/** 监听历史变化(同 tab 自定义事件 + 跨 tab storage 事件)。返回卸载函数。 */
export function subscribeRepoHistory(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}
