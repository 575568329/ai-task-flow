// frontend/src/components/views/BoardView.tsx
// 看板视图:工具栏 + 看板主体 + 任务抽屉。
import { Board } from '@/components/board/Board';
import { BoardToolbar } from '@/components/board/BoardToolbar';
import { TaskDrawer } from '@/components/board/TaskDrawer';

export function BoardView() {
  return (
    <div className="flex h-full flex-col">
      <BoardToolbar />
      <div className="flex-1 overflow-hidden">
        <Board />
      </div>
      <TaskDrawer />
    </div>
  );
}
