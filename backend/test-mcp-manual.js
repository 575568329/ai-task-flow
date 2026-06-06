// MCP 工具手动测试脚本
// 使用 Node.js 直接调用 MCP Server 的工具函数

import { container } from './backend/src/infrastructure/di/container.js';
import { TaskRepository } from './backend/src/domain/workflow/repositories/TaskRepository.js';
import { TaskId } from './backend/src/domain/workflow/value-objects/TaskId.js';
import { TaskStatus } from './backend/src/domain/workflow/value-objects/TaskStatus.js';

async function testMCPTools() {
  console.log('='.repeat(50));
  console.log('🧪 测试 AI Task Flow MCP 工具');
  console.log('='.repeat(50));
  console.log();

  const taskRepo = container.resolve('TaskRepository');

  // 测试 1: 列出待办任务
  console.log('📋 测试 1: list_pending_tasks');
  console.log('-'.repeat(50));
  const todoTasks = await taskRepo.findByStatus(TaskStatus.TODO);
  console.log(`找到 ${todoTasks.length} 个待办任务:`);
  todoTasks.forEach(task => {
    console.log(`  - [${task.id.value}] ${task.title} (${task.priority})`);
  });
  console.log();

  // 测试 2: 获取任务详情
  if (todoTasks.length > 0) {
    const firstTask = todoTasks[0];
    console.log('📄 测试 2: get_task');
    console.log('-'.repeat(50));
    console.log(`任务ID: ${firstTask.id.value}`);
    console.log(`标题: ${firstTask.title}`);
    console.log(`描述: ${firstTask.description}`);
    console.log(`优先级: ${firstTask.priority}`);
    console.log(`状态: ${firstTask.status}`);
    console.log(`项目: ${firstTask.projectName || '无'}`);
    console.log(`步骤数: ${firstTask.steps.length}`);
    console.log();

    // 测试 3: 添加备注
    console.log('📝 测试 3: add_note_to_task');
    console.log('-'.repeat(50));
    const noteToAdd = `[测试备注] 工具测试于 ${new Date().toISOString()}`;
    console.log(`为任务 ${firstTask.id.value} 添加备注: ${noteToAdd}`);
    firstTask.description += `\n\n---\n**备注**: ${noteToAdd}`;
    firstTask.updatedAt = new Date();
    await taskRepo.save(firstTask);
    console.log('✅ 备注添加成功');
    console.log();
  }

  // 测试 4: 检查 record_result（需要任务处于 dispatched 状态）
  console.log('✅ 测试 4: record_result');
  console.log('-'.repeat(50));
  console.log('⚠️  需要任务处于 DISPATCHED 状态才能测试');
  console.log('提示: 在 Web UI 上点击"派发"按钮后，再使用此工具');
  console.log();

  // 测试 5: get_task_diff（需要 worktree）
  console.log('🔄 测试 5: get_task_diff');
  console.log('-'.repeat(50));
  console.log('⚠️  需要任务已派发并创建 worktree 才能测试');
  console.log('提示: 派发任务后会自动创建 git worktree');
  console.log();

  console.log('='.repeat(50));
  console.log('✨ MCP 工具测试完成');
  console.log('='.repeat(50));
  console.log();
  console.log('下一步:');
  console.log('1. 启动 HTTP Server: npm run http');
  console.log('2. 启动前端: cd ../frontend && npm run dev');
  console.log('3. 在看板上派发任务测试完整工作流');
}

// 运行测试
testMCPTools().catch(console.error);
