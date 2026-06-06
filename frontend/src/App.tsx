import { Moon, Sun } from 'lucide-react';
import { TaskStatus } from '@ai-task-flow/shared';
import { useUIStore } from './stores/uiStore';

function App() {
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const statuses = Object.values(TaskStatus);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <header
        className="flex items-center justify-between border-b px-6 py-4"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <h1 className="text-xl font-semibold">AI Task Flow</h1>
        <button
          onClick={toggleTheme}
          className="rounded-lg p-2 transition-colors hover:opacity-80"
          style={{ background: 'var(--surface-hover)' }}
          aria-label="切换主题"
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </header>
      <main className="p-6">
        <p style={{ color: 'var(--text-muted)' }}>
          React + Tailwind + 明暗主题就绪。当前主题:{theme}。共 {statuses.length} 个任务状态。
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {statuses.map((s) => (
            <span
              key={s}
              className="rounded-full px-3 py-1 text-sm font-medium text-white"
              style={{ background: `var(--status-${s})` }}
            >
              {s}
            </span>
          ))}
        </div>
      </main>
    </div>
  );
}

export default App;
