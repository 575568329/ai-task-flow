// extension/src/background/index.ts
// 点击工具栏图标 → 自动打开/聚焦侧栏（sidePanel 行为模式）。
// activeTab 权限由此触发，获得当前页临时抓取权限（不声明 <all_urls>，无高权限警告）。
//
// 网络代理：side panel 作为扩展「页面」上下文，直接 fetch 本地后端(localhost)会触发
// Chrome Local Network Access 的拦截——application/json 的 POST 触发预检，被 PNA 拦到私有网络
// 的请求 → Failed to fetch。service worker 是扩展「特权后台」上下文，host_permissions 授权后
// 代理所有到后端的请求；扩展端统一用 text/plain（CORS 简单请求，不触发预检）从根上绕过 PNA。
// 详见 docs/20260617020000_网页剪藏扩展联调踩坑记录.md。

interface ProxyRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

interface ProxyResult {
  ok: boolean;
  status: number;
  statusText: string;
  /** 已尝试 JSON.parse 的响应体；非 JSON 响应为 null */
  json: unknown;
  /** 原始响应文本（错误诊断用） */
  text: string;
  /** fetch 本身抛出的网络层错误信息（如 Failed to fetch） */
  error?: string;
}

/** 在 service worker 上下文执行 fetch（享有 host_permissions 跨域授权） */
async function handleProxyFetch(req: ProxyRequest): Promise<ProxyResult> {
  try {
    const resp = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
    });
    const text = await resp.text();
    // 后端统一返回 JSON；非 JSON（如纯文本错误）时保留 text 供诊断
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { ok: resp.ok, status: resp.status, statusText: resp.statusText, json, text };
  } catch (e) {
    // 网络层失败（后端未启动 / host_permissions 未覆盖 / 浏览器拦截）。
    // 正常情况下 service worker 代理 + text/plain 不会到此；若到此先查后端是否在运行。
    const error = e instanceof Error ? e.message : String(e);
    console.error('[bg] PROXY_FETCH 失败', { url: req.url, error });
    return { ok: false, status: 0, statusText: '', json: null, text: '', error };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'PROXY_FETCH') {
    // return true：保持消息通道开启，直到异步的 sendResponse 被调用
    handleProxyFetch((msg.request ?? {}) as ProxyRequest).then(sendResponse);
    return true;
  }
  return undefined;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('[ai-task-flow] setPanelBehavior 失败', error));
});
