// desktop/main.mjs — AI Task Flow 桌面版(Electron 壳)
// 形态:主进程直接 import backend 的 startApp(同进程树,无独立 node 依赖),
//       窗口加载 http://127.0.0.1:<实际端口>(同源托管前端,API 走相对路径,
//       与浏览器版同一套产物);数据照旧 ~/.ai-task-flow,四端共享。
// 打包:backend dist/public/node_modules 收进 extraResources(非 asar,ESM 动态
//       import 与 workspace shared 实体都放 resources/backend 下)。
//
// 健壮性(角色审阅四必修):
//  1. 知识库目录统一走 backend dataDir(~/.ai-task-flow/knowledge-base),
//     不再有 dev/dist/portable 三处分裂(portable 曾解压 %TEMP% 写完即丢)。
//  2. 启动前健康检查 3000:已有 backend(dev/uTools 常驻)在跑则直接复用,
//     不再顺延端口起第二实例并发写 tasks.json(单写者原则)。
//  3. startApp 失败必须可见可诊:错误对话框 + 日志落 ~/.ai-task-flow/logs/desktop.log。
//  4. 退出等待 Fastify close 钩子(AgentRuntime 杀 claude 子进程)完成,
//     防孤儿进程;另挂 uncaughtException 兜底防 backend 异常带崩整个壳。
import { app, BrowserWindow, dialog } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PREFERRED_PORT = 3000;
const DEV_BACKEND_ROOT = path.resolve(import.meta.dirname, '..', 'backend');
const backendRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'backend')
  : DEV_BACKEND_ROOT;
const entry = path.join(backendRoot, 'dist', 'http-server.js');
const frontendDist = path.join(backendRoot, 'public');
const logFile = path.join(os.homedir(), '.ai-task-flow', 'logs', 'desktop.log');

function log(level, msg) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, line);
  } catch {
    // 日志目录不可写时仅 stdout(best-effort,不阻断启动)
  }
  console.log(line.trimEnd());
}

/** 健康检查:已有 backend 在该端口则返回 true(复用,不再起第二实例) */
async function isBackendAlive(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/tasks`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  // backend 的 claude 子进程/git/stdio IO 若抛未捕获异常,兜底记录而非带崩整个壳
  process.on('uncaughtException', (err) => log('ERROR', `uncaughtException: ${err.stack ?? err}`));
  process.on('unhandledRejection', (reason) => log('ERROR', `unhandledRejection: ${reason}`));

  let server = null;
  let quitting = false;

  app.whenReady().then(async () => {
    try {
      // 单写者原则:已有 backend(dev/uTools 常驻)占用 3000 则直接复用;
      // 否则主进程内起新实例(端口被占且非 backend 时 startApp 自行顺延)
      let port = PREFERRED_PORT;
      if (await isBackendAlive(PREFERRED_PORT)) {
        log('INFO', `端口 ${PREFERRED_PORT} 已有 backend,复用不再起新实例`);
      } else {
        const { startApp } = await import(pathToFileURL(entry).href);
        server = await startApp({ frontendDist, port: PREFERRED_PORT });
        const addr = server.server.address();
        port = typeof addr === 'object' && addr !== null ? addr.port : PREFERRED_PORT;
        log('INFO', `backend started on port ${port} (frontend: ${frontendDist})`);
      }

      const win = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 640,
        title: 'AI Task Flow',
      });
      await win.loadURL(`http://127.0.0.1:${port}`);
    } catch (err) {
      // 启动失败必须可见可诊:弹窗 + 落日志,然后干净退出(不留假活进程)
      const msg = err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err);
      log('ERROR', `startup failed: ${msg}`);
      dialog.showErrorBox('AI Task Flow 启动失败', `后台服务启动异常,详见日志:\n${logFile}\n\n${msg.slice(0, 500)}`);
      app.exit(1);
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  // 优雅退出:Electron 默认不等待异步 close——preventDefault 后等 Fastify
  // 关闭钩子(agentRuntimeManager.shutdown() 杀 claude 子进程)跑完再 exit,
  // 否则 Windows 下 spawn 的 claude 成孤儿进程
  app.on('before-quit', (event) => {
    if (quitting || !server) return;
    quitting = true;
    event.preventDefault();
    server.close().then(
      () => app.exit(0),
      (err) => {
        log('WARN', `server close error: ${err}`);
        app.exit(0);
      },
    );
  });
}
