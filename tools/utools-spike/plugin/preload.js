/**
 * uTools 插件 preload(spike 最小版,CommonJS / Node 16,与 uTools Electron 22 匹配)。
 *
 * 生产形态下插件页面从包内加载,前端 API 请求需指向独立常驻的 backend;
 * 开发模式(development.main 指向 serve-108)由代理转发 /api,无需注入。
 */
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
