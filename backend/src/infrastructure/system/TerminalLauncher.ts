import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execAsync = promisify(exec);

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
}

