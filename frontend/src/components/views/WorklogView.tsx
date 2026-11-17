// frontend/src/components/views/WorklogView.tsx
// 工作记录视图入口:挂载 worklog/WorklogView(两栏:项目版本树 + 条目流)。
import { WorklogView as WorklogPanel } from '@/components/worklog/WorklogView';

export function WorklogView() {
  return <WorklogPanel />;
}
