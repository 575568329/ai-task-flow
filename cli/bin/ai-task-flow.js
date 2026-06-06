#!/usr/bin/env node
// cli/bin/ai-task-flow.js
// @ai-task-flow/cli 入口
// 启动后端单端口托管前端,并自动打开浏览器
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const HELP = `
ai-task-flow — 个人 AI 任务编排看板 + MCP Server

用法:
  ai-task-flow [start] [选项]

命令:
  start                启动 Web 服务(默认)

选项:
  -p, --port <port>    HTTP 端口 (默认 3000)
      --host <host>    监听地址 (默认 0.0.0.0)
      --no-open        不自动打开浏览器
      --frontend <dir> 自定义前端 dist 目录(开发者用)
  -v, --version        显示版本
  -h, --help           显示帮助

示例:
  ai-task-flow                  # 在 :3000 启动并自动打开
  ai-task-flow start -p 8080    # 用 8080 端口
  ai-task-flow --no-open        # 不自动打开浏览器

数据存储位置: ~/.ai-task-flow/
`;

function parseArgs(argv) {
  const opts = {
    command: 'start',
    port: undefined,
    host: undefined,
    open: true,
    frontend: undefined,
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

  const port = opts.port ?? 3000;
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

  // 动态加载 backend(它是 ESM,且有 reflect-metadata 副作用,必须运行时加载)
  let startApp;
  try {
    ({ startApp } = await import('@ai-task-flow/backend/dist/http-server.js'));
  } catch (err) {
    console.error('✗ 加载 backend 失败:', err.message);
    console.error('  开发态请先执行 `npm run build`');
    process.exit(1);
  }

  console.log(`\n启动 AI Task Flow...\n`);
  console.log(`  端口:     ${port}`);
  console.log(`  数据目录: ${path.join(process.env.HOME || process.env.USERPROFILE || '~', '.ai-task-flow')}`);
  console.log(`  前端:     ${frontendDist}`);
  console.log('');

  await startApp({ port, host, frontendDist });

  const url = `http://localhost:${port}`;

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
