import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

// 动态读取 backend 的实际端口
function getBackendPort(): number {
  const portFile = path.resolve(__dirname, '../.logs/backend-port.txt');
  try {
    if (fs.existsSync(portFile)) {
      const port = parseInt(fs.readFileSync(portFile, 'utf-8').trim(), 10);
      if (port > 0) {
        return port;
      }
    }
  } catch (err) {
    // 忽略错误，使用默认端口
  }
  return 3000; // 默认端口
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
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
        target: `http://127.0.0.1:${getBackendPort()}`,
        changeOrigin: true,
      },
    },
  },
});
