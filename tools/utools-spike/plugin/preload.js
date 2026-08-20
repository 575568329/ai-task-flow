/**
 * AI Task Flow uTools 插件 preload(窗口适配 v2)
 *
 * 窗口实测(2026-08-20,本机 uTools 7.8.0 / 屏幕 1920x1200):
 * - uTools 主窗口宽 802px 固定不可调,内嵌形态下 40+ 元素被裁(eton-probe 实测),不可用
 * - createBrowserWindow 传绝对 URL(serve-108)实测可用,独立窗口正常加载应用
 * - createBrowserWindow 返回的窗口 maximize() 实测不生效(文档示例亦无此方法),
 *   窗口停留在初始尺寸导致"已完成"列被裁 → 改为按屏幕工作区(availWidth/availHeight)开窗
 * - 1440x900 及以上视口布局无横向溢出(eton-probe 实测),应用结构无需改动
 *
 * 已知限制(spike 阶段):
 * - 独立窗口开着时再次呼出会开新窗口(uTools 无单例 API,生产形态需加防重入)
 * - 手动缩到 <1024 宽时内容会被 overflow-hidden 裁剪(与浏览器同表现)
 */
function openWorkspaceWindow() {
  const targetUrl = window.location.href;
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
