<template>
  <div class="app-container">
    <!-- 顶部工具栏 -->
    <header class="app-header">
      <div class="header-left">
        <h1>AI Task Flow</h1>
        <el-tag type="info" effect="plain">v0.1.0 MVP</el-tag>
      </div>

      <div class="header-actions">
        <el-button type="primary" @click="showCreateDialog = true">
          <el-icon><Plus /></el-icon>
          新建任务
        </el-button>
        <el-button @click="handleRefresh" :loading="taskStore.loading">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
      </div>
    </header>

    <!-- 看板主体 -->
    <main class="app-main">
      <div class="kanban-board">
        <KanbanColumn
          v-for="status in columnStatuses"
          :key="status"
          :status="status"
          :tasks="taskStore.tasksByStatus[status]"
          @task-click="handleTaskClick"
        />
      </div>
    </main>

    <!-- 新建任务对话框 -->
    <CreateTaskDialog v-model="showCreateDialog" />

    <!-- 任务详情抽屉 -->
    <TaskDetailDrawer v-model="showDetailDrawer" :task="selectedTask" />

    <!-- SSE 连接状态 -->
    <div v-if="!sseConnected" class="sse-status">
      <el-alert title="实时推送已断开" type="warning" :closable="false" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { Plus, Refresh } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { useTaskStore } from '@/stores/task';
import { sseClient } from '@/api/sse';
import { TaskStatus, type Task } from '@/types/task';
import KanbanColumn from '@/components/KanbanColumn.vue';
import TaskDetailDrawer from '@/components/TaskDetailDrawer.vue';
import CreateTaskDialog from '@/components/CreateTaskDialog.vue';

const taskStore = useTaskStore();

// 看板列顺序
const columnStatuses = [
  TaskStatus.TODO,
  TaskStatus.DISPATCHED,
  TaskStatus.REVIEW,
  TaskStatus.DONE,
  TaskStatus.BLOCKED,
];

// UI 状态
const showCreateDialog = ref(false);
const showDetailDrawer = ref(false);
const selectedTask = ref<Task | null>(null);
const sseConnected = ref(false);

// 任务点击
function handleTaskClick(task: Task) {
  selectedTask.value = task;
  showDetailDrawer.value = true;
}

// 刷新
async function handleRefresh() {
  try {
    await taskStore.fetchAll();
    ElMessage.success('刷新成功');
  } catch (error) {
    // 错误已在拦截器中处理
  }
}

// SSE 连接
let unsubscribeSSE: (() => void) | null = null;

onMounted(async () => {
  // 加载任务
  await taskStore.fetchAll();

  // 连接 SSE
  sseClient.connect();
  unsubscribeSSE = sseClient.on((event) => {
    sseConnected.value = true;

    // 处理任务相关事件
    if (event.type === 'connected') {
      ElMessage.success('实时推送已连接');
    } else if (event.payload) {
      // 假设 payload 包含更新后的任务数据
      // 实际需要根据后端事件格式调整
      taskStore.handleSSEEvent(event.type, event.payload);
    }
  });
});

onUnmounted(() => {
  if (unsubscribeSSE) {
    unsubscribeSSE();
  }
  sseClient.close();
});
</script>

<style scoped>
.app-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-page);
}

.app-header {
  background: var(--bg-card);
  padding: var(--spacing-md) var(--spacing-xl);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: sticky;
  top: 0;
  z-index: 100;
}

.header-left {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}

.header-left h1 {
  font-size: var(--font-size-xl);
  font-weight: 600;
  margin: 0;
  color: #303133;
}

.header-actions {
  display: flex;
  gap: var(--spacing-sm);
}

.app-main {
  flex: 1;
  padding: var(--spacing-lg);
  overflow-x: auto;
}

.kanban-board {
  display: grid;
  grid-template-columns: repeat(5, minmax(280px, 1fr));
  gap: var(--spacing-md);
  min-width: fit-content;
}

.sse-status {
  position: fixed;
  bottom: var(--spacing-lg);
  right: var(--spacing-lg);
  width: 300px;
  z-index: 1000;
}
</style>
