// extension/src/background/index.ts
// 点击工具栏图标 → 自动打开/聚焦侧栏（sidePanel 行为模式）。
// activeTab 权限由此触发，获得当前页临时抓取权限（不声明 <all_urls>，无高权限警告）。
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('[ai-task-flow] setPanelBehavior 失败', error));
});
