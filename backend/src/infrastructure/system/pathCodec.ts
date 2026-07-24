// backend/src/infrastructure/system/pathCodec.ts
// 真实路径 ↔ Claude Code projects 目录名的编解码 + Windows/WSL 路径互转。
//
// Claude Code 把每个项目的工作目录编码成目录名,规则(实测自本机):
// 把路径中的 \ / : . 四类字符全部替换为 '-'。
//   C:\Users\fjyu9\Desktop\ai-task-flow  →  C--Users-fjyu9-Desktop-ai-task-flow
//   /mnt/c/Users/fjyu9/Desktop/ai-task-flow  →  -mnt-c-Users-fjyu9-Desktop-ai-task-flow
//   D:\proj.x                              →  D--proj-x

const ENCODE_RE = /[\\/:.]/g;

/**
 * 编码:真实路径 → Claude projects 目录名(精确,用于匹配历史会话目录)。
 */
export function encodeProjectPath(rawPath: string): string {
  return rawPath.replace(ENCODE_RE, '-');
}

/**
 * Windows 路径 → WSL 路径。
 *   C:\Users\fjyu9\proj  →  /mnt/c/Users/fjyu9/proj
 *   D:/code/x            →  /mnt/d/code/x
 *
 * 用于:env=wsl 时启动 wsl.exe 的 --cd 参数,以及扫描 WSL 侧历史会话时编码。
 * 已是 /mnt 形态或无盘符的路径原样返回(正斜杠化)。
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
