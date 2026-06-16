// extension/src/sidepanel/permissions.ts
// 侧栏抓取的主机权限管理。
//
// 背景:side panel 内 executeScript 的 activeTab 临时权限不延续生效
// (action 配置 openPanelOnActionClick 后,后续点侧栏按钮不再授予 activeTab)，
// 故改用 optional_host_permissions 运行时按需请求:
// 首次抓某网站弹一次权限框,允许后该网站永久可抓;拒绝或非 http(s) 页则抛错。
// 无安装时高权限警告(不用 <all_urls>),符合 Chrome 官方推荐做法。

/**
 * 确保扩展对当前页有主机权限:已授权直接返回,否则在用户手势内请求一次。
 * 调用方必须在用户手势(如按钮 onClick)链中调用,否则 request() 会被拒绝。
 */
export async function ensureHostPermission(tabUrl: string | undefined): Promise<void> {
  if (!tabUrl) throw new Error('无法读取当前页地址');
  let url: URL;
  try {
    url = new URL(tabUrl); // 地址格式错误(如纯文本)在这里抛
  } catch {
    throw new Error('当前页面地址无效，无法抓取');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`不支持抓取 ${url.protocol} 页面，请打开普通 http/https 网页`);
  }
  const pattern = `${url.origin}/*`;
  if (await chrome.permissions.contains({ origins: [pattern] })) return;
  const accepted = await chrome.permissions.request({ origins: [pattern] });
  if (!accepted) throw new Error('需要授权访问当前网站才能抓取（已取消）');
}
