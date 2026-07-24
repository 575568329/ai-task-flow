// frontend/src/lib/shortcuts.ts
// 快捷键配置:默认值 + localStorage 持久化 + 按键事件规范化 + 输入框守卫。
// 设置面板(ShortcutsPanel)可改,改完 dispatch 'shortcuts-changed' 事件让各监听重载。
//
// 组合串约定:无修饰返回单键(如 'n');有修饰返回 'ctrl+s' 形式(mod 顺序:ctrl/cmd/alt/shift)。
// 单键快捷键在文本输入框中不触发(避免录入误触);带修饰的快捷键在输入框中也触发(如 Ctrl+S 保存)。

/** 快捷键动作 → 组合串 */
export interface ShortcutMap {
  /** 新建任务(打开抽屉) */
  newTask: string;
  /** 打开终端(新建/恢复 Claude 会话) */
  openTerminal: string;
  /** 保存任务(抽屉内) */
  saveTask: string;
}

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  newTask: 'n',
  openTerminal: 't',
  saveTask: 'ctrl+s',
};

/** 动作元信息(供设置面板渲染) */
export const SHORTCUT_ACTIONS: {
  key: keyof ShortcutMap;
  label: string;
  description: string;
}[] = [
  { key: 'newTask', label: '新建任务', description: '打开新建任务抽屉' },
  { key: 'openTerminal', label: '打开终端', description: '打开 / 恢复 Claude 会话' },
  { key: 'saveTask', label: '保存任务', description: '保存当前任务(任务抽屉内)' },
];

const STORAGE_KEY = 'ai-task-flow-shortcuts';

/** 读取快捷键配置(与默认值合并,容忍部分缺失) */
export function loadShortcuts(): ShortcutMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SHORTCUTS };
    const parsed = JSON.parse(raw) as Partial<ShortcutMap>;
    return { ...DEFAULT_SHORTCUTS, ...parsed };
  } catch {
    return { ...DEFAULT_SHORTCUTS };
  }
}

/** 保存快捷键配置 + 通知各监听重载 */
export function saveShortcuts(map: ShortcutMap): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  window.dispatchEvent(new CustomEvent('shortcuts-changed'));
}

const MODIFIER_KEYS = new Set(['control', 'meta', 'alt', 'shift']);

/** 将键盘事件规范化为组合串。纯修饰键按下返回 ''(等待后续)。 */
export function eventToCombo(e: KeyboardEvent): string {
  const raw = e.key.toLowerCase();
  if (MODIFIER_KEYS.has(raw)) return '';
  let key = raw;
  if (key === ' ') key = 'space';
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('ctrl');
  if (e.metaKey) mods.push('cmd');
  if (e.altKey) mods.push('alt');
  if (e.shiftKey) mods.push('shift');
  return mods.length ? [...mods, key].join('+') : key;
}

/** 是否单键(无修饰)——单键在输入框中需跳过避免误触 */
export function isSingleKey(combo: string): boolean {
  return !combo.includes('+');
}

/** 是否在文本输入元素中 */
export function isTypingTarget(el: HTMLElement | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** 组合串 → 展示文本(如 'ctrl+s' → 'Ctrl + S') */
export function formatCombo(combo: string): string {
  const labels: Record<string, string> = {
    ctrl: 'Ctrl',
    cmd: 'Cmd',
    alt: 'Alt',
    shift: 'Shift',
    space: '空格',
    enter: 'Enter',
    esc: 'Esc',
    backspace: 'Backspace',
    arrowup: '↑',
    arrowdown: '↓',
    arrowleft: '←',
    arrowright: '→',
  };
  return combo
    .split('+')
    .map((p) => (labels[p] ?? p.toUpperCase()))
    .join(' + ');
}

// ---- 编辑捕获 flag:设置面板捕获重绑按键时,各业务监听需暂停,避免副作用 ----
let capturing = false;
/** 进入/退出快捷键捕获模式(ShortcutsPanel 编辑时调用) */
export function setCapturing(v: boolean): void {
  capturing = v;
}
export function isCapturing(): boolean {
  return capturing;
}
