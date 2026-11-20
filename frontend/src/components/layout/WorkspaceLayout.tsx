// 工作区布局母版:左栏导航(树/列表) + 右栏内容(顶部工具条固定,内容区滚动)。
// 工作记录 / 结论共用;后续知识库、思维导图需要同构布局时也可接入。
// 只收敛容器与头部的样式,导航内容与业务操作仍由各页面自己渲染。
import type { ReactNode } from 'react';

interface WorkspaceLayoutProps {
  /** 左栏内容(通常是 WorkspaceSidebar) */
  sidebar: ReactNode;
  /** 右栏顶部工具条(通常是 WorkspaceToolbar),不传则内容占满 */
  toolbar?: ReactNode;
  children: ReactNode;
}

export function WorkspaceLayout({ sidebar, toolbar, children }: WorkspaceLayoutProps) {
  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r @2xl:w-64">{sidebar}</aside>
      <section className="flex min-w-0 flex-1 flex-col">
        {toolbar}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </section>
    </div>
  );
}

interface WorkspaceSidebarProps {
  title: string;
  /** 标题右侧的操作按钮(刷新、指南等) */
  actions?: ReactNode;
  /** 标题与列表之间的固定区(如筛选、统计) */
  header?: ReactNode;
  /** 底部固定区(说明文字、次要入口) */
  footer?: ReactNode;
  children: ReactNode;
}

export function WorkspaceSidebar({ title, actions, header, footer, children }: WorkspaceSidebarProps) {
  return (
    <>
      <div className="flex items-center gap-1 border-b px-3 py-2">
        <span className="flex-1 text-sm font-semibold">{title}</span>
        {actions}
      </div>
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">{children}</div>
      {footer ? <div className="border-t p-2">{footer}</div> : null}
    </>
  );
}

interface WorkspaceToolbarProps {
  /** 顶部搜索行(可选,跨整宽) */
  search?: ReactNode;
  /** 标题区(标题 + 计数) */
  title: ReactNode;
  /** 右侧操作区(筛选、批量操作、新建) */
  actions?: ReactNode;
}

export function WorkspaceToolbar({ search, title, actions }: WorkspaceToolbarProps) {
  return (
    <div className="border-b px-4 py-2">
      {search ? <div className="mb-2">{search}</div> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
