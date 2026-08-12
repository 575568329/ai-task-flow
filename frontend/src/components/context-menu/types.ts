// frontend/src/components/context-menu/types.ts
// 通用右键菜单数据模型。
// 双泛型 <T, C>：T = 右键目标对象类型，C = 模块上下文（回调集合）。
// 数据驱动：MenuItem 是纯数据结构，可动态生成、按状态显隐、跨模块复用。
// 可扩展：union 类型，新增 kind（checkbox/radio）只需加分支。
import type { LucideIcon } from 'lucide-react';

/** 右键上下文：target=被右键的对象，ctx=模块回调集合 */
export interface MenuContext<T, C = unknown> {
  target: T;
  ctx: C;
}

/** 动态值：可为静态值，或按上下文求值的函数 */
type Dynamic<V, T, C> = V | ((c: MenuContext<T, C>) => V);

/** 普通动作项 */
export interface MenuAction<T, C = unknown> {
  type: 'action';
  key: string;
  label: Dynamic<string, T, C>;
  icon?: LucideIcon;
  shortcut?: string; // 显示用，如 'Tab' / 'Ctrl+S'
  disabled?: Dynamic<boolean, T, C>;
  hidden?: Dynamic<boolean, T, C>;
  danger?: boolean; // true → 红色（删除等）
  onSelect: (c: MenuContext<T, C>) => void;
}

/** 分隔符 */
export interface MenuSeparator {
  type: 'separator';
  key: string;
}

/** 分组标题（不可点） */
export interface MenuLabel {
  type: 'label';
  key: string;
  label: string;
}

/** 子菜单 */
export interface MenuSubmenu<T, C = unknown> {
  type: 'submenu';
  key: string;
  label: string;
  icon?: LucideIcon;
  disabled?: Dynamic<boolean, T, C>;
  hidden?: Dynamic<boolean, T, C>;
  items: Dynamic<MenuItem<T, C>[], T, C>;
}

export type MenuItem<T, C = unknown> =
  | MenuAction<T, C>
  | MenuSeparator
  | MenuSubmenu<T, C>
  | MenuLabel;

/** 菜单项工厂签名（模块层实现） */
export type MenuItemBuilder<T, C> = (c: MenuContext<T, C>) => MenuItem<T, C>[];

/** 求值动态字段（函数则调用，否则原样返回） */
export function resolve<V, T, C>(v: Dynamic<V, T, C>, c: MenuContext<T, C>): V {
  return typeof v === 'function' ? (v as (c: MenuContext<T, C>) => V)(c) : v;
}
