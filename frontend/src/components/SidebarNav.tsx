// frontend/src/components/SidebarNav.tsx
// 轻量侧边导航:4 视图切换 + 主题切换 + 设置入口(storageWarn 红点)。
// 支持折叠(localStorage 持久化,折叠后只显示图标)。
// 不用 shadcn sidebar(那是 dashboard 布局,过重);本应用只需纵向导航条。
import { useState } from 'react';
import {
  LayoutDashboard,
  MessageSquare,
  FileText,
  BookOpen,
  Sun,
  Moon,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useUIStore } from '@/stores/uiStore';
import { cn } from '@/lib/utils';

export type ViewKey = 'board' | 'chat' | 'docs' | 'knowledge';

interface NavItem {
  key: ViewKey;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'board', label: '看板', icon: LayoutDashboard },
  { key: 'chat', label: '资料调研', icon: MessageSquare },
  { key: 'docs', label: '任务文档', icon: FileText },
  { key: 'knowledge', label: '知识库', icon: BookOpen },
];

const COLLAPSE_KEY = 'ai-task-flow-sidebar-collapsed';

interface SidebarNavProps {
  activeView: ViewKey;
  onViewChange: (view: ViewKey) => void;
  onOpenSettings: () => void;
}

export function SidebarNav({ activeView, onViewChange, onOpenSettings }: SidebarNavProps) {
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const localAccess = useUIStore((s) => s.localAccess);
  const storageWarn = useUIStore((s) => s.storageWarn);
  const ThemeIcon = theme === 'dark' ? Sun : Moon;

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        // 持久化失败忽略,内存态仍生效
      }
      return next;
    });
  };

  return (
    <aside
      className={cn(
        'bg-sidebar text-sidebar-foreground flex h-full shrink-0 flex-col border-r transition-[width] duration-150',
        collapsed ? 'w-14' : 'w-56',
      )}
    >
      {/* 品牌区 + 折叠按钮 */}
      {collapsed ? (
        <div className="flex justify-center py-3">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={toggleCollapsed}
            aria-label="展开侧栏"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-3">
          <div className="bg-primary size-7 shrink-0 rounded-md" />
          <span className="flex-1 text-sm font-semibold tracking-tight">AI Task Flow</span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={toggleCollapsed}
            aria-label="收起侧栏"
          >
            <ChevronLeft className="size-4" />
          </Button>
        </div>
      )}

      {/* 视图导航 */}
      <nav className="flex flex-1 flex-col gap-1 px-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeView === item.key;
          return (
            <Button
              key={item.key}
              variant={active ? 'secondary' : 'ghost'}
              className={cn('gap-2.5', collapsed ? 'justify-center px-0' : 'justify-start')}
              onClick={() => onViewChange(item.key)}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="size-4 shrink-0" />
              {!collapsed && item.label}
            </Button>
          );
        })}
      </nav>

      <Separator />

      {/* 底部:主题 + 设置 */}
      <div className="flex flex-col gap-1 p-2">
        <Button
          variant="ghost"
          className={cn('gap-2.5', collapsed ? 'justify-center px-0' : 'justify-start')}
          onClick={toggleTheme}
          title={collapsed ? (theme === 'dark' ? '浅色模式' : '深色模式') : undefined}
        >
          <ThemeIcon className="size-4 shrink-0" />
          {!collapsed && (theme === 'dark' ? '浅色模式' : '深色模式')}
        </Button>
        {localAccess && (
          <Button
            variant="ghost"
            className={cn(
              'relative gap-2.5',
              collapsed ? 'justify-center px-0' : 'justify-start',
            )}
            onClick={onOpenSettings}
            title={collapsed ? '设置' : undefined}
          >
            <Settings className="size-4 shrink-0" />
            {!collapsed && '设置'}
            {storageWarn && (
              <span className="bg-destructive absolute top-2 right-2 size-2 rounded-full" />
            )}
          </Button>
        )}
      </div>
    </aside>
  );
}
