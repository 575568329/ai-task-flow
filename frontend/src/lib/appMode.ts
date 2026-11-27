// frontend/src/lib/appMode.ts
// 运行形态判定。
// uTools 市场版由启动页 iframe 带 ?market=1 打开;该形态下隐藏与「工作记录」主叙事无关、
// 且会读写用户其他工具配置的入口(Claude 配置切换),个人版/桌面版保持完整功能。
export function isMarketBuild(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('market');
}
