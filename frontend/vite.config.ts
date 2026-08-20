import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

// backend 默认端口(与 backend/src/http-server.ts 保持一致)
const DEFAULT_BACKEND_PORT = 47821;
const BACKEND_PORT_FILE = path.resolve(__dirname, '../.logs/backend-port.txt');

// 动态读取 backend 的实际端口(每次代理请求时调用)。
// Why:concurrently 版 dev 并发起 shared/backend/frontend,vite 启动瞬间 backend
// 可能尚未就绪、端口文件还是上次运行的残留值;若只在启动时读一次,错误 target 会
// 固化到底(残留 3000 时代理落到其他项目,/api 全 404)。改为请求时读取后,
// backend 顺延端口/晚启动都不影响,代理自动跟随最新端口文件。
function getBackendPort(): number {
  try {
    const port = parseInt(fs.readFileSync(BACKEND_PORT_FILE, 'utf-8').trim(), 10);
    if (port > 0) {
      return port;
    }
  } catch {
    // 文件不存在或不可读,回退默认端口
  }
  return DEFAULT_BACKEND_PORT;
}

// https://vitejs.dev/config/
export default defineConfig({
  // base './':产物资源相对引用。uTools 插件包以 file:// 加载,
  // 默认绝对路径 /assets/... 会解析到文件系统根而 404;同源 http 托管下相对路径等效
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'dynamic-backend-proxy-target',
      configureServer(server) {
        // 在 vite 内置 proxy 中间件之前注册:每个 /api 请求都按端口文件刷新代理 target。
        // Why:vite 内置的 http-proxy 不支持 router 选项,且 options 被闭包进 createProxyServer;
        // 但闭包对象与 config.server.proxy['/api'] 同引用,且 http-proxy 每请求浅拷贝后
        // 重新 parse target 字符串,故请求前 mutate 该对象的 target 即可动态生效。
        // 背景:concurrently 版 dev 并发起 shared/backend/frontend,vite 启动瞬间读到的
        // 端口文件可能是上次运行的残留值,启动时读一次会把错误 target 固化到底
        // (曾踩坑:残留 3000 时代理落到其他项目,/api 全 404)。
        server.middlewares.use((req, _res, next) => {
          if (req.url?.startsWith('/api')) {
            const proxyOpts = server.config.server.proxy?.['/api'];
            if (proxyOpts && typeof proxyOpts === 'object') {
              proxyOpts.target = `http://127.0.0.1:${getBackendPort()}`;
            }
          }
          next();
        });
      },
    },
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    // monorepo 强制 react/react-dom 单一解析到 frontend 的 19。
    // 根 node_modules 有 react 18(extension 用),radix/dnd-kit 的 peer 被 npm hoist 到根 18;
    // 不加 dedupe 会让 vite 解析出两个 React 实例,触发 "Function components cannot be given refs" 警告
    dedupe: ['react', 'react-dom'],
  },
  build: {
    // 打包到 backend/public,生产模式由后端单端口托管
    outDir: fileURLToPath(new URL('../backend/public', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    port: 5678, // 使用不容易被占用的端口
    proxy: {
      '/api': {
        // 必须用 127.0.0.1 而非 localhost:
        // Windows 上 localhost 优先解析为 IPv6 ::1,若 ::1:port 被其他服务占用,
        // 代理会错误转发到无关服务(曾踩坑:被某 Astro 服务占用导致 /api 全 404)。
        // 后端绑定 0.0.0.0(覆盖 IPv4),固定走 127.0.0.1 最稳。
        // target 是启动占位值,实际由上方插件在每个请求前按端口文件刷新。
        target: `http://127.0.0.1:${DEFAULT_BACKEND_PORT}`,
        changeOrigin: true,
      },
    },
  },
});
