// frontend/src/components/context-menu/ContextMenuHost.tsx
// 通用右键菜单包装组件：把 MenuItem 数据驱动渲染成 radix ContextMenu。
// 不耦合任何业务，纯渲染；各模块通过 items（数组或工厂）+ target + ctx 接入。
//
// 设计要点：
// - items 支持 MenuItem[] 或 (menuCtx) => MenuItem[]（动态，按上下文显隐）
// - hidden 项过滤；首/尾/连续 separator 自动清理
// - danger 用 shadcn 的 variant="destructive"（红色）
// - portal z-[1400]，高于浮窗(1300)/抽屉，避免遮挡
import * as React from 'react';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuLabel,
  ContextMenuShortcut,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import type { MenuItem, MenuContext, MenuItemBuilder } from './types';
import { resolve } from './types';

interface ContextMenuHostProps<T, C> {
  items: MenuItem<T, C>[] | MenuItemBuilder<T, C>;
  /** 右键目标对象（传给菜单项的 MenuContext.target） */
  target: T;
  /** 模块上下文（回调集合，传给 MenuContext.ctx） */
  ctx: C;
  /** 被包裹的触发元素（必须能接 ref + onContextMenu，如 div） */
  children: React.ReactElement;
  /** Content 自定义类名 */
  contentClassName?: string;
}

export function ContextMenuHost<T, C>({
  items,
  target,
  ctx,
  children,
  contentClassName,
}: ContextMenuHostProps<T, C>) {
  const menuCtx: MenuContext<T, C> = { target, ctx };
  const resolved = typeof items === 'function' ? items(menuCtx) : items;
  const visible = trimSeparators(resolved.filter((it) => !isHidden(it, menuCtx)));

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className={cn('z-[1400]', contentClassName)}>
        {visible.map((item) => renderItem(item, menuCtx))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** 求值 hidden 字段 */
function isHidden<T, C>(item: MenuItem<T, C>, c: MenuContext<T, C>): boolean {
  if ('hidden' in item && item.hidden !== undefined) return resolve(item.hidden as never, c);
  return false;
}

/** 去掉首/尾/连续 separator，避免菜单出现多余分隔线（导出供测试） */
export function trimSeparators<T, C>(items: MenuItem<T, C>[]): MenuItem<T, C>[] {
  const result: MenuItem<T, C>[] = [];
  for (const it of items) {
    const isSep = it.type === 'separator';
    if (isSep && (result.length === 0 || result[result.length - 1].type === 'separator')) continue;
    result.push(it);
  }
  while (result.length > 0 && result[result.length - 1].type === 'separator') result.pop();
  return result;
}

/** 递归渲染单个 MenuItem → radix 组件 */
function renderItem<T, C>(item: MenuItem<T, C>, c: MenuContext<T, C>): React.JSX.Element {
  switch (item.type) {
    case 'separator':
      return <ContextMenuSeparator key={item.key} />;
    case 'label':
      return <ContextMenuLabel key={item.key}>{item.label}</ContextMenuLabel>;
    case 'submenu': {
      const subItems = trimSeparators(
        resolve(item.items, c).filter((s) => !isHidden(s, c)),
      );
      const Icon = item.icon;
      return (
        <ContextMenuSub key={item.key}>
          <ContextMenuSubTrigger disabled={resolve(item.disabled as never, c)}>
            {Icon && <Icon />}
            <span>{item.label}</span>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="z-[1400]">
            {subItems.map((s) => renderItem(s, c))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      );
    }
    case 'action': {
      const Icon = item.icon;
      return (
        <ContextMenuItem
          key={item.key}
          variant={item.danger ? 'destructive' : 'default'}
          disabled={resolve(item.disabled as never, c)}
          onSelect={() => item.onSelect(c)}
        >
          {Icon && <Icon />}
          <span>{resolve(item.label, c)}</span>
          {item.shortcut && <ContextMenuShortcut>{item.shortcut}</ContextMenuShortcut>}
        </ContextMenuItem>
      );
    }
  }
}
