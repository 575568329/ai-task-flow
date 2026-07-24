#!/usr/bin/env node
// scripts/setup-mcp.mjs
// 一键把本项目 MCP server 挂载到 Claude Code,免去手动编辑配置。
// 流程:检查 build 产物 → 初始化数据文件 → 写项目级 .mcp.json
//       → 注册 Windows 侧 Claude Code → 检测并注册 WSL 侧。
// 跑法: npm run setup:mcp
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const serverJs = resolve(root, 'backend/dist/interfaces/mcp/server.js');
const mcpJsonPath = resolve(root, '.mcp.json');
const tasksJson = resolve(homedir(), '.ai-task-flow/tasks.json');

// 项目级 .mcp.json 内容(相对路径,随 git,团队共享;Windows/WSL 两侧均按相对路径解析)
const MCP_JSON = {
  mcpServers: {
    'ai-task-flow': {
      command: 'node',
      args: ['backend/dist/interfaces/mcp/server.js'],
    },
  },
};

const log = (m) => console.log(m);
const ok = (m) => console.log(`  ✓ ${m}`);
const warn = (m) => console.warn(`  ! ${m}`);

/** 归类 `claude mcp add` 的结果:成功 / 已存在 / 失败 */
function classifyAdd(stdout, stderr, status) {
  const out = `${stdout || ''}${stderr || ''}`;
  if (status === 0 && !/already exist|conflict|exist/i.test(out)) return { kind: 'ok', out };
  if (/already exist|conflict|exist/i.test(out)) return { kind: 'exists', out };
  return { kind: 'fail', out };
}

/**
 * 在 WSL 里注册 ai-task-flow 到 Claude Code local scope(WSL 侧免首次信任弹窗)。
 * 设计原则:WSL 可能未启用 / 未装发行版 / 未装 claude,任一不满足都优雅跳过,不报错。
 * server.js 的 Windows 路径通过 wslpath 转成 /mnt/... 路径供 WSL node 使用。
 *
 * 注:.mcp.json 用相对路径,WSL 侧即便不注册也能在打开项目时自动挂载,
 *     本步仅优化首次体验(已注册 local scope 可跳过信任弹窗)。
 */
function registerWslIfAvailable(serverJsWin) {
  if (platform() !== 'win32') {
    warn('非 Windows 平台,跳过 WSL 检测');
    return;
  }
  // 仅判断有无 WSL:不解析 `wsl -l` 的 UTF-16LE 输出(只看退出码即可)
  const probe = spawnSync('wsl.exe', ['-l', '-q'], { stdio: 'pipe' });
  if (probe.status !== 0) {
    warn('未检测到 WSL,跳过 WSL 侧注册(Windows 侧已注册)');
    return;
  }
  // WSL 里有没有 claude?
  const cc = spawnSync('wsl.exe', ['bash', '-lc', 'command -v claude'], {
    stdio: 'pipe',
    encoding: 'utf8',
  });
  if (cc.status !== 0 || !cc.stdout?.trim()) {
    warn('WSL 中未找到 claude,跳过(WSL 侧可依赖 .mcp.json 自动挂载)');
    return;
  }
  // Windows 路径 → WSL 路径(单引号包裹,反斜杠在 bash 单引号内为字面量)
  const conv = spawnSync(
    'wsl.exe',
    ['bash', '-lc', `wslpath -u '${serverJsWin}'`],
    { stdio: 'pipe', encoding: 'utf8' },
  );
  const wslServerJs = (conv.stdout || '').trim();
  if (conv.status !== 0 || !wslServerJs) {
    warn('WSL 路径转换失败,跳过;WSL 侧可依赖 .mcp.json 自动挂载');
    return;
  }
  const r = spawnSync(
    'wsl.exe',
    ['bash', '-lc', `claude mcp add ai-task-flow -s local -- node "${wslServerJs}"`],
    { stdio: 'pipe', encoding: 'utf8' },
  );
  const res = classifyAdd(r.stdout, r.stderr, r.status);
  if (res.kind === 'ok') ok(`已注册 WSL 侧 (local scope):${wslServerJs}`);
  else if (res.kind === 'exists') warn('WSL 侧已注册过,跳过');
  else {
    warn('WSL 侧注册失败,可手动执行:');
    console.log(`    wsl bash -lc "claude mcp add ai-task-flow -s local -- node '${wslServerJs}'"`);
    warn('或直接依赖项目根 .mcp.json(WSL 打开 Claude Code 时自动识别,首次需信任)');
  }
}

// 1. 检查 MCP server 构建产物
log('▶ 1/5 检查 MCP server 构建产物');
if (!existsSync(serverJs)) {
  console.log('  server.js 不存在,执行 build:shared + build:backend ...');
  const shared = spawnSync('npm', ['run', 'build:shared'], { cwd: root, stdio: 'inherit', shell: true });
  if (shared.status !== 0) {
    console.error('✗ build:shared 失败,请先 npm install 后重试');
    process.exit(1);
  }
  const backendBuild = spawnSync('npm', ['run', 'build:backend'], { cwd: root, stdio: 'inherit', shell: true });
  if (backendBuild.status !== 0) {
    console.error('✗ build:backend 失败,请查看上方报错');
    process.exit(1);
  }
}
// build 后再确认一次,避免万一产物仍缺失却被误判为就绪
if (!existsSync(serverJs)) {
  console.error('✗ build 后仍未找到 server.js,请手动 npm run build 排查');
  process.exit(1);
}
ok('backend/dist/interfaces/mcp/server.js 就绪');

// 2. 数据文件
log('▶ 2/5 检查数据文件 ~/.ai-task-flow/tasks.json');
if (!existsSync(tasksJson)) {
  mkdirSync(dirname(tasksJson), { recursive: true });
  writeFileSync(tasksJson, '{"tasks":[],"nextId":1}');
  ok('已初始化空 tasks.json');
} else {
  ok('已存在');
}

// 3. 写项目级 .mcp.json(保证存在且内容正确;相对路径 Windows/WSL 通用)
log('▶ 3/5 写项目级 .mcp.json');
writeFileSync(mcpJsonPath, `${JSON.stringify(MCP_JSON, null, 2)}\n`);
ok('.mcp.json 已写入(相对路径,Windows/WSL 均按项目根解析)');

// 4. 注册 Windows 侧 Claude Code(local scope,绝对路径;已信任可跳过 .mcp.json 首次弹窗)
log('▶ 4/5 注册到 Claude Code(Windows 侧)');
const r = spawnSync(
  'claude',
  ['mcp', 'add', 'ai-task-flow', '-s', 'local', '--', 'node', serverJs],
  { stdio: 'pipe', shell: true },
);
{
  const res = classifyAdd(r.stdout?.toString(), r.stderr?.toString(), r.status);
  if (res.kind === 'ok') ok('已注册 (local scope)');
  else if (res.kind === 'exists') warn('Windows 侧已注册过,跳过');
  else {
    warn('claude CLI 不可用或注册失败。可手动执行:');
    console.log(`    claude mcp add ai-task-flow -s local -- node "${serverJs}"`);
    warn('或直接依赖项目根的 .mcp.json(重启 Claude Code 会话后自动识别)');
  }
}

// 5. 检测 WSL:WSL 里有 claude 时,额外注册 WSL 侧 local scope(免信任弹窗)
log('▶ 5/5 检测 WSL 环境(若存在并装有 claude)');
registerWslIfAvailable(serverJs);

console.log('\n✅ 挂载完成。重启 Claude Code 会话后,/mcp 可见 ai-task-flow 及其 5 个工具。');
