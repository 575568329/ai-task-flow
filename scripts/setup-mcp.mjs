#!/usr/bin/env node
// scripts/setup-mcp.mjs
// 一键把本项目 MCP server 挂载到 Claude Code,免去手动编辑配置。
// 流程:检查 build 产物 → 初始化数据文件 → 写项目级 .mcp.json → 调 `claude mcp add` 注册。
// 跑法: npm run setup:mcp
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const serverJs = resolve(root, 'backend/dist/interfaces/mcp/server.js');
const mcpJsonPath = resolve(root, '.mcp.json');
const tasksJson = resolve(homedir(), '.ai-task-flow/tasks.json');

// 项目级 .mcp.json 内容(相对路径,随 git,团队共享)
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

// 1. 检查 MCP server 构建产物
log('▶ 1/4 检查 MCP server 构建产物');
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
log('▶ 2/4 检查数据文件 ~/.ai-task-flow/tasks.json');
if (!existsSync(tasksJson)) {
  mkdirSync(dirname(tasksJson), { recursive: true });
  writeFileSync(tasksJson, '{"tasks":[],"nextId":1}');
  ok('已初始化空 tasks.json');
} else {
  ok('已存在');
}

// 3. 写项目级 .mcp.json(保证存在且内容正确)
log('▶ 3/4 写项目级 .mcp.json');
writeFileSync(mcpJsonPath, `${JSON.stringify(MCP_JSON, null, 2)}\n`);
ok('.mcp.json 已写入');

// 4. 调 claude mcp add 注册到 Claude Code(local scope,绝对路径)
//    local scope 注册的 server 已被信任,可跳过首次 .mcp.json 的信任弹窗。
log('▶ 4/4 注册到 Claude Code');
const r = spawnSync(
  'claude',
  ['mcp', 'add', 'ai-task-flow', '-s', 'local', '--', 'node', serverJs],
  { stdio: 'pipe', shell: true },
);
const out = `${r.stdout?.toString() || ''}${r.stderr?.toString() || ''}`;
if (r.status === 0 && !/already exist|conflict|exist/i.test(out)) {
  ok('已注册 (local scope)');
} else if (/already exist|conflict|exist/i.test(out)) {
  warn('ai-task-flow 已注册过,跳过');
} else {
  warn('claude CLI 不可用或注册失败。可手动执行:');
  console.log(`    claude mcp add ai-task-flow -s local -- node "${serverJs}"`);
  warn('或直接依赖项目根的 .mcp.json(重启 Claude Code 会话后自动识别)');
}

console.log('\n✅ 挂载完成。重启 Claude Code 会话后,/mcp 可见 ai-task-flow 及其 5 个工具。');
