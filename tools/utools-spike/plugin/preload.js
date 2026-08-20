/**
 * AI Task Flow uTools 插件 preload(生产打包版)
 *
 * 职责:
 * 1. 独立工作台窗口(紧凑主窗 802 放不下本应用,进插件即弹独立窗并最大化近似尺寸)
 * 2. backend 守护:健康检查 127.0.0.1:3000,不通则 spawn 系统 node 拉起
 *    backend/dist/http-server.js(PORT=3000,detached 不随插件退出),就绪后 reload 页面补数据
 *
 * 环境:uTools preload 为 CommonJS(渲染进程 + Node require)。
 * 已知限制:再次呼出会多开独立窗口(uTools 无单例 API);backend 项目路径硬编码(个人工具)。
 */
const BACKEND_PORT = 3000;
const BACKEND_DIR = 'D:\\study\\ai-task-flow\\backend';
const BACKEND_ENTRY = BACKEND_DIR + '\\dist\\http-server.js';
const HEALTH_URL = 'http://127.0.0.1:' + BACKEND_PORT + '/api/tasks';

function openWorkspaceWindow() {
  const targetUrl = window.location.href;
  // 按屏幕工作区开窗(约满屏):uTools 定制窗口 maximize() 实测不生效
  const availWidth = (window.screen && window.screen.availWidth) || 1440;
  const availHeight = (window.screen && window.screen.availHeight) || 900;
  const workspace = utools.createBrowserWindow(targetUrl, {
    width: availWidth,
    height: availHeight,
    minWidth: 1024,
    minHeight: 640,
    resizable: true,
    maximizable: true,
    show: false,
    title: 'AI Task Flow',
    webPreferences: { preload: 'preload.js' },
  }, () => {
    try {
      workspace.show();
      workspace.maximize();
    } catch (err) {
      console.error('workspace window show/maximize failed:', err);
    }
    utools.hideMainWindow();
  });
  return workspace;
}

function fetchWithTimeout(url, ms) {
  return Promise.race([
    fetch(url),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

/** backend 守护:不通则 spawn 拉起,就绪后 reload(页面首屏请求可能已失败,重载补数据) */
function ensureBackend() {
  fetchWithTimeout(HEALTH_URL, 2500)
    .then((res) => {
      if (res.ok) return null; // 已在跑(dev 形态/backend 常驻),不动
      throw new Error('unhealthy');
    })
    .catch(() => {
      let child;
      try {
        const { spawn } = require('child_process');
        child = spawn('node', [BACKEND_ENTRY], {
          cwd: BACKEND_DIR,
          env: Object.assign({}, process.env, { PORT: String(BACKEND_PORT) }),
          detached: true,  // 脱离插件生命周期:插件退出后 backend 常驻
          stdio: 'ignore',
        });
        child.unref();
      } catch (err) {
        console.error('[atf] spawn backend failed:', err);
        return;
      }
      // 轮询至多 30s 等监听;页面已渲染空态 → 就绪后 reload 一次补数据
      let waited = 0;
      const timer = setInterval(() => {
        waited += 1000;
        fetchWithTimeout(HEALTH_URL, 1500)
          .then((res) => {
            if (!res.ok) return;
            clearInterval(timer);
            if (document.readyState === 'complete' || document.readyState === 'interactive') {
              window.location.reload();
            }
          })
          .catch(() => {
            if (waited >= 30000) clearInterval(timer);
          });
      }, 1000);
    });
}

ensureBackend();

if (window.utools && typeof utools.onPluginEnter === 'function') {
  utools.onPluginEnter(({ code }) => {
    if (code === 'ai-task-flow') openWorkspaceWindow();
  });
}

window.atfServices = {
  backendBase: 'http://127.0.0.1:' + BACKEND_PORT,
};
