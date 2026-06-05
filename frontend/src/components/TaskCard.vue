<template>
  <div class="task-card" :class="`priority-${task.priority.toLowerCase()}`" @click="$emit('click')">
    <div class="task-header">
      <span class="task-id">{{ task.id }}</span>
      <el-tag :type="priorityTagType" size="small">{{ task.priority }}</el-tag>
    </div>

    <h4 class="task-title">{{ task.title }}</h4>

    <p v-if="task.description" class="task-description">
      {{ truncate(task.description, 80) }}
    </p>

    <div v-if="task.projects.length > 0" class="task-projects">
      <el-tag
        v-for="project in task.projects"
        :key="project"
        size="small"
        type="info"
        effect="plain"
      >
        {{ project }}
      </el-tag>
    </div>

    <div class="task-meta">
      <span class="task-time">
        <el-icon><Clock /></el-icon>
        {{ formatTime(task.updatedAt) }}
      </span>

      <span v-if="task.worktree" class="task-worktree">
        <el-icon><FolderOpened /></el-icon>
        {{ task.worktree.branch }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Clock, FolderOpened } from '@element-plus/icons-vue';
import type { Task } from '@/types/task';
import { Priority } from '@/types/task';

interface Props {
  task: Task;
}

const props = defineProps<Props>();

defineEmits<{
  click: [];
}>();

const priorityTagType = computed(() => {
  switch (props.task.priority) {
    case Priority.P0:
      return 'danger';
    case Priority.P1:
      return 'warning';
    case Priority.P2:
      return 'info';
    default:
      return 'info';
  }
});

function truncate(text: string, length: number): string {
  if (text.length <= length) return text;
  return text.substring(0, length) + '...';
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diff = (now.getTime() - date.getTime()) / 1000;

  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)} 天前`;
  return date.toLocaleDateString('zh-CN');
}
</script>

<style scoped>
.task-card {
  background: var(--bg-card);
  border-radius: var(--border-radius-md);
  padding: var(--spacing-md);
  margin-bottom: var(--spacing-sm);
  cursor: pointer;
  transition: all 0.2s ease;
  border-left: 4px solid var(--priority-p2);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.task-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}

.task-card.priority-p0 {
  border-left-color: var(--priority-p0);
}

.task-card.priority-p1 {
  border-left-color: var(--priority-p1);
}

.task-card.priority-p2 {
  border-left-color: var(--priority-p2);
}

.task-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-sm);
}

.task-id {
  font-family: 'Courier New', monospace;
  font-size: var(--font-size-sm);
  color: var(--color-info);
  font-weight: bold;
}

.task-title {
  font-size: var(--font-size-md);
  font-weight: 600;
  color: #303133;
  margin: 0 0 var(--spacing-sm) 0;
  line-height: 1.4;
}

.task-description {
  font-size: var(--font-size-sm);
  color: #606266;
  margin: 0 0 var(--spacing-sm) 0;
  line-height: 1.5;
}

.task-projects {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
  margin-bottom: var(--spacing-sm);
}

.task-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--font-size-sm);
  color: var(--color-info);
}

.task-time,
.task-worktree {
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
