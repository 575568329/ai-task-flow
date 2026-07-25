// frontend/vitest.config.ts
// applyEvent 等纯函数单测:无 DOM 依赖,node 环境即可跑(@ai-task-flow/shared 仅类型 import,运行时擦除)。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
