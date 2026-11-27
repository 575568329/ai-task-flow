#!/usr/bin/env node
/**
 * uTools 发行包合规门禁(提交审核前自查的自动化子集)
 *
 * 依据 uTools 官方 selfcheck 标准:
 *  - 禁止原生二进制(.exe/.dll/.so/.dylib/.node,含 node_modules)
 *  - 禁止 .map / 测试目录 / .git 等发行残留
 *  - preload 必须明文可读,不能压缩/混淆
 *  - logo 不能是 uTools 默认占位图
 *  - 包内不能出现开发机绝对路径
 *
 * 用法: node tools/utools/check-plugin.mjs [插件目录](默认 tools/utools/build)
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const STAGE = path.resolve(process.argv[2] ?? path.join(TOOL_DIR, 'build'));

const DEFAULT_LOGO_SHA256 =
  'c4a8ac6e06310f40e2512d44f5eace46376351f769ac689519a8ff486c18fe62';
const NATIVE_EXTENSIONS = new Set(['.exe', '.dll', '.so', '.dylib', '.node']);
const RISKY_DIRS = new Set(['.git', '.github', '.vscode', '.idea', '__tests__', 'tests', 'test']);
const DEV_PATH_PATTERNS = [/D:\\Study/i, /D:\/Study/i, /C:\\Users\\fjyu9/i];

const problems = [];

function fail(message) {
  problems.push(message);
}

function walk(dir, onFile) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, onFile);
    else if (entry.isFile()) onFile(full);
  }
}

function rel(file) {
  return path.relative(STAGE, file).split(path.sep).join('/');
}

function checkRequiredFiles() {
  const pluginJsonPath = path.join(STAGE, 'plugin.json');
  if (!fs.existsSync(pluginJsonPath)) {
    fail('缺少 plugin.json');
    return null;
  }
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
  } catch (error) {
    fail(`plugin.json 不是合法 JSON: ${error.message}`);
    return null;
  }

  const main = pkg.main;
  if (typeof main !== 'string' || !main.endsWith('.html')) {
    fail('plugin.json.main 必须是包内 .html');
  } else if (!fs.existsSync(path.join(STAGE, main))) {
    fail(`plugin.json.main 指向的文件不存在: ${main}`);
  }
  if (typeof pkg.logo !== 'string' || !fs.existsSync(path.join(STAGE, pkg.logo))) {
    fail('plugin.json.logo 缺失');
  }
  if (typeof pkg.preload !== 'string' || !fs.existsSync(path.join(STAGE, pkg.preload))) {
    fail('plugin.json.preload 缺失');
  }
  if (!Array.isArray(pkg.features) || pkg.features.length === 0) {
    fail('plugin.json.features 至少需要 1 项');
  } else {
    for (const feature of pkg.features) {
      if (!feature.code) fail('feature 缺少 code');
      if (!Array.isArray(feature.cmds) || feature.cmds.length === 0) {
        fail(`feature ${feature.code ?? '?'} 缺少 cmds`);
      }
    }
  }
  // tools 由 build 从后端 ALL_TOOLS 生成;数量/结构不符说明构建链路断了
  const toolNames = pkg.tools && typeof pkg.tools === 'object' ? Object.keys(pkg.tools) : [];
  if (toolNames.length !== 14) {
    fail(`plugin.json.tools 应为 14 个工具(worklog 11 + conclusion 2 + knowledge 1),实际 ${toolNames.length}`);
  }
  for (const name of toolNames) {
    const tool = pkg.tools[name];
    if (!tool || typeof tool.description !== 'string' || typeof tool.inputSchema !== 'object') {
      fail(`tool ${name} 缺少 description/inputSchema`);
    }
  }
  return pkg;
}

function checkLogo(pkg) {
  if (!pkg?.logo) return;
  const file = path.join(STAGE, pkg.logo);
  if (!fs.existsSync(file)) return;
  const hash = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (hash === DEFAULT_LOGO_SHA256) {
    fail('logo 是 uTools 默认占位图,必须换成原创图标');
  }
}

function checkPreload(pkg) {
  if (!pkg?.preload) return;
  const file = path.join(STAGE, pkg.preload);
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const maxLine = Math.max(...lines.map((line) => line.length));
  if (lines.length < 10 || maxLine > 400) {
    fail(`preload 疑似被压缩/混淆(lines=${lines.length}, maxLine=${maxLine})`);
  }
  if (!text.includes('window.atfServices')) {
    fail('preload 未暴露启动页需要的 window.atfServices');
  }
  for (const pattern of [/window\.fs\b/, /window\.child_process\b/, /window\.exec\b/, /window\.require\b/]) {
    if (pattern.test(text)) fail(`preload 直接向 window 暴露高危能力: ${pattern}`);
  }
  // child_process 仅用于拉起自带的 backend 子进程;只要不向 window 暴露就符合审核口径
}

function checkExternalScripts() {
  if (!fs.existsSync(STAGE)) return;
  walk(STAGE, (file) => {
    if (!file.endsWith('.html')) return;
    const text = fs.readFileSync(file, 'utf8');
    if (/<script[^>]+src=["']https?:\/\//i.test(text)) {
      fail(`HTML 引用了外部脚本(运行时加载远程代码): ${rel(file)}`);
    }
  });
}

function checkFiles() {
  if (!fs.existsSync(STAGE)) {
    fail(`插件目录不存在: ${STAGE}`);
    return;
  }
  walk(STAGE, (file) => {
    const relative = rel(file);
    const ext = path.extname(file).toLowerCase();
    if (NATIVE_EXTENSIONS.has(ext)) fail(`原生二进制: ${relative}`);
    if (ext === '.map') fail(`source map 残留: ${relative}`);
    if (relative.includes('node_modules/')) return;
    if (ext === '.ts' || ext === '.tsbuildinfo') fail(`源码/构建残留: ${relative}`);
    for (const part of relative.split('/')) {
      if (RISKY_DIRS.has(part)) fail(`发行包残留目录: ${relative}`);
    }
  });
}

function checkDevPaths() {
  const targets = [
    path.join(STAGE, 'plugin.json'),
    path.join(STAGE, 'preload.js'),
    path.join(STAGE, 'index.html'),
  ];
  const distDir = path.join(STAGE, 'backend', 'dist');
  if (fs.existsSync(distDir)) {
    walk(distDir, (file) => {
      if (file.endsWith('.js')) targets.push(file);
    });
  }
  for (const file of targets) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of DEV_PATH_PATTERNS) {
      if (pattern.test(text)) fail(`开发机绝对路径: ${rel(file)} (${pattern})`);
    }
  }
}

function checkRuntimeFiles() {
  const entry = path.join(STAGE, 'backend', 'dist', 'http-server.js');
  if (!fs.existsSync(entry)) fail('缺少 backend/dist/http-server.js');
  const nodeModules = path.join(STAGE, 'backend', 'node_modules');
  if (!fs.existsSync(nodeModules)) fail('缺少 backend/node_modules(生产依赖未安装)');
  if (!fs.existsSync(path.join(nodeModules, '@ai-task-flow', 'shared', 'dist', 'index.js'))) {
    fail('缺少 @ai-task-flow/shared/dist');
  }
  if (!fs.existsSync(path.join(STAGE, 'web', 'index.html'))) fail('缺少 web/index.html 前端产物');
}

function main() {
  const pkg = checkRequiredFiles();
  checkLogo(pkg);
  checkPreload(pkg);
  checkFiles();
  checkExternalScripts();
  checkDevPaths();
  checkRuntimeFiles();

  if (problems.length > 0) {
    console.error(`❌ uTools 发行包自查未通过(${problems.length} 项):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  const size = fs.existsSync(STAGE)
    ? fs.readdirSync(STAGE).length
    : 0;
  console.log(`✅ uTools 发行包自查通过: ${STAGE} (${size} 个顶层条目)`);
}

main();
