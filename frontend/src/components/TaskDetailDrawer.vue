<template>
  <el-drawer
    v-model="visible"
    :title="task ? `任务详情：${task.id}` : '任务详情'"
    direction="rtl"
    size="50%"
  >
    <div v-if="task" class="task-detail">
      <!-- 基础信息 -->
      <el-form label-width="100px" label-position="left">
        <el-form-item label="标题">
          <el-input v-model="form.title" />
        </el-form-item>

        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="4" />
        </el-form-item>

        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 100%">
            <el-option label="待规划" value="planning" />
            <el-option label="待办" value="todo" />
            <el-option label="已派发" value="dispatched" />
            <el-option label="审核中" value="review" />
            <el-option label="已完成" value="done" />
            <el-option label="已阻塞" value="blocked" />
          </el-select>
        </el-form-item>

        <el-form-item label="优先级">
          <el-select v-model="form.priority" style="width: 100%">
            <el-option label="P0 - 紧急" value="P0" />
            <el-option label="P1 - 高" value="P1" />
            <el-option label="P2 - 普通" value="P2" />
          </el-select>
        </el-form-item>

        <el-form-item label="项目">
          <el-input v-model="projectsInput" placeholder="多个项目用逗号分隔" />
        </el-form-item>

        <el-form-item label="相关文件">
          <el-input v-model="filesInput" placeholder="多个文件用逗号分隔" />
        </el-form-item>

        <el-form-item label="验收标准">
          <el-input
            v-model="criteriaInput"
            type="textarea"
            :rows="3"
            placeholder="每行一条验收标准"
          />
        </el-form-item>
      </el-form>

      <!-- Worktree 信息 -->
      <el-divider v-if="task.worktree">Worktree</el-divider>
      <div v-if="task.worktree" class="worktree-info">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="路径">
            <code>{{ task.worktree.path }}</code>
          </el-descriptions-item>
          <el-descriptions-item label="分支">
            <code>{{ task.worktree.branch }}</code>
          </el-descriptions-item>
          <el-descriptions-item label="Base Commit">
            <code>{{ task.worktree.baseCommit.substring(0, 7) }}</code>
          </el-descriptions-item>
        </el-descriptions>
      </div>

      <!-- 执行结果 -->
      <el-divider v-if="task.executionResult">执行结果</el-divider>
      <div v-if="task.executionResult" class="execution-result">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="状态">
            <el-tag :type="executionStatusType">
              {{ task.executionResult.status }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="变更文件">
            <ul>
              <li v-for="file in task.executionResult.changedFiles" :key="file">
                <code>{{ file }}</code>
              </li>
            </ul>
          </el-descriptions-item>
          <el-descriptions-item label="备注">
            {{ task.executionResult.notes }}
          </el-descriptions-item>
          <el-descriptions-item v-if="task.executionResult.blockedReason" label="阻塞原因">
            {{ task.executionResult.blockedReason }}
          </el-descriptions-item>
        </el-descriptions>
      </div>

      <!-- 操作按钮 -->
      <div class="actions">
        <el-button type="primary" @click="handleSave">保存</el-button>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="danger" @click="handleDelete">删除</el-button>
      </div>
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { Task } from '@/types/task';
import { useTaskStore } from '@/stores/task';

interface Props {
  modelValue: boolean;
  task: Task | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const taskStore = useTaskStore();

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
});

const form = ref({
  title: '',
  description: '',
  status: '',
  priority: '',
});

const projectsInput = ref('');
const filesInput = ref('');
const criteriaInput = ref('');

watch(
  () => props.task,
  (task) => {
    if (task) {
      form.value = {
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
      };
      projectsInput.value = task.projects.join(', ');
      filesInput.value = task.relatedFiles.join(', ');
      criteriaInput.value = task.acceptanceCriteria.join('\n');
    }
  },
  { immediate: true }
);

const executionStatusType = computed(() => {
  if (!props.task?.executionResult) return 'info';
  switch (props.task.executionResult.status) {
    case 'done':
      return 'success';
    case 'blocked':
      return 'danger';
    case 'partial':
      return 'warning';
    default:
      return 'info';
  }
});

async function handleSave() {
  if (!props.task) return;

  try {
    await taskStore.updateTask(props.task.id, {
      title: form.value.title,
      description: form.value.description,
      status: form.value.status as any,
      priority: form.value.priority as any,
      projects: projectsInput.value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      relatedFiles: filesInput.value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      acceptanceCriteria: criteriaInput.value
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    });
    ElMessage.success('保存成功');
    visible.value = false;
  } catch (error) {
    // 错误已在 axios 拦截器中处理
  }
}

async function handleDelete() {
  if (!props.task) return;

  try {
    await ElMessageBox.confirm(`确认删除任务 ${props.task.id} ？`, '确认删除', {
      type: 'warning',
    });

    await taskStore.deleteTask(props.task.id);
    ElMessage.success('删除成功');
    visible.value = false;
  } catch {
    // 用户取消
  }
}
</script>

<style scoped>
.task-detail {
  padding: 0 var(--spacing-md);
}

.worktree-info,
.execution-result {
  margin-bottom: var(--spacing-md);
}

.worktree-info code,
.execution-result code {
  background: #f5f7fa;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: var(--font-size-sm);
}

.execution-result ul {
  margin: 0;
  padding-left: var(--spacing-md);
}

.actions {
  margin-top: var(--spacing-lg);
  display: flex;
  gap: var(--spacing-sm);
  padding-top: var(--spacing-md);
  border-top: 1px solid #ebeef5;
}
</style>
