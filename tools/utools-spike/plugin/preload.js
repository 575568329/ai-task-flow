/**
 * AI Task Flow uTools 插件 preload(窗口适配版)
 *
 * 窗口实测(2026-08-20,本机 uTools 7.8.0 / 屏幕 1920x1200):
 * - uTools 主窗口宽度固定约 800px(实测 802),setExpendHeight 只能调高度不能调宽度
 * - 本应用(任务看板/自由画布)按 >=1024 宽度设计,内嵌主窗口形态不可用
 *
 * 适配策略:进入插件即创建独立工作台窗口(默认 1440x900,可调/可最大化),
 * 加载完成后隐藏 uTools 主窗口。独立窗口关闭后再呼出(atf)即可重新打开。
 *
 * 已知限制(spike 阶段):
 * - createBrowserWindow 的 url 文档标注为"相对路径 html",此处传入当前页面绝对 URL
 *   (开发模式 = serve-108 的 http://127.0.0.1:3108/),兼容性待 uTools 内实测;
 *   若不支持,回退方案为 plugin/ 放 launcher.html 中转。
 * - 独立窗口开着时再次呼出会开新窗口(uTools 无单例 API,生产形态需加防重入)。
 */
const WORKSPACE_WINDOW_OPTIONS = {
  width: 1440,
  height: 900,
  minWidth: 1024,
  minHeight: 640,
  resizable: true,
  maximizable: true,
  show: false,
  title: 'AI Task Flow',
  webPreferences: { preload: 'preload.js' },
};

function openWorkspaceWindow() {
  const targetUrl = window.location.href;
  const workspace = utools.createBrowserWindow(targetUrl, WORKSPACE_WINDOW_OPTIONS, () => {
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

if (window.utools && typeof utools.onPluginEnter === 'function') {
  utools.onPluginEnter(({ code }) => {
    if (code === 'ai-task-flow') openWorkspaceWindow();
  });
}

window.atfServices = {
  backendBase: 'http://127.0.0.1:3000',
  isBackendAlive: async () => {
    try {
      const res = await fetch('http://127.0.0.1:3000/api/tasks');
      return res.ok;
    } catch {
      return false;
    }
  },
};
