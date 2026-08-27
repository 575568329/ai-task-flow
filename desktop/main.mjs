// desktop/main.mjs — AI Task Flow 桌面版(Electron 壳)
// 形态:主进程直接 import backend 的 startApp(同进程树,无独立 node 依赖),
//       窗口加载 http://127.0.0.1:<实际端口>(同源托管前端,API 走相对路径,
//       与浏览器版同一套产物);数据照旧 ~/.ai-task-flow,三端共享。
// 打包:backend dist/public/node_modules 收进 extraResources(非 asar,ESM 动态
//       import 与 workspace shared 实体都放 resources/backend 下)。
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEV_BACKEND_ROOT = path.resolve(import.meta.dirname, '..', 'backend');
const backendRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'backend')
  : DEV_BACKEND_ROOT;
const entry = path.join(backendRoot, 'dist', 'http-server.js');
const frontendDist = path.join(backendRoot, 'public');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  let server;
  app.whenReady().then(async () => {
    const { startApp } = await import(pathToFileURL(entry).href);
    // 端口让给 startApp 的占位探测(3000 被占自动顺延),窗口用实际端口
    server = await startApp({ frontendDist, port: 3000 });
    const addr = server.server.address();
    const port = typeof addr === 'object' && addr !== null ? addr.port : 3000;

    const win = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 1024,
      minHeight: 640,
      title: 'AI Task Flow',
    });
    await win.loadURL(`http://127.0.0.1:${port}`);
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', () => {
    // 退出时关 HTTP 服务(进程退出兜底,失败不阻塞退出)
    try {
      server?.close();
    } catch {
      // best-effort
    }
  });
}
