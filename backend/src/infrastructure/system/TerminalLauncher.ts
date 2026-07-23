import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import { toWslPath } from './pathCodec.js';
import type { TaskEnv } from '@ai-task-flow/shared';

const execAsync = promisify(exec);

/**
 * 终端窗口目标尺寸:列 × 行。
 * 经典 conhost 默认仅 80×25,打开后偏小;设为 140×40 接近现代终端默认,宽敞可用。
 * cmd/pwsh 用 `mode con` 设置;wsl.exe 无尺寸参数,窗口尺寸随终端宿主(Windows Terminal/控制台)默认。
 */
const TERM_COLS = 140;
const TERM_LINES = 40;

/**
 * 三种环境的终端启动命令构造器(策略映射)。
 * 每个构造器接收 (Windows 路径, WSL 路径, resume 后缀),返回完整 start 命令。
 */
const SHELL_LAUNCHERS: Record<
  TaskEnv,
  (winPath: string, wslPath: string, resumeArg: string) => string
> = {
  // cmd: 新开 cmd 窗口, /k 保持窗口, /d 切到工作目录
  cmd: (winPath, _wsl, resume) =>
    `start "Claude" cmd /k "mode con: cols=${TERM_COLS} lines=${TERM_LINES} && cd /d "${winPath}" && claude${resume}"`,
  // wsl: 不能直接 `wsl.exe -- claude`——claude 退出(或 interop 启动 claude.exe 失败)时
  // wsl 进程立即结束、conhost 窗口一闪而过。用 bash -lc 包裹:登录 shell 确保 PATH/环境完整,
  // 末尾 exec bash 保证 claude 退出后窗口不关(便于看到启动失败的原因,而不是闪退)。
  wsl: (_win, wslPath, resume) =>
    `start "Claude" wsl.exe --cd "${wslPath}" -- bash -lc "claude${resume}; exec bash"`,
  // pwsh: PowerShell 7, -NoExit 保持窗口
  pwsh: (winPath, _wsl, resume) =>
    `start pwsh.exe -NoExit -Command "cmd /c mode con: cols=${TERM_COLS} lines=${TERM_LINES} | Out-Null; cd '${winPath}'; claude${resume}"`,
};

export class TerminalLauncher {
  /**
   * 打开新终端窗口并运行 claude 命令
   * @param projectPath 项目路径
   */
  static async openAndRunClaude(projectPath: string): Promise<void> {
    const platform = os.platform();

    let command: string;

    if (platform === 'win32') {
      // Windows: 使用 start cmd 打开新窗口
      // /k 保持窗口打开, /d 指定工作目录
      const normalizedPath = projectPath.replace(/\//g, '\\');
      command = `start "Claude Task" cmd /k "cd /d "${normalizedPath}" && claude"`;
    } else if (platform === 'darwin') {
      // Mac: 使用 osascript 控制 Terminal.app
      command = `osascript -e 'tell application "Terminal" to do script "cd ${projectPath} && claude"' -e 'tell application "Terminal" to activate'`;
    } else {
      // Linux: 尝试常见终端模拟器
      command = `gnome-terminal --working-directory="${projectPath}" -- bash -c "claude; exec bash"`;
    }

    try {
      await execAsync(command);
    } catch (error) {
      throw new Error(`Failed to launch terminal: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 打开指定环境(cmd/wsl/pwsh)的新终端窗口并启动 claude,可选 resume 历史会话。
   * Windows 专用:cmd/pwsh 走原生 start,wsl 走 wsl.exe。
   *
   * 注意:start 启动的窗口是 fire-and-forget,Node 无法向其注入消息;
   * 真正"拉取任务"靠 Claude Code 内部调用 get_task 工具(MCP 拉模型),不走注入。
   *
   * @returns claudeCommand 给前端写剪贴板的命令文本(用户在新窗口看到的就是它的展开)
   */
  static async openClaude(params: {
    repoPath: string;
    env: TaskEnv;
    sessionId?: string;
  }): Promise<{ claudeCommand: string }> {
    const { repoPath, env, sessionId } = params;
    const resumeArg = sessionId ? ` --resume ${sessionId}` : '';
    const claudeCommand = `claude${resumeArg}`;

    // 非 Windows 回退到默认终端(仅 cmd 形态),多环境启动是 Windows 专属能力
    if (os.platform() !== 'win32') {
      await this.openAndRunClaude(repoPath);
      return { claudeCommand };
    }

    const winPath = repoPath.replace(/\//g, '\\');
    const wslPath = toWslPath(repoPath);
    const command = SHELL_LAUNCHERS[env](winPath, wslPath, resumeArg);

    try {
      await execAsync(command);
    } catch (error) {
      throw new Error(
        `Failed to launch ${env} terminal: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return { claudeCommand };
  }
}

