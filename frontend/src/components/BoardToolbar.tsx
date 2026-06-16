// frontend/src/components/BoardToolbar.tsx
import { Plus, Search, Circle } from 'lucide-react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { useUIStore } from '@/stores/uiStore';

interface BoardToolbarProps {
  projects: string[];
  sseConnected: boolean;
}

/**
 * 看板内容区顶部工具条
 * 由原 TopBar 裁剪而来：保留搜索/筛选/新建任务 + SSE 状态灯
 * （品牌、资料调研入口、主题切换 已下沉到左侧 SidebarNav）
 */
export function BoardToolbar({ projects, sseConnected }: BoardToolbarProps) {
  const searchQuery = useUIStore((s) => s.searchQuery);
  const setSearchQuery = useUIStore((s) => s.setSearchQuery);
  const projectFilter = useUIStore((s) => s.projectFilter);
  const setProjectFilter = useUIStore((s) => s.setProjectFilter);
  const setCreatingTask = useUIStore((s) => s.setCreatingTask);

  return (
    <header
      className="flex flex-wrap items-center gap-3 border-b px-5 py-3"
      style={{ background: 'var(--bg-lower)', borderColor: 'var(--border-primary)' }}
    >
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

      <div className="relative w-56">
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
        <Button variant="primary" onClick={() => setCreatingTask(true)}>
          <Plus size={16} />
          新建任务
        </Button>
      </div>
    </header>
  );
}
