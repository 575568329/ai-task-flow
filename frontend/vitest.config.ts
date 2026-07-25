// frontend/vitest.config.ts
// 单测统一入口:
//  - 同时覆盖纯函数 (*.test.ts) 与 React 组件 (*.test.tsx)
//  - 默认 jsdom 环境:组件测试需要 DOM;纯函数测试在 jsdom 下同样可跑(node globals 全保留)。
//    如某测试明确需要 node only,可在文件顶部加 `// @vitest-environment node` 注解覆盖。
//  - resolve.alias @ → src,与 vite.config.ts 一致;不在这里复用 vite.config 是为了避免拉入
//    tailwindcss / proxy / backend-port 探测等只服务 dev/build 的副作用。
//  - **react/react-dom 绝对路径 alias**:monorepo 根 node_modules 有 react@18(extension 用),
//    frontend 的大量依赖(radix/dnd-kit/react-markdown/lucide/...)的 peer 被 npm hoist 时
//    倾向解析到根 18。dedupe 在 vitest 里被反复证明不可靠(尤其是 transitive 拿到根 18 时)。
//    这里用正则 alias 同时覆盖 `react` / `react/...` / `react-dom` / `react-dom/...`,
//    把所有 react 子路径(jsx-runtime / jsx-dev-runtime / cjs/...)强制指向 frontend 的 19 副本,
//    彻底消除「两份 React」。replacement 用 file:// 转出的绝对路径。
import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

const frontendReact = fileURLToPath(new URL('./node_modules/react', import.meta.url));
const frontendReactDOM = fileURLToPath(new URL('./node_modules/react-dom', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      // 注意:vite alias 字符串替换 semantics:replacement 是字符串,匹配整体被替换。
      // 我们用单独的"精确"和"前缀"两条覆盖 react 与 react/*,保证 react/jsx-runtime、
      // react/jsx-dev-runtime、react-dom/client、react-dom/cjs/... 都被改写到 frontend 副本。
      { find: /^react$/, replacement: frontendReact },
      { find: /^react\/(.+)$/, replacement: `${frontendReact}/$1` },
      { find: /^react-dom$/, replacement: frontendReactDOM },
      { find: /^react-dom\/(.+)$/, replacement: `${frontendReactDOM}/$1` },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
