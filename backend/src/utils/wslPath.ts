// backend/src/utils/wslPath.ts
// Windows 路径 → WSL /mnt 形态转换(纯字符串,无 IO)。
// P2-18:从 infrastructure/system/pathCodec 上提至 utils,消除 domain/claude-profile/
// settingsCodec → infrastructure 的跨层违规(原全项目 domain 层唯一 infrastructure 引用)。
// pathCodec 仍 re-export 保持现有 infrastructure 调用方兼容。
/**
 * Windows 路径 → WSL 路径。已是 /mnt 形态或无盘符的路径原样返回(正斜杠化)。
 * 用于 env=wsl 时 wsl.exe 的 --cd 参数、WSL 侧历史会话扫描编码、settings hooks 路径改写。
 */
export function toWslPath(windowsPath: string): string {
  const forward = windowsPath.replace(/\\/g, '/');
  // 匹配盘符开头: 可选前导 / + 盘符 + :
  const m = forward.match(/^\/?(?<drive>[a-zA-Z]):(?=\/)/);
  if (m && m.groups) {
    const drive = m.groups.drive.toLowerCase();
    return forward.replace(/^\/?[a-zA-Z]:/, `/mnt/${drive}`);
  }
  return forward;
}
