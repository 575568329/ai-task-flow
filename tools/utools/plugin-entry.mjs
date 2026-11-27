// uTools 插件的 backend 子进程入口。
// 由 preload 用 Electron 自带的 Node 运行(ELECTRON_RUN_AS_NODE=1 process.execPath),
// 因此不依赖用户安装 Node,也不要求把 backend 编译成 exe(审核禁止原生二进制)。
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.env.PORT) || 47921;
const webDir = process.env.AI_TASK_FLOW_WEB || path.resolve('web');
const entry = pathToFileURL(path.resolve('dist', 'http-server.js')).href;

const { startApp } = await import(entry);
const server = await startApp({
  port,
  host: '127.0.0.1',
  frontendDist: webDir,
});
const address = server.server.address();
const actualPort = address && typeof address === 'object' ? address.port : port;
console.log(`[plugin-entry] backend ready: http://127.0.0.1:${actualPort}`);

/**
 * 心跳看门狗:preload 每 10s 续写一次心跳文件。
 * 子进程是 detached 的,不主动退出的话 uTools 关闭后会一直留着一个后台进程;
 * 这里在连续 60s+ 没有心跳时自行关服务退出。复用旧实例时新 preload 立刻开始写心跳,
 * 所以「复用」不会被误判成「宿主已退出」。
 */
const heartbeatFile = process.env.AI_TASK_FLOW_PLUGIN_HEARTBEAT;
const HEARTBEAT_STALE_MS = 60_000;
const WATCHDOG_INTERVAL_MS = 15_000;

function heartbeatFresh() {
  try {
    const { ts } = JSON.parse(fs.readFileSync(heartbeatFile, 'utf8'));
    return typeof ts === 'number' && Date.now() - ts < HEARTBEAT_STALE_MS;
  } catch {
    return false;
  }
}

if (heartbeatFile) {
  let misses = 0;
  const timer = setInterval(async () => {
    if (heartbeatFresh()) {
      misses = 0;
      return;
    }
    misses += 1;
    if (misses < 2) return;
    clearInterval(timer);
    console.log('[plugin-entry] 插件心跳超时,后端自行退出');
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  }, WATCHDOG_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
}
