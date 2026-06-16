import { FastifyPluginAsync } from 'fastify';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
// @ts-ignore - node-file-dialog 没有类型定义(仅非 Windows 平台回退使用)
import askdialog from 'node-file-dialog';
import { StorageService } from '../../../application/system/StorageService.js';
import type { StorageClearRequest } from '@ai-task-flow/shared';

const execFileAsync = promisify(execFile);

/**
 * Windows 原生文件夹选择对话框。
 *
 * 为什么不用 node-file-dialog:它内部 exec() 默认按 UTF-8 解码子进程 stdout,
 * 而 Windows 控制台输出中文路径用的是 ANSI 代码页(GBK)。「桌面」的 GBK 字节
 * 被当 UTF-8 解码会不可逆地损坏成 � 替换字符(WS-007 即由此产生)。
 *
 * 解法(双向 ASCII 安全,彻底规避代码页问题):
 *   - 入:脚本经 -EncodedCommand 以 UTF-16LE base64 传入,免命令行转义/编码。
 *   - 出:PowerShell 把所选路径转成 UTF-8 字节再 base64 输出(纯 ASCII),
 *         Node 端 base64 解码回 UTF-8,中文完整无损。
 * 用户取消选择时输出空,返回 null。
 */
async function selectDirectoryWindows(): Promise<string | null> {
  // STA 线程是 WinForms 对话框的硬性要求。选中则输出 base64(UTF-8),取消输出空。
  const psScript = `
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "选择项目文件夹"
$dialog.ShowNewFolderButton = $false
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK -and $dialog.SelectedPath) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($dialog.SelectedPath)
  [Console]::Out.Write([System.Convert]::ToBase64String($bytes))
}
`.trim();

  // -EncodedCommand 要求 UTF-16LE base64
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');

  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encoded],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 },
  );

  const b64 = stdout.trim();
  if (!b64) return null; // 用户取消
  return Buffer.from(b64, 'base64').toString('utf8');
}

/** 非 Windows 平台回退到 node-file-dialog(Mac/Linux 为 UTF-8 原生,无编码问题) */
async function selectDirectoryFallback(): Promise<string | null> {
  const result = await askdialog({ type: 'directory' });
  const dir = Array.isArray(result) ? result[0] : result;
  return dir || null;
}

const systemRoutes: FastifyPluginAsync = async (fastify) => {
  // 选择文件夹
  fastify.post('/api/system/select-directory', async (req, reply) => {
    try {
      const path =
        os.platform() === 'win32'
          ? await selectDirectoryWindows()
          : await selectDirectoryFallback();
      return { path };
    } catch (error) {
      fastify.log.error(error, 'Failed to open directory dialog');
      return { path: null, error: 'Failed to open directory dialog' };
    }
  });

  // ===== 存储占用监控 + 按类清理 =====
  // StorageService 无状态、无依赖,直接实例化。
  const storageService = new StorageService();

  // GET /api/system/storage — 各数据文件/目录占用 + 总占用 + 告警标志
  fastify.get('/api/system/storage', async () => {
    return storageService.getStorage();
  });

  // POST /api/system/storage/clear — 按类别清理(仅 clearable 项生效;业务数据被忽略)
  fastify.post<{ Body: StorageClearRequest }>(
    '/api/system/storage/clear',
    async (request, reply) => {
      const { categories } = request.body ?? {};
      if (!Array.isArray(categories)) {
        return reply.status(400).send({ error: 'categories 必须为数组' });
      }
      const { results, storage } = await storageService.clearCategories(categories);
      return { results, storage };
    },
  );
};

export default systemRoutes;
