import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  // crxjs HMR 端口固定，避免每次变
  server: { port: 5174, strictPort: true, hmr: { port: 5174 } },
  build: { outDir: 'dist', emptyOutDir: true },
});
