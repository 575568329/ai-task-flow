/**
 * AI 工作记录 · uTools preload(必须保持明文可读,禁止压缩/混淆/打包)
 *
 * 职责只有一个:在 uTools 的 Node 运行时里把 backend 起起来,并把本地地址交给启动页。
 *  - 不依赖用户安装 Node:用 process.execPath + ELECTRON_RUN_AS_NODE=1 跑包内 backend
 *    (uTools 自带 Electron 的 Node 20);不打包任何 .exe/.node 原生二进制;
 *  - 不向页面暴露文件系统 / 命令执行 / 任意 URL 请求能力,只暴露固定的 backendBase + ready;
 *  - 后端只监听 127.0.0.1,前端由后端同源托管,/api 相对路径直接可用;
 *  - 个人版继续用 ~/.ai-task-flow,与现有 stdio MCP 共用同一份数据(双层文件锁保证并发安全)。
 *
 * 为什么不让 preload 直接 import 后端:uTools 8 的 preload 是对渲染进程的 CJS 注入,
 * 实测对包内 ESM 的 import() 会挂起(无 then/无 catch),所以后端必须作为独立 Node 子进程跑。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

/** 候选端口:避开 dev 后端的 47821;重入时按顺序探测并复用已有实例 */
const CANDIDATE_PORTS = [47921, 47922, 47923, 47924, 47925];
const HEALTH_TIMEOUT_MS = 800;

const pluginRoot = __dirname;
// 兼容两种安装来源:
//  - .upx / build 目录:backend、web 与本文件同级;
//  - 开发者工具误选源码目录 tools/utools:自动回退到 tools/utools/build(仅开发方便,
//    正式包不含这个回退,发行校验仍然要求同级产物)。
const hasRuntimeAtRoot = fs.existsSync(path.join(pluginRoot, 'web', 'index.html'));
const runtimeRoot = hasRuntimeAtRoot ? pluginRoot : path.join(pluginRoot, 'build');
const backendDir = path.join(runtimeRoot, 'backend');
const backendEntry = path.join(backendDir, 'plugin-entry.mjs');
const webDir = path.join(runtimeRoot, 'web');

/**
 * 本次构建标识(构建脚本写入 build-id.txt)。
 * 作用:端口上如果跑的是「上一版」后端,绝不能复用 —— 否则升级插件后页面仍连旧后端,
 * 用户看到的还是旧界面。开发目录没有该文件时退化为 dev,同一次运行的实例仍可复用。
 */
const BUILD_ID = readBuildId();

function readBuildId() {
  try {
    return fs.readFileSync(path.join(runtimeRoot, 'build-id.txt'), 'utf8').trim() || 'dev';
  } catch {
    return 'dev';
  }
}

/** 数据目录:尊重外部覆盖,个人版默认与 desktop/MCP 共用 ~/.ai-task-flow */
const dataDir = process.env.AI_TASK_FLOW_DATA_DIR
  ? path.resolve(process.env.AI_TASK_FLOW_DATA_DIR)
  : path.join(os.homedir(), '.ai-task-flow');
process.env.AI_TASK_FLOW_DATA_DIR = dataDir;

const logFile = path.join(dataDir, 'logs', 'utools.log');
/** 运行时状态目录:心跳 + 后端 pid 表(都属插件私有,不参与账号同步) */
const runtimeDir = path.join(dataDir, 'run');
const heartbeatFile = path.join(runtimeDir, 'plugin-heartbeat.json');
const HEARTBEAT_INTERVAL_MS = 10_000;

function pidFileFor(port) {
  return path.join(runtimeDir, `backend-${port}.json`);
}

function writeRuntimeFile(file, value) {
  try {
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value)}\n`, 'utf8');
  } catch {
    // 状态文件写失败不影响启动
  }
}

/**
 * 心跳:backend 侧超过 60s 收不到就自行退出,避免 uTools 退出后留下孤儿进程。
 * 复用已有后端时新进程立刻开始心跳,所以重用不会误判成"父进程已退出"。
 */
function startHeartbeat() {
  const beat = () => writeRuntimeFile(heartbeatFile, {
    pid: process.pid,
    buildId: BUILD_ID,
    ts: Date.now(),
  });
  beat();
  const timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
}

function log(level, message) {
  const line = `[${new Date().toISOString()}] [${level}] [utools] ${message}`;
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `${line}\n`, 'utf8');
  } catch {
    // 日志失败不影响启动
  }
  if (level === 'ERROR') console.error(line);
  else console.log(line);
}

/** 探测某个端口上是否已经是本插件的后端;返回健康信息里的 buildId 供版本握手 */
async function probeService(port) {
  const base = `http://127.0.0.1:${port}`;
  try {
    const health = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!health.ok) return null;
    const payload = await health.json();
    if (payload.service !== 'ai-task-flow') return null;
    const root = await fetch(`${base}/`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!root.ok) return null;
    return { base, buildId: typeof payload.buildId === 'string' ? payload.buildId : '' };
  } catch {
    return null;
  }
}

/**
 * 找可复用的后端,同时收集「旧构建」端口。
 * 只复用 buildId 完全一致的实例:升级插件后旧实例会被替换,不会出现新旧界面混用。
 */
async function findReuseDecision() {
  const stalePorts = [];
  let reusable = null;
  for (const port of CANDIDATE_PORTS) {
    const found = await probeService(port);
    if (!found) continue;
    if (found.buildId !== BUILD_ID) {
      stalePorts.push(port);
      log('INFO', `端口 ${port} 上是旧构建(${found.buildId || '未知'}),不复用`);
      continue;
    }
    if (!reusable) reusable = found.base;
  }
  return { reusable, stalePorts };
}

/** 停掉旧构建的后端(只杀 pid 表里记录且刚探测到的端口,避免误伤无关进程) */
function stopStaleBackends(ports) {
  for (const port of ports) {
    const file = pidFileFor(port);
    try {
      const record = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (typeof record.pid === 'number' && record.pid > 0) {
        process.kill(record.pid, 'SIGTERM');
        log('INFO', `已停止旧构建 backend pid=${record.pid} port=${port}`);
      }
    } catch {
      // 没有 pid 表或进程已退出:交给 spawn 侧顺延端口即可
    }
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // 删除失败无影响
    }
  }
}

function recordBackend(port, pid) {
  if (!port || !pid) return;
  writeRuntimeFile(pidFileFor(port), { pid, port, buildId: BUILD_ID, startedAt: Date.now() });
}

function spawnBackend() {
  log('INFO', `启动 backend 子进程 entry=${backendEntry} dataDir=${dataDir} web=${webDir}`);
  // 明确报错:直接把源码目录 tools/utools 装进 uTools 时没有 backend/web,
  // 让启动页显示可操作提示,而不是一直转圈。
  if (!fs.existsSync(backendEntry)) {
    throw new Error(
      `找不到后端产物: ${backendEntry}\n`
      + '请安装 .upx,或在开发者工具里选择 tools/utools/build 目录(不要选源码目录 tools/utools)。',
    );
  }
  if (!fs.existsSync(path.join(webDir, 'index.html'))) {
    throw new Error(
      `找不到前端产物: ${webDir}/index.html\n`
      + '请先运行 node tools/utools/build.mjs,或安装 .upx。',
    );
  }

  let logFd;
  try {
    fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true });
    logFd = fs.openSync(path.join(dataDir, 'logs', 'backend.log'), 'a');
  } catch {
    // 日志文件打不开就丢弃子进程输出
  }

  const child = spawn(process.execPath, [backendEntry], {
    cwd: backendDir,
    env: {
      ...process.env,
      // 关键:让 uTools.exe 以 Node 模式运行 backend,不依赖系统 node
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(CANDIDATE_PORTS[0]),
      AI_TASK_FLOW_WEB: webDir,
      AI_TASK_FLOW_DATA_DIR: dataDir,
      // 版本握手:后端在 /health 里回报,preload 只复用同 buildId 的实例
      AI_TASK_FLOW_BUILD_ID: BUILD_ID,
      // 心跳看门狗:uTools 退出后没人续写心跳,后端自行退出,不留孤儿
      AI_TASK_FLOW_PLUGIN_HEARTBEAT: heartbeatFile,
    },
    stdio: ['ignore', logFd ?? 'ignore', logFd ?? 'ignore'],
    windowsHide: true,
    detached: true,
  });
  if (logFd !== undefined) fs.closeSync(logFd);
  child.unref();
  // 仅挂在本进程 globalThis 便于排障/测试清理,不暴露给页面 window
  globalThis.__ATF_CHILD = child;
  log('INFO', `backend 子进程已拉起 pid=${child.pid ?? '?'}`);
  return child;
}

/** 轮询候选端口,等后端静态页和 health 都就绪(且必须是本次构建) */
async function waitForBackend(timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    for (const port of CANDIDATE_PORTS) {
      const found = await probeService(port);
      if (found && found.buildId === BUILD_ID) {
        log('INFO', `backend 已监听 ${found.base}`);
        return { base: found.base, port };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(
    `后端启动超时(${timeoutMs / 1000}s)。请查看 ${path.join(dataDir, 'logs', 'backend.log')}`,
  );
}

let syncApi = null;
try {
  syncApi = require('./preload-sync.js');
} catch (error) {
  log('WARN', `同步模块加载失败(不影响本地使用): ${error instanceof Error ? error.message : String(error)}`);
}

async function bootstrap() {
  // 先尽量拉取账号云端快照再启动 backend,保证页面首次读取就是最新数据
  let syncReady = false;
  if (syncApi && window.top === window) {
    try {
      syncReady = await syncApi.syncOnce(dataDir, log);
    } catch (error) {
      log('WARN', `启动同步失败(继续使用本地数据): ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 心跳先行:即使复用的是上一秒拉起的后端,也让它知道"插件还活着"
  if (window.top === window) startHeartbeat();

  const { reusable, stalePorts } = await findReuseDecision();
  if (reusable) {
    if (syncApi && window.top === window && syncReady) syncApi.startWatcher(dataDir, log);
    return reusable;
  }
  stopStaleBackends(stalePorts);

  const child = spawnBackend();
  const { base, port } = await waitForBackend();
  recordBackend(port, child.pid);
  if (syncApi && window.top === window && syncReady) syncApi.startWatcher(dataDir, log);
  return base;
}

let resolveReady;
let rejectReady;
const ready = new Promise((resolve, reject) => {
  resolveReady = resolve;
  rejectReady = reject;
});

// 启动页通过这个对象等待本地服务;只暴露地址与就绪信号,不暴露任何 Node 能力
window.atfServices = { ready, backendBase: null, error: null };

// uTools 内置 MCP:在插件初始化阶段注册工具;处理器等 backend ready 后再请求本地 API。
// 只在主框架注册,避免 iframe 内重复注册。
if (window.top === window) {
  try {
    const { registerTools } = require('./preload-tools.js');
    registerTools(() => ready);
  } catch (error) {
    log('ERROR', `注册 uTools MCP 工具失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

bootstrap()
  .then((base) => {
    window.atfServices.backendBase = base;
    resolveReady(base);
  })
  .catch((error) => {
    const message = error instanceof Error ? (error.stack || error.message) : String(error);
    window.atfServices.error = message;
    log('ERROR', `启动失败: ${message}`);
    rejectReady(error instanceof Error ? error : new Error(String(error)));
  });
