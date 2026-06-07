#!/usr/bin/env node
// cli/bin/ai-task-flow.js
// @ai-task-flow/cli 入口
// 启动后端单端口托管前端,并自动打开浏览器
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';

const HELP = `
ai-task-flow — 个人 AI 任务编排看板 + MCP Server

用法:
  ai-task-flow [start] [选项]

命令:
  start                启动 Web 服务(默认)

选项:
  -p, --port <port>    HTTP 端口 (默认 3000)
      --host <host>    监听地址 (默认 0.0.0.0)
      --data-dir <dir> 数据存储目录 (默认 ~/.ai-task-flow)
      --no-open        不自动打开浏览器
      --frontend <dir> 自定义前端 dist 目录(开发者用)
  -v, --version        显示版本
  -h, --help           显示帮助

示例:
  ai-task-flow                       # 在 :3000 启动并自动打开
  ai-task-flow start -p 8080         # 用 8080 端口
  ai-task-flow --data-dir D:/atf     # 数据存到 D:/atf
  ai-task-flow --no-open             # 不自动打开浏览器

数据存储位置: ~/.ai-task-flow/ (可用 --data-dir 自定义)
`;

function parseArgs(argv) {
  const opts = {
    command: 'start',
    port: undefined,
    host: undefined,
    open: true,
    frontend: undefined,
    dataDir: undefined,
    help: false,
    version: false,
  };

  const args = argv.slice(2);
  let i = 0;

  // 第一个非选项参数视为命令
  if (args[0] && !args[0].startsWith('-')) {
    opts.command = args[0];
    i = 1;
  }

  for (; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '-p':
      case '--port':
        opts.port = parseInt(args[++i], 10);
        break;
      case '--host':
        opts.host = args[++i];
        break;
      case '--data-dir':
        opts.dataDir = args[++i];
        break;
      case '--no-open':
        opts.open = false;
        break;
      case '--frontend':
        opts.frontend = args[++i];
        break;
      case '-v':
      case '--version':
        opts.version = true;
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        console.error(`未知参数: ${a}`);
        console.error('运行 `ai-task-flow --help` 查看用法');
        process.exit(2);
    }
  }
  return opts;
}

/**
 * 解析前端 dist 目录:
 * 1. CLI --frontend 显式传入
 * 2. 同包 backend dist 旁的 public(从 npm 全局安装时的相对位置)
 * 3. monorepo 开发态: ../../backend/public
 */
function resolveFrontendDist(cliFrontend) {
  if (cliFrontend) return path.resolve(cliFrontend);

  const here = path.dirname(fileURLToPath(import.meta.url)); // cli/bin

  // 候选路径(按优先级)
  const candidates = [
    // monorepo 开发态: <repo>/backend/public
    path.resolve(here, '../../backend/public'),
    // 安装态(扁平 npm install): node_modules/@ai-task-flow/backend/public
    path.resolve(here, '../node_modules/@ai-task-flow/backend/public'),
    // 安装态(嵌套): cli/node_modules/@ai-task-flow/backend/public
    path.resolve(here, '../../@ai-task-flow/backend/public'),
  ];

  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'index.html'))) return c;
  }
  return undefined;
}

/**
 * 检查端口是否可用(避免 fastify 启动到一半才报 EADDRINUSE)
 * @returns Promise<true> 可用 / Promise<false> 占用
 */
function isPortAvailable(port, host = '0.0.0.0') {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.close(() => resolve(true));
      })
      .listen(port, host);
  });
}

/**
 * 探测目标端口上的服务是什么类型。
 * - 'web':    完整 ai-task-flow CLI 实例(可 reuse)
 * - 'api':    ai-task-flow 但只跑 API(dev 模式 backend),不能 reuse 否则浏览器 404
 * - 'other':  端口被其他程序占用,或无响应
 */
async function probeService(port, host) {
  const probeHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 800);
    const res = await fetch(`http://${probeHost}:${port}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return 'other';
    const data = await res.json();
    if (data?.service !== 'ai-task-flow') return 'other';
    return data?.web === true ? 'web' : 'api';
  } catch {
    return 'other';
  }
}

/**
 * 从 preferred 起找一个可用端口,最多探 max 个候选。
 * 已是我们自己占着的端口会跳过(由调用方先做 reuse 判断)。
 */
async function findAvailablePort(preferred, host, max = 20) {
  for (let i = 0; i < max; i++) {
    const candidate = preferred + i;
    if (await isPortAvailable(candidate, host)) return candidate;
  }
  return null;
}

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }

  if (opts.version) {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8')
    );
    console.log(pkg.version);
    process.exit(0);
  }

  if (opts.command !== 'start') {
    console.error(`未知命令: ${opts.command}`);
    console.error('运行 `ai-task-flow --help` 查看用法');
    process.exit(2);
  }

  const preferredPort = opts.port ?? 3000;
  const userSpecifiedPort = opts.port !== undefined;
  const host = opts.host ?? '0.0.0.0';
  const frontendDist = resolveFrontendDist(opts.frontend);

  if (!frontendDist) {
    console.error('✗ 找不到前端打包产物 (backend/public/index.html)');
    console.error('  可能原因:');
    console.error('  1. 未执行 `npm run build` (开发态)');
    console.error('  2. 安装包不完整,请重装 @ai-task-flow/cli');
    console.error('  或通过 --frontend <dir> 显式指定 dist 目录');
    process.exit(1);
  }

  // 端口处理三段式:
  // 1) 端口可用 → 直接用
  // 2) 端口被占且是完整 ai-task-flow CLI 实例 → reuse,直接打开浏览器
  // 3) 端口被占但是 dev backend(api only) 或其他程序:
  //    - 用户没显式 --port → 自动找下一个空闲端口(3000→3001→...)
  //    - 用户显式 --port → 友好报错,尊重意图
  let port = preferredPort;
  let reuseExisting = false;
  let coexistWithDev = false; // 检测到 dev backend 同时在跑,提示数据竞争风险

  if (!(await isPortAvailable(preferredPort, host))) {
    const kind = await probeService(preferredPort, host);

    if (kind === 'web') {
      reuseExisting = true;
      port = preferredPort;
    } else if (userSpecifiedPort) {
      console.error('');
      console.error(`✗ 端口 ${preferredPort} 已被占用(且不是 ai-task-flow CLI 实例)`);
      console.error('');
      if (kind === 'api') {
        console.error(`  端口上跑的是 ai-task-flow 的 dev 模式 backend(纯 API)`);
        console.error(`  停掉 dev 或改用其他端口启动 CLI`);
      } else {
        console.error(`  你显式指定了 --port ${preferredPort},不会自动切换`);
        console.error(`  改用其他端口或释放该端口后重试`);
      }
      console.error('');
      process.exit(1);
    } else {
      // 自动找空闲端口
      coexistWithDev = kind === 'api';
      const free = await findAvailablePort(preferredPort + 1, host, 20);
      if (free === null) {
        console.error('');
        console.error(`✗ 端口 ${preferredPort}~${preferredPort + 19} 全部被占,放弃`);
        console.error('  请用 --port 指定其他端口,如: ai-task-flow --port 9000');
        console.error('');
        process.exit(1);
      }
      port = free;
      if (coexistWithDev) {
        console.log(`! 检测到 ai-task-flow dev backend 在 ${preferredPort},自动改用 ${port} 启动 CLI`);
      } else {
        console.log(`! 端口 ${preferredPort} 被占,自动切换到 ${port}`);
      }
    }
  }

  const url = `http://localhost:${port}`;

  // 复用已有实例:不再启动 backend,直接打开浏览器
  if (reuseExisting) {
    console.log('');
    console.log('========================================');
    console.log(`✓ ai-task-flow 已在 ${url} 运行,复用现有实例`);
    console.log(`  - Web UI:  ${url}`);
    console.log(`  - API:     ${url}/api`);
    console.log('========================================');
    if (opts.open) {
      try {
        const { default: open } = await import('open');
        await open(url);
        console.log(`✓ 已在浏览器中打开 ${url}`);
      } catch (err) {
        console.warn(`! 无法自动打开浏览器: ${err.message}`);
        console.warn(`  请手动访问 ${url}`);
      }
    } else {
      console.log(`  在浏览器中打开 ${url} 即可使用`);
    }
    console.log('');
    process.exit(0);
  }

  // 动态加载 backend(它是 ESM,且有 reflect-metadata 副作用,必须运行时加载)
  let startApp;
  try {
    ({ startApp } = await import('@ai-task-flow/backend'));
  } catch (err) {
    console.error('✗ 加载 backend 失败:', err.message);
    console.error('  开发态请先执行 `npm run build`');
    process.exit(1);
  }

  // 数据目录:--data-dir > 环境变量 > 默认 ~/.ai-task-flow(与 backend 解析逻辑一致)
  const dataDir = opts.dataDir
    ? path.resolve(opts.dataDir)
    : (process.env.AI_TASK_FLOW_DATA_DIR
      ? path.resolve(process.env.AI_TASK_FLOW_DATA_DIR)
      : path.join(os.homedir(), '.ai-task-flow'));

  console.log(`\n启动 AI Task Flow...\n`);
  console.log(`  端口:     ${port}`);
  console.log(`  数据目录: ${dataDir}`);
  console.log(`  前端:     ${frontendDist}`);
  if (coexistWithDev) {
    console.log('');
    console.log(`  ⚠ 数据竞争风险:`);
    console.log(`    检测到 dev backend 也在跑,两个进程会同时写 ${path.join(dataDir, 'tasks.json')}`);
    console.log(`    建议同时只用一个,避免数据丢失`);
  }
  console.log('');

  await startApp({ port, host, frontendDist, dataDir });

  if (opts.open) {
    try {
      const { default: open } = await import('open');
      await open(url);
      console.log(`✓ 已在浏览器中打开 ${url}\n`);
    } catch (err) {
      console.warn(`! 无法自动打开浏览器: ${err.message}`);
      console.warn(`  请手动访问 ${url}\n`);
    }
  } else {
    console.log(`提示: 在浏览器中打开 ${url}\n`);
  }

  console.log('按 Ctrl+C 停止服务\n');
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
