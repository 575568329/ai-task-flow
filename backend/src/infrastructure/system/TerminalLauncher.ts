import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import { toWslPath } from './pathCodec.js';
import type { TaskEnv } from '@ai-task-flow/shared';

const execAsync = promisify(exec);

/**
 * 三种环境的终端启动命令构造器(策略映射)。
 * 每个构造器接收 (Windows 路径, WSL 路径, resume 后缀),返回完整 start 命令。
 *
 * ⚠️ 切勿用 `mode con: cols=N lines=N` 强设终端尺寸!
 *   Windows 11 默认终端是 Windows Terminal(非经典 conhost):mode con 改的是
 *   conhost 兼容层缓冲区,而 WT 的真实可视区由 WT 窗口决定。两者一旦不一致,claude
 *   (Ink TUI)启动瞬间读到的行列数就与实际窗口不符,按错误尺寸渲染 → 文字垂直重叠 /
 *   右侧内容截断 / 内容堆在左上角 / 底部大片空白(TASK-005 步骤2「布局错乱」根因)。
 *   正解:不设尺寸,让 claude 读取终端宿主的真实尺寸渲染。窗口偏小用户自行拖拽即可。
 */
export const SHELL_LAUNCHERS: Record<
  TaskEnv,
  (winPath: string, wslPath: string, permArg: string, resumeArg: string) => string
> = {
  // cmd: 新开 cmd 窗口, /k 保持窗口不关闭, /d 切到工作目录
  // permArg:夜间模式时为 ' --permission-mode bypassPermissions'(跳过所有权限确认),否则空串
  // claude 退出后 cmd 窗口保持打开,等待用户手动关闭
  cmd: (winPath, _wsl, perm, resume) =>
    `start "Claude" cmd /k "cd /d "${winPath}" && claude${perm}${resume} || echo. && echo Claude 已退出,按任意键关闭窗口... && pause>nul"`,
  // wsl: 不能直接 `wsl.exe -- claude`——claude 退出(或 interop 启动 claude.exe 失败)时
  // wsl 进程立即结束、conhost 窗口一闪而过。用 bash -lc 包裹:登录 shell 确保 PATH/环境完整,
  // claude 退出后 exec bash -i 启动交互 shell 永久阻塞,窗口保持打开由用户手动关闭。
  wsl: (_win, wslPath, perm, resume) =>
    `start "Claude" wsl.exe --cd "${wslPath}" -- bash -lc "claude${perm}${resume}; exec bash -i"`,
  // pwsh: PowerShell 7, -NoExit 保持窗口不关闭
  // claude 退出后 pwsh 窗口保持打开,显示提示符等待用户手动关闭
  pwsh: (winPath, _wsl, perm, resume) =>
    `start pwsh.exe -NoExit -Command "cd '${winPath}'; claude${perm}${resume}; Write-Host ''; Write-Host 'Claude 已退出,可以手动关闭窗口' -ForegroundColor Yellow"`,
};

/**
 * 需要从子进程环境中剥离的环境变量前缀。
 *
 * 后端进程启动时 settings.json 的 env 字段被加载到 process.env（Claude Code 行为），
 * 而 start 命令打开的子终端会继承这些变量 → Claude Code 启动时 process.env 已被污染，
 * settings.json 里的配置无法正确生效。典型症状：弹窗打开的终端用的是后端进程启动时的
 * 模型配置，而非用户当前在 settings.json 里选的配置。
 *
 * 解决：exec 时显式传入不含这些前缀的 env，让子进程的 Claude Code 从 settings.json 读取。
 */
const ENV_PREFIXES_TO_STRIP = ['ANTHROPIC_', 'CLAUDE_'];

/**
 * 构建干净的子进程环境：复制当前 process.env 但剥离 Claude 相关变量。
 * 保留其他所有变量（PATH、SystemRoot 等）以确保终端能正常启动。
 */
function buildCleanEnv(): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (ENV_PREFIXES_TO_STRIP.some((prefix) => key.startsWith(prefix))) continue;
    if (value !== undefined) clean[key] = value;
  }
  return clean;
}

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
      await execAsync(command, { env: buildCleanEnv() });
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
    /** 夜间模式:拼 --permission-mode bypassPermissions 跳过所有权限确认 */
    bypassPermissions?: boolean;
  }): Promise<{ claudeCommand: string }> {
    const { repoPath, env, sessionId, bypassPermissions } = params;
    const resumeArg = sessionId ? ` --resume ${sessionId}` : '';
    // 夜间模式:拼 --permission-mode bypassPermissions(与 AgentRunner 写法一致,当前推荐方式)。
    // 仅 Windows 多环境分支(SHELL_LAUNCHERS)生效;非 Windows 回退(openAndRunClaude)不展开——
    // 与 resumeArg 同属既有回退路径限制,保持最小改动不扩大。
    const permArg = bypassPermissions ? ' --permission-mode bypassPermissions' : '';
    // claudeCommand 给前端写剪贴板:让它 = 真实执行命令,用户核对/手动粘贴时所见即所得
    const claudeCommand = `claude${permArg}${resumeArg}`;

    // 非 Windows 回退到默认终端(仅 cmd 形态),多环境启动是 Windows 专属能力
    if (os.platform() !== 'win32') {
      await this.openAndRunClaude(repoPath);
      return { claudeCommand };
    }

    const winPath = repoPath.replace(/\//g, '\\');
    const wslPath = toWslPath(repoPath);
    const command = SHELL_LAUNCHERS[env](winPath, wslPath, permArg, resumeArg);

    try {
      await execAsync(command, { env: buildCleanEnv() });
    } catch (error) {
      throw new Error(
        `Failed to launch ${env} terminal: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return { claudeCommand };
  }
}

