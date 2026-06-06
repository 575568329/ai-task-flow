import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core';
import type { TaskDTO, TaskStatus } from '@ai-task-flow/shared';
import { TopBar } from './components/TopBar';
import { KanbanColumn } from './components/KanbanColumn';
import { TaskCard } from './components/TaskCard';
import { CreateTaskModal } from './components/CreateTaskModal';
import { TaskDrawer } from './components/TaskDrawer';
import { Toaster, toast } from './components/ui/Toaster';
import { useTaskStore } from './stores/taskStore';
import { useUIStore } from './stores/uiStore';
import { sseClient } from './api/sse';
import { BOARD_COLUMNS } from './lib/taskMeta';

function App() {
  const tasks = useTaskStore((s) => s.tasks);
  const fetchAll = useTaskStore((s) => s.fetchAll);
  const optimisticMove = useTaskStore((s) => s.optimisticMove);
  const applySSEEvent = useTaskStore((s) => s.applySSEEvent);

  const searchQuery = useUIStore((s) => s.searchQuery);
  const projectFilter = useUIStore((s) => s.projectFilter);
  const setSelectedTask = useUIStore((s) => s.setSelectedTask);

  const [sseConnected, setSseConnected] = useState(false);
  const [activeTask, setActiveTask] = useState<TaskDTO | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // 初始化:拉数据 + 连 SSE
  useEffect(() => {
    fetchAll();
    sseClient.connect();
    const off = sseClient.on((event) => {
      setSseConnected(true);
      if (event.type !== 'connected') applySSEEvent(event);
    });
    return () => {
      off();
      sseClient.close();
    };
  }, [fetchAll, applySSEEvent]);

  // 所有项目(用于过滤下拉)
  const allProjects = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t) => t.projects.forEach((p) => set.add(p)));
    return [...set].sort();
  }, [tasks]);

  // 过滤后的任务
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tasks.filter((t) => {
      if (projectFilter && !t.projects.includes(projectFilter)) return false;
      if (q && !t.title.toLowerCase().includes(q) && !t.id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tasks, searchQuery, projectFilter]);

  // 按状态分组
  const byStatus = useMemo(() => {
    const map = {} as Record<TaskStatus, TaskDTO[]>;
    BOARD_COLUMNS.forEach((s) => (map[s] = []));
    filtered.forEach((t) => {
      if (map[t.status]) map[t.status].push(t);
    });
    return map;
  }, [filtered]);

  function handleDragStart(e: DragStartEvent) {
    setActiveTask(tasks.find((t) => t.id === e.active.id) ?? null);
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = e;
    if (!over) return;

    const taskId = active.id as string;
    // over.id 可能是列(status)或另一张卡片(taskId)
    const overId = over.id as string;
    const targetStatus = BOARD_COLUMNS.includes(overId as TaskStatus)
      ? (overId as TaskStatus)
      : tasks.find((t) => t.id === overId)?.status;

    if (!targetStatus) return;
    try {
      await optimisticMove(taskId, targetStatus);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '移动失败');
    }
  }

  return (
    <div className="flex min-h-screen flex-col" style={{ background: 'var(--bg-bottom)', color: 'var(--text-1)' }}>
      <TopBar projects={allProjects} sseConnected={sseConnected} />

      <main className="flex-1 overflow-x-auto p-5">
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4" style={{ minWidth: 'fit-content' }}>
            {BOARD_COLUMNS.map((status) => (
              <KanbanColumn
                key={status}
                status={status}
                tasks={byStatus[status]}
                onTaskClick={(t) => setSelectedTask(t.id)}
              />
            ))}
          </div>
          <DragOverlay>
            {activeTask ? <TaskCard task={activeTask} onClick={() => {}} /> : null}
          </DragOverlay>
        </DndContext>
      </main>

      <CreateTaskModal />
      <TaskDrawer />
      <Toaster />
    </div>
  );
}

export default App;
