#!/usr/bin/env node
/**
 * 构建 uTools 插件包(.upx)
 *
 * 关键约束(uTools 官方审核):
 *  - 包里不能出现 .exe/.dll/.so/.dylib/.node 等原生二进制;
 *  - preload 及其依赖必须明文可读,npm 依赖整目录随包;
 *  - 发行包不能带 .map / 测试 / 开发机路径。
 *
 * 所以这里不复制根 node_modules,而是在 stage/backend 里安装「生产依赖」,
 * 只拷贝 backend/dist 的 .js(preload 用 import() 加载),前端产物放 web/。
 *
 * 用法: node tools/utools/build.mjs [--skip-build]
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOL_DIR = path.join(ROOT, 'tools', 'utools');
const STAGE = path.join(TOOL_DIR, 'build');
const STAGE_BACKEND = path.join(STAGE, 'backend');
/** 版本唯一来源 = 根 package.json;插件清单、包名、页面版本号都从这里取 */
const PLUGIN_VERSION = readJson(path.join(ROOT, 'package.json')).version;
/** 每次构建都不同:插件用它判断端口上跑的是不是同一份产物(preload 与 /health 握手) */
const BUILD_ID = `${PLUGIN_VERSION}-${formatStamp(new Date())}`;
// 用 ASCII 文件名:部分环境里中文名的 .upx 拖入 uTools 会被当成普通文件/路径文本
const UPX = path.join(TOOL_DIR, `ai-worklog-${PLUGIN_VERSION}.upx`);

/** 构建时间戳 YYYYMMDD-HHmmss */
function formatStamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** backend 生产依赖里不随插件走的包:shared 手动放,MCP SDK 只服务 stdio 版 */
const EXCLUDED_DEPS = new Set(['@ai-task-flow/shared', '@modelcontextprotocol/sdk']);

/** dist 只保留运行所需的 .js;MCP 目录仅 stdio 版需要,不随 UI 插件发行 */
function keepBackendFile(source) {
  const rel = path.relative(path.join(ROOT, 'backend', 'dist'), source).split(path.sep).join('/');
  if (!rel) return true;
  if (rel.includes('/__tests__')) return false;
  // HTTP 桥接端点会 import tools/index;只排除 mcp 根目录文件(server.js 依赖 MCP SDK),
  // 保留 tools/ 下纯 handler(不依赖 SDK)。目录本身必须放行才能递归进去。
  if (rel.includes('interfaces/mcp')) {
    const isMcpRootDir = rel === 'interfaces/mcp';
    const isTools = rel.startsWith('interfaces/mcp/tools');
    if (!isMcpRootDir && !isTools) return false;
  }
  if (rel.endsWith('.map') || rel.endsWith('.d.ts') || rel.endsWith('.tsbuildinfo')) return false;
  return true;
}

function keepSharedFile(source) {
  const rel = path.relative(path.join(ROOT, 'shared', 'dist'), source).split(path.sep).join('/');
  if (!rel) return true;
  return !rel.endsWith('.map') && !rel.endsWith('.d.ts');
}

/** 增量模式:删掉源码里已不存在的旧产物(构建目录被运行中的插件占用时用) */
function pruneStaleDist(srcDir, dstDir) {
  let entries;
  try {
    entries = fs.readdirSync(dstDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const dst = path.join(dstDir, entry.name);
    const src = path.join(srcDir, entry.name);
    if (entry.isDirectory()) {
      if (!fs.existsSync(src)) {
        try {
          fs.rmSync(dst, { recursive: true, force: true });
        } catch {
          // 正在被运行中的进程引用,跳过即可
        }
      } else {
        pruneStaleDist(src, dst);
      }
      continue;
    }
    if (!fs.existsSync(src)) {
      try {
        fs.rmSync(dst, { force: true });
      } catch {
        // 同上
      }
    }
  }
}

function run(label, command, cwd = ROOT) {
  console.log(`\n=== ${label} ===`);
  execSync(command, { cwd, stdio: 'inherit' });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function copyPluginShell() {
  for (const file of ['logo.png', 'preload.js', 'preload-tools.js', 'preload-sync.js', 'index.html']) {
    fs.copyFileSync(path.join(TOOL_DIR, file), path.join(STAGE, file));
  }
  // 构建标识:preload 读它跟 /health 的 buildId 比对,决定复用还是替换旧实例
  fs.writeFileSync(path.join(STAGE, 'build-id.txt'), `${BUILD_ID}\n`, 'utf8');
}

/** plugin.json 的 tools 声明从后端 toolDef 生成,避免手写 schema 与 MCP 版本漂移。
 *  暴露全部 14 个工具(worklog 11 + 结论卡 2 + 知识库 1),执行走 /api/tools/:name。 */
async function writePluginJson() {
  const pkg = readJson(path.join(TOOL_DIR, 'plugin.json'));
  // 版本号以根 package.json 为准,避免清单/关于页/包名三处各写一份
  pkg.version = PLUGIN_VERSION;
  const { ALL_TOOLS } = await import(
    pathToFileURL(path.join(ROOT, 'backend', 'dist', 'interfaces', 'mcp', 'tools', 'index.js')).href
  );
  pkg.tools = Object.fromEntries(
    ALL_TOOLS.map((tool) => [tool.name, {
      // uTools 的 tools 描述会进入插件清单;std io 版的长模板/规则不往清单里灌,
      // 保持一句话可读,避免清单过大或开发者工具校验失败
      description: String(tool.description).split('\n')[0].slice(0, 300),
      inputSchema: tool.inputSchema,
    }]),
  );
  writeJson(path.join(STAGE, 'plugin.json'), pkg);
}

function installProductionDeps() {
  const backendPkg = readJson(path.join(ROOT, 'backend', 'package.json'));
  const dependencies = {};
  for (const [name, version] of Object.entries(backendPkg.dependencies ?? {})) {
    if (!EXCLUDED_DEPS.has(name)) dependencies[name] = version;
  }
  writeJson(path.join(STAGE_BACKEND, 'package.json'), {
    name: '@ai-task-flow/utools-backend',
    private: true,
    type: 'module',
    dependencies,
  });

  run(
    '安装生产依赖(不跑 install 脚本)',
    'npm install --omit=dev --ignore-scripts --no-audit --no-fund --prefer-offline',
    STAGE_BACKEND,
  );

  // npm 可能生成锁文件;发行包不需要
  for (const file of ['package-lock.json', path.join('node_modules', '.package-lock.json')]) {
    fs.rmSync(path.join(STAGE_BACKEND, file), { force: true });
  }

  // 第三方包自带的 source map / demo / 测试目录:既属发行残留,也可能含外部脚本,
  // 统一从 node_modules 清掉(只删这些非运行目录,不动 .js 与 license)
  prunePackageJunk(path.join(STAGE_BACKEND, 'node_modules'));
}

const PACKAGE_JUNK_DIRS = new Set([
  'demo', 'demos', 'test', 'tests', '__tests__', 'docs', 'examples', 'benchmark', 'benchmarks', 'coverage',
]);

function prunePackageJunk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (PACKAGE_JUNK_DIRS.has(entry.name)) {
        fs.rmSync(full, { recursive: true, force: true });
        continue;
      }
      prunePackageJunk(full);
    } else if (entry.isFile() && entry.name.endsWith('.map')) {
      fs.rmSync(full, { force: true });
    }
  }
}

function copySharedIntoBackend() {
  const target = path.join(STAGE_BACKEND, 'node_modules', '@ai-task-flow', 'shared');
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(path.join(ROOT, 'shared', 'dist'), path.join(target, 'dist'), {
    recursive: true,
    filter: keepSharedFile,
  });
  writeJson(path.join(target, 'package.json'), {
    name: '@ai-task-flow/shared',
    version: readJson(path.join(ROOT, 'shared', 'package.json')).version ?? '0.2.0',
    private: true,
    type: 'module',
    main: './dist/index.js',
    types: './dist/index.d.ts',
  });
}

function packageUpx() {
  fs.rmSync(UPX, { force: true });
  const tar = 'C:\\Windows\\System32\\tar.exe';
  if (process.platform === 'win32' && fs.existsSync(tar)) {
    execSync(
      `"${tar}" --format zip -c -f "${UPX}" plugin.json logo.png preload.js index.html build-id.txt web backend`,
      { cwd: STAGE, stdio: 'inherit' },
    );
    return;
  }
  // 非 Windows 开发机:要求系统有 zip
    execSync(`zip -qr "${UPX}" plugin.json logo.png preload.js index.html build-id.txt web backend`, {
    cwd: STAGE,
    stdio: 'inherit',
  });
}

async function main() {
  if (!process.argv.includes('--skip-build')) {
    run('构建 shared', 'npm run build:shared');
    run('构建 backend', 'npm run build:backend');
    run('构建 frontend', 'npm run build:frontend');
  }

  console.log('\n=== 准备插件目录 ===');
  // --incremental:插件正在 uTools 里运行,Windows 会锁住 build/backend 目录(EBUSY)。
  // 此时保留目录、按文件覆盖,并清掉源码里已经不存在的旧产物。
  const incremental = process.argv.includes('--incremental');
  if (incremental && fs.existsSync(STAGE_BACKEND)) {
    console.log('   --incremental:保留运行中的 backend 目录,按文件增量覆盖');
  } else {
    fs.rmSync(STAGE, { recursive: true, force: true });
  }
  fs.mkdirSync(STAGE, { recursive: true });
  fs.mkdirSync(STAGE_BACKEND, { recursive: true });
  copyPluginShell();
  await writePluginJson();

  // web 产物带内容哈希,必须先清空,否则旧 chunk 会一直堆在包里
  fs.rmSync(path.join(STAGE, 'web'), { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'backend', 'public'), path.join(STAGE, 'web'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'backend', 'dist'), path.join(STAGE_BACKEND, 'dist'), {
    recursive: true,
    filter: keepBackendFile,
    force: true,
  });
  if (incremental) pruneStaleDist(path.join(ROOT, 'backend', 'dist'), path.join(STAGE_BACKEND, 'dist'));
  fs.copyFileSync(path.join(TOOL_DIR, 'plugin-entry.mjs'), path.join(STAGE_BACKEND, 'plugin-entry.mjs'));;

  installProductionDeps();
  copySharedIntoBackend();

  console.log('\n=== 打包 .upx ===');
  packageUpx();
  const size = fs.statSync(UPX).size / (1024 * 1024);
  console.log(`\n✅ 完成: ${UPX} (${size.toFixed(2)} MB)`);
  console.log('   安装:把 .upx 拖入 uTools 主输入框(开发者模式可先移除旧插件再拖)。');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
