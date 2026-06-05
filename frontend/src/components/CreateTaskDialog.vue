<template>
  <el-dialog v-model="visible" title="新建任务" width="600px">
    <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
      <el-form-item label="ID 前缀" prop="prefix">
        <el-input v-model="form.prefix" placeholder="例如：WS、BUG、FEAT" />
      </el-form-item>

      <el-form-item label="标题" prop="title">
        <el-input v-model="form.title" placeholder="任务标题" />
      </el-form-item>

      <el-form-item label="描述" prop="description">
        <el-input
          v-model="form.description"
          type="textarea"
          :rows="4"
          placeholder="详细描述任务内容"
        />
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

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">创建</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { useTaskStore } from '@/stores/task';
import { Priority } from '@/types/task';

interface Props {
  modelValue: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const taskStore = useTaskStore();
const formRef = ref<FormInstance>();
const submitting = ref(false);

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
});

const form = ref({
  prefix: 'WS',
  title: '',
  description: '',
  priority: Priority.P1,
});

const projectsInput = ref('');
const filesInput = ref('');
const criteriaInput = ref('');

const rules: FormRules = {
  prefix: [
    { required: true, message: '请输入 ID 前缀', trigger: 'blur' },
    { pattern: /^[A-Z]+$/, message: 'ID 前缀必须为大写字母', trigger: 'blur' },
  ],
  title: [{ required: true, message: '请输入标题', trigger: 'blur' }],
  description: [{ required: true, message: '请输入描述', trigger: 'blur' }],
};

async function handleSubmit() {
  if (!formRef.value) return;

  try {
    await formRef.value.validate();
    submitting.value = true;

    await taskStore.createTask({
      prefix: form.value.prefix,
      title: form.value.title,
      description: form.value.description,
      priority: form.value.priority,
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

    ElMessage.success('任务创建成功');
    visible.value = false;
    resetForm();
  } catch (error) {
    // 表单校验失败或 API 错误
  } finally {
    submitting.value = false;
  }
}

function resetForm() {
  form.value = {
    prefix: 'WS',
    title: '',
    description: '',
    priority: Priority.P1,
  };
  projectsInput.value = '';
  filesInput.value = '';
  criteriaInput.value = '';
}
</script>
