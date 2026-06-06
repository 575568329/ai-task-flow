import { TaskStatus } from '@ai-task-flow/shared';

function App() {
  // 引用 shared 类型,验证跨包导入链路
  const statuses = Object.values(TaskStatus);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-xl font-semibold">AI Task Flow</h1>
      </header>
      <main className="p-6">
        <p className="text-slate-600">
          React + Tailwind 脚手架就绪。共 {statuses.length} 个任务状态。
        </p>
      </main>
    </div>
  );
}

export default App;
