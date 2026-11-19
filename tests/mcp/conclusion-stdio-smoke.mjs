#!/usr/bin/env node
// 结论卡 MCP stdio 端到端冒烟。
//
// 为什么需要:单元测试直接调 handle(),不能证明工具真的注册进了 tools/list、
// Server.getClientVersion() 能取到 clientInfo、来源字段能贯穿到持久化文件。
// 本脚本用真实子进程跑完整协议链路:
//   initialize → notifications/initialized → tools/list → tools/call(record_conclusion)
//   → tools/call(query_conclusions)
//
// 隔离:全部数据写入临时目录(AI_TASK_FLOW_DATA_DIR),不碰 ~/.ai-task-flow。
// 前置:cd shared && npm run build && cd backend && npm run build
// 用法:node tests/mcp/conclusion-stdio-smoke.mjs
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_PATH = fileURLToPath(new URL('../../backend/dist/interfaces/mcp/server.js', import.meta.url));
const REQUEST_TIMEOUT_MS = 20_000;
const EXPECTED_TOOL_COUNT = 12;
const PROJECT = 'mcp-stdio-proj';
const DECISION = '决策：stdio 链路可通过 MCP 写入并读回。';

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败：${message}`);
}

function log(message) {
  console.log(`[mcp-smoke] ${message}`);
}

/** 极简 JSON-RPC over stdio 客户端:换行分隔,按 id 关联响应。 */
class StdioRpcClient {
  constructor(child) {
    this.child = child;
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.onData(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      this.stderr += chunk;
    });
    child.on('exit', (code, signal) => {
      const reason = `MCP 子进程提前退出(code=${code}, signal=${signal})\n${this.stderr}`;
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error(reason));
      }
      this.pending.clear();
    });
  }

  onData(chunk) {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.onLine(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  onLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      // 非 JSON 行(理论上不该出现)忽略
      return;
    }
    if (message.id === undefined) return; // notification
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) {
      entry.reject(new Error(`JSON-RPC error(${message.error.code}): ${message.error.message}`));
      return;
    }
    entry.resolve(message.result);
  }

  write(payload) {
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  request(method, params) {
    const id = this.nextId++;
    const payload = { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`请求超时（${method}, ${REQUEST_TIMEOUT_MS}ms）`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.write(payload);
    });
  }

  notify(method, params) {
    this.write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
  }
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}

let child;
let tempDir;

try {
  // 1. 临时数据目录 + 干净环境(去掉会抢占来源解析的 AI_AGENT / 会话变量)
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'atf-mcp-smoke-'));
  const env = { ...process.env, AI_TASK_FLOW_DATA_DIR: tempDir };
  delete env.AI_AGENT;
  delete env.CLAUDE_CODE_SESSION_ID;

  // 2. 启动已构建的 stdio server
  child = spawn(process.execPath, [SERVER_PATH], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const client = new StdioRpcClient(child);
  log(`spawned ${SERVER_PATH}`);

  // 3. 握手
  const init = await client.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '1.0' },
  });
  assert(init?.serverInfo?.name === 'ai-task-flow', `serverInfo.name 应为 ai-task-flow，实际 ${init?.serverInfo?.name}`);
  client.notify('notifications/initialized');
  log(`initialized (protocol ${init.protocolVersion})`);

  // 4. tools/list:12 个工具 + 两个结论工具 + 互相点名
  const { tools } = await client.request('tools/list', {});
  assert(Array.isArray(tools), 'tools/list 应返回 tools 数组');
  assert(tools.length === EXPECTED_TOOL_COUNT, `工具数应为 ${EXPECTED_TOOL_COUNT}，实际 ${tools.length}`);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  for (const name of ['record_conclusion', 'query_conclusions']) {
    assert(byName.has(name), `tools/list 缺少 ${name}`);
  }
  assert(
    byName.get('record_work').description.includes('record_conclusion'),
    'record_work 描述应点名 record_conclusion',
  );
  assert(
    byName.get('record_conclusion').description.includes('record_work'),
    'record_conclusion 描述应点名 record_work',
  );
  assert(
    byName.get('record_conclusion').description.includes('默认新建'),
    'record_conclusion 描述应默认新建',
  );
  assert(
    byName.get('record_conclusion').description.includes('不要先用 keyword'),
    'record_conclusion 描述应禁止写前 keyword 预搜索',
  );
  assert(
    byName.get('query_conclusions').description.includes('已知 cardId'),
    'query_conclusions 描述应优先使用 cardId',
  );
  assert(
    byName.get('query_conclusions').description.includes('禁止在已知 cardId 时再用 keyword'),
    'query_conclusions 描述应禁止已知 ID 时 keyword 搜索',
  );
  log(`tools/list OK: ${tools.length} tools`);

  // 5. record_conclusion(新建)
  const created = await client.request('tools/call', {
    name: 'record_conclusion',
    arguments: {
      project: PROJECT,
      title: 'stdio 冒烟结论',
      decision: DECISION,
      changeNote: 'stdio 冒烟',
    },
  });
  assert(!created.isError, `record_conclusion 返回错误：${created.content?.[0]?.text}`);
  const createdText = created.content?.[0]?.text ?? '';
  const idMatch = createdText.match(/已创建结论卡\s+(c_[A-Za-z0-9_-]+)/);
  assert(idMatch, `创建结果应包含 c_ 开头的 cardId，实际：${createdText}`);
  const cardId = idMatch[1];
  log(`record_conclusion OK: ${cardId}`);

  // 6. query_conclusions(按 cardId 读回)
  const queried = await client.request('tools/call', {
    name: 'query_conclusions',
    arguments: { cardId },
  });
  assert(!queried.isError, `query_conclusions 返回错误：${queried.content?.[0]?.text}`);
  const queryText = queried.content?.[0]?.text ?? '';
  assert(queryText.includes(DECISION), '查询结果应包含 decision 原文');
  // 来源 tool 必须是 initialize 里的 clientInfo.name(smoke),证明确实贯穿到了持久化与展示
  assert(/(^|\s|·)\s*smoke(\s|$)/m.test(queryText), `查询结果应包含来源工具 smoke，实际：\n${queryText}`);
  assert(queryText.includes('stdio 冒烟结论'), '查询结果应包含卡片标题');
  log('query_conclusions OK: decision + source tool smoke');

  // 7. 落盘位置:必须在临时目录,证明没写 ~/.ai-task-flow
  const data = JSON.parse(await readFile(path.join(tempDir, 'conclusions.json'), 'utf8'));
  const stored = data.conclusions.find((card) => card.id === cardId);
  assert(stored, '临时目录 conclusions.json 中应存在新建的结论卡');
  const latest = stored.revisions[stored.revisions.length - 1];
  assert(latest.source.tool === 'smoke', `持久化来源 tool 应为 smoke，实际 ${latest.source.tool}`);
  log(`persisted in temp dir: ${path.join(tempDir, 'conclusions.json')}`);

  log('PASS');
} catch (error) {
  console.error(`[mcp-smoke] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await stopChild(child);
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true }).catch((error) => {
      console.error(`[mcp-smoke] 清理临时目录失败：${error instanceof Error ? error.message : String(error)}`);
    });
  }
}
