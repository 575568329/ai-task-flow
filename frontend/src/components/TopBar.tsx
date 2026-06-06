// frontend/src/components/TopBar.tsx
import { Moon, Sun, Plus, Search, Circle } from 'lucide-react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { useUIStore } from '@/stores/uiStore';

interface TopBarProps {
  projects: string[];
  sseConnected: boolean;
}

export function TopBar({ projects, sseConnected }: TopBarProps) {
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const searchQuery = useUIStore((s) => s.searchQuery);
  const setSearchQuery = useUIStore((s) => s.setSearchQuery);
  const projectFilter = useUIStore((s) => s.projectFilter);
  const setProjectFilter = useUIStore((s) => s.setProjectFilter);
  const setCreateModalOpen = useUIStore((s) => s.setCreateModalOpen);

  return (
    <header
      className="sticky top-0 z-40 flex flex-wrap items-center gap-3 border-b px-6 py-3"
      style={{ background: 'var(--bg-lower)', borderColor: 'var(--border-primary)' }}
    >
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold">AI Task Flow</h1>
        <span
          title={sseConnected ? '实时推送已连接' : '实时推送断开'}
          className="flex items-center"
        >
          <Circle
            size={10}
            fill={sseConnected ? 'var(--success-6)' : 'var(--error-6)'}
            color={sseConnected ? 'var(--success-6)' : 'var(--error-6)'}
          />
        </span>
      </div>

      <div className="relative ml-2 w-56">
        <Search
          size={15}
          className="absolute left-2.5 top-1/2 -translate-y-1/2"
          style={{ color: 'var(--text-2)' }}
        />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索标题 / ID"
          className="pl-8"
        />
      </div>

      <div className="w-40">
        <Select
          value={projectFilter ?? ''}
          onChange={(e) => setProjectFilter(e.target.value || null)}
          options={[
            { label: '全部项目', value: '' },
            ...projects.map((p) => ({ label: p, value: p })),
          ]}
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button variant="primary" onClick={() => setCreateModalOpen(true)}>
          <Plus size={16} />
          新建任务
        </Button>
        <Button variant="ghost" onClick={toggleTheme} aria-label="切换主题">
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </Button>
      </div>
    </header>
  );
}
