#!/usr/bin/env node
// scripts/mcp-dist-meta.mjs
// MCP 产物一致性守卫:防止「改了 MCP 代码但忘记 npm run build」——
// 全局注册的 ZCode/Claude Code 都指向 backend/dist/interfaces/mcp/server.js,
// 产物过期时客户端会继续跑旧工具,且没有任何报错。
//
// 用法:
//   node scripts/mcp-dist-meta.mjs --write   构建后写入元数据(backend build 自动调用)
//   node scripts/mcp-dist-meta.mjs           校验产物是否与当前源码一致(退出码 1 = 过期)
//
// 判定依据不是 git commit(文档提交也会变),而是产物实际依赖的源码内容哈希:
// backend/src + shared/src(排除测试)+ 两侧 tsconfig。编译选项或业务代码一变,哈希即变。
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIRS = ['backend/src', 'shared/src'];
const EXTRA_FILES = ['backend/tsconfig.json', 'shared/tsconfig.json'];
const META_FILE = path.join(ROOT, 'backend/dist/.mcp-build-meta.json');
const IGNORED_DIRS = new Set(['__tests__', 'node_modules', 'dist']);
const IGNORED_FILE = /\.(test|spec)\.ts$/;

/** 递归收集 .ts 源码(相对仓库根、统一 / 分隔),排除测试与构建产物 */
async function collectSources(relDir) {
  const absoluteDir = path.join(ROOT, relDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relPath = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      files.push(...(await collectSources(relPath)));
      continue;
    }
    if (!entry.name.endsWith('.ts') || IGNORED_FILE.test(entry.name)) continue;
    files.push(relPath);
  }
  return files;
}

/** 源码内容哈希 + 逐文件哈希(逐文件用于输出「哪几个文件改了」) */
async function hashSources() {
  const files = (
    await Promise.all(SOURCE_DIRS.map((dir) => collectSources(dir)))
  )
    .flat()
    .concat(EXTRA_FILES)
    .sort();

  const fileHashes = {};
  const manifestLines = [];
  for (const relPath of files) {
    const content = await readFile(path.join(ROOT, relPath));
    const fileHash = createHash('sha256').update(content).digest('hex');
    fileHashes[relPath] = fileHash;
    manifestLines.push(`${relPath}:${fileHash}`);
  }

  const sourceHash = createHash('sha256').update(manifestLines.join('\n')).digest('hex');
  return { sourceHash, files: fileHashes };
}

function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

async function writeMeta() {
  const { sourceHash, files } = await hashSources();
  const meta = {
    sourceHash,
    fileCount: Object.keys(files).length,
    files,
    gitCommit: gitHead(),
    builtAt: new Date().toISOString(),
  };
  await mkdir(path.dirname(META_FILE), { recursive: true });
  await writeFile(META_FILE, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  console.log(
    `[mcp-dist] 已记录构建元数据 ${sourceHash.slice(0, 12)} ` +
      `(${meta.fileCount} 个源文件, commit ${meta.gitCommit})`,
  );
}

async function checkMeta() {
  let meta;
  try {
    meta = JSON.parse(await readFile(META_FILE, 'utf8'));
  } catch {
    console.error(
      '[mcp-dist] ❌ 找不到构建元数据 backend/dist/.mcp-build-meta.json\n' +
        '          说明 dist 未按当前方式构建过:cd backend && npm run build',
    );
    process.exit(1);
  }

  const { sourceHash, files } = await hashSources();
  if (meta.sourceHash === sourceHash) {
    console.log(
      `[mcp-dist] ✅ MCP 产物与源码一致 ${sourceHash.slice(0, 12)} ` +
        `(commit ${meta.gitCommit}, builtAt ${meta.builtAt})`,
    );
    return;
  }

  const previous = meta.files ?? {};
  const changed = Object.keys(files).filter((f) => previous[f] !== files[f]);
  const removed = Object.keys(previous).filter((f) => !(f in files));
  const details = [...changed.map((f) => `  M ${f}`), ...removed.map((f) => `  D ${f}`)].slice(0, 20);
  console.error(
    '[mcp-dist] ❌ MCP 产物已过期:全局客户端仍在运行旧版工具\n' +
      `          产物构建于 commit ${meta.gitCommit} (${meta.builtAt})\n` +
      `          源码 ${changed.length} 改 / ${removed.length} 删,当前 HEAD ${gitHead()}\n` +
      `${details.join('\n')}\n` +
      '          修复:cd backend && npm run build(会同时刷新构建元数据)',
  );
  process.exit(1);
}

if (process.argv.includes('--write')) {
  await writeMeta();
} else {
  await checkMeta();
}
