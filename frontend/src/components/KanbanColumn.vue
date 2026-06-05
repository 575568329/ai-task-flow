<template>
  <div class="kanban-column">
    <div class="column-header">
      <div class="column-title">
        <span class="status-dot" :style="{ background: statusColor }"></span>
        <h3>{{ statusLabel }}</h3>
        <el-badge :value="tasks.length" :type="badgeType" />
      </div>
    </div>

    <div class="column-body">
      <TaskCard
        v-for="task in tasks"
        :key="task.id"
        :task="task"
        @click="$emit('task-click', task)"
      />

      <div v-if="tasks.length === 0" class="empty-state">
        <el-icon><DocumentRemove /></el-icon>
        <span>暂无任务</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { DocumentRemove } from '@element-plus/icons-vue';
import TaskCard from './TaskCard.vue';
import type { Task } from '@/types/task';
import { TaskStatus } from '@/types/task';

interface Props {
  status: TaskStatus;
  tasks: Task[];
}

const props = defineProps<Props>();

defineEmits<{
  'task-click': [task: Task];
}>();

const statusLabels: Record<TaskStatus, string> = {
  [TaskStatus.PLANNING]: '待规划',
  [TaskStatus.TODO]: '待办',
  [TaskStatus.DISPATCHED]: '已派发',
  [TaskStatus.REVIEW]: '审核中',
  [TaskStatus.DONE]: '已完成',
  [TaskStatus.BLOCKED]: '已阻塞',
};

const statusColors: Record<TaskStatus, string> = {
  [TaskStatus.PLANNING]: 'var(--status-planning)',
  [TaskStatus.TODO]: 'var(--status-todo)',
  [TaskStatus.DISPATCHED]: 'var(--status-dispatched)',
  [TaskStatus.REVIEW]: 'var(--status-review)',
  [TaskStatus.DONE]: 'var(--status-done)',
  [TaskStatus.BLOCKED]: 'var(--status-blocked)',
};

const statusLabel = computed(() => statusLabels[props.status]);
const statusColor = computed(() => statusColors[props.status]);

const badgeType = computed(() => {
  switch (props.status) {
    case TaskStatus.DONE:
      return 'success';
    case TaskStatus.BLOCKED:
      return 'danger';
    case TaskStatus.DISPATCHED:
      return 'warning';
    default:
      return 'primary';
  }
});
</script>

<style scoped>
.kanban-column {
  background: var(--bg-page);
  border-radius: var(--border-radius-md);
  padding: var(--spacing-md);
  display: flex;
  flex-direction: column;
  min-height: 600px;
  max-height: calc(100vh - 200px);
}

.column-header {
  margin-bottom: var(--spacing-md);
  padding-bottom: var(--spacing-sm);
  border-bottom: 2px solid #ebeef5;
}

.column-title {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.column-title h3 {
  font-size: var(--font-size-md);
  font-weight: 600;
  margin: 0;
  color: #303133;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.column-body {
  flex: 1;
  overflow-y: auto;
  padding-right: var(--spacing-xs);
}

.column-body::-webkit-scrollbar {
  width: 6px;
}

.column-body::-webkit-scrollbar-thumb {
  background: #c0c4cc;
  border-radius: 3px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-xl);
  color: var(--color-info);
  font-size: var(--font-size-sm);
}

.empty-state .el-icon {
  font-size: 32px;
  margin-bottom: var(--spacing-sm);
  opacity: 0.4;
}
</style>
