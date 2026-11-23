// backend/src/application/knowledge/KnowledgeImportService.ts
// 知识库一次性合并导入:把仓库内孤儿知识库(默认 <repo>/knowledge-base)递归复制到
// 用户数据目录(knowledgeDirPath())。同名不覆盖,新文件改名为 <name>-imported<ext>,
// 源目录保留作为回滚源。跳过隐藏文件与 .git / node_modules 等无关目录。
import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 冲突文件改名后缀 */
const IMPORTED_SUFFIX = '-imported';
/** 无关目录名黑名单(隐藏目录已由 '.' 前缀统一跳过) */
const SKIP_DIR_NAMES = new Set(['node_modules']);

/** 单条冲突:源相对路径 → 目标落盘相对路径(均为 posix 风格) */
export interface ImportConflict {
  from: string;
  to: string;
}

/** 单条失败:出错文件相对路径 + 错误信息(不中断整体导入) */
export interface ImportError {
  path: string;
  message: string;
}

export interface ImportReport {
  copied: number;
  conflicts: ImportConflict[];
  errors: ImportError[];
}

export interface ImportOptions {
  /** 源目录;缺省为仓库内 knowledge-base */
  sourceDir?: string;
  /** 目标目录(通常是 knowledgeDirPath()) */
  targetDir: string;
}

/**
 * 默认源目录:仓库根下的 knowledge-base。
 * backend/src/application/knowledge 与 backend/dist/application/knowledge 层级一致,
 * 上溯 4 层都落在仓库根,避免写死绝对路径。
 */
export function defaultImportSourceDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', '..', '..', 'knowledge-base');
}

/** 目录项是否应跳过:隐藏文件/目录(.git、.obsidian 等)+ 明确黑名单 */
function shouldSkip(name: string): boolean {
  return name.startsWith('.') || SKIP_DIR_NAMES.has(name);
}

/** 统一成 posix 风格,便于前端展示与跨平台断言 */
function toPosix(rel: string): string {
  return rel.split(path.sep).join('/');
}

/**
 * 计算目标落盘路径:不存在则原路径;已存在则依次尝试 <name>-imported<ext>、
 * <name>-imported-1<ext> … 直到找到空位,保证绝不覆盖已有文件。
 */
async function resolveTargetPath(targetAbs: string): Promise<string> {
  if (!(await exists(targetAbs))) return targetAbs;

  const dir = path.dirname(targetAbs);
  const ext = path.extname(targetAbs);
  const base = path.basename(targetAbs, ext);

  for (let index = 0; ; index += 1) {
    const suffix = index === 0 ? IMPORTED_SUFFIX : `${IMPORTED_SUFFIX}-${index}`;
    const candidate = path.join(dir, `${base}${suffix}${ext}`);
    if (!(await exists(candidate))) return candidate;
  }
}

async function exists(abs: string): Promise<boolean> {
  try {
    await fs.stat(abs);
    return true;
  } catch {
    return false;
  }
}

/**
 * 宽松 realpath:路径尚不存在时沿父目录上溯解析,保证未创建的目标目录
 * 也能与源目录按真实路径比较(防符号链接 / 大小写差异导致自我导入)。
 */
async function realpathLoose(abs: string): Promise<string> {
  try {
    return await fs.realpath(abs);
  } catch {
    const parent = path.dirname(abs);
    if (parent === abs) return abs;
    return path.join(await realpathLoose(parent), path.basename(abs));
  }
}

/** 路径比较归一化:Windows 文件系统大小写不敏感 */
function normalizeForCompare(abs: string): string {
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

/** child 是否严格位于 parent 之内(等于 parent 不算) */
function isStrictlyInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 递归复制目录内容,单文件失败只记 errors 不中断。
 * rel 为相对源根目录的路径(首层为空串)。
 */
async function copyDir(
  sourceRoot: string,
  targetRoot: string,
  rel: string,
  report: ImportReport,
): Promise<void> {
  const sourceAbs = path.join(sourceRoot, rel);

  let entries: Dirent[];
  try {
    entries = await fs.readdir(sourceAbs, { withFileTypes: true });
  } catch (err) {
    report.errors.push({ path: toPosix(rel) || '.', message: errorMessage(err) });
    return;
  }

  for (const entry of entries) {
    if (shouldSkip(entry.name)) continue;

    const childRel = rel ? path.join(rel, entry.name) : entry.name;
    const childSourceAbs = path.join(sourceRoot, childRel);
    const childTargetAbs = path.join(targetRoot, childRel);

    if (entry.isDirectory()) {
      try {
        await fs.mkdir(childTargetAbs, { recursive: true });
      } catch (err) {
        report.errors.push({ path: toPosix(childRel), message: errorMessage(err) });
        continue;
      }
      await copyDir(sourceRoot, targetRoot, childRel, report);
      continue;
    }

    // 符号链接等特殊文件直接跳过,避免越出源目录
    if (!entry.isFile()) continue;

    try {
      const targetAbs = await resolveTargetPath(childTargetAbs);
      await fs.copyFile(childSourceAbs, targetAbs);
      report.copied += 1;
      if (targetAbs !== childTargetAbs) {
        report.conflicts.push({
          from: toPosix(childRel),
          to: toPosix(path.relative(targetRoot, targetAbs)),
        });
      }
    } catch (err) {
      report.errors.push({ path: toPosix(childRel), message: errorMessage(err) });
    }
  }
}

/**
 * 执行导入。源目录缺失时抛出可读错误(路由层映射 4xx),不产生半截目标。
 */
export async function importKnowledge(options: ImportOptions): Promise<ImportReport> {
  const sourceDir = path.resolve(options.sourceDir ?? defaultImportSourceDir());
  const targetDir = path.resolve(options.targetDir);

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(sourceDir);
  } catch {
    throw new Error(`源目录不存在: ${sourceDir}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`源路径不是目录: ${sourceDir}`);
  }

  // 按真实路径比较(解符号链接 + Windows 大小写),拒绝自我导入与互相包含,
  // 否则递归复制可能失控(把目标写进源里无限套娃)。
  const normSource = normalizeForCompare(await realpathLoose(sourceDir));
  const normTarget = normalizeForCompare(await realpathLoose(targetDir));
  if (normSource === normTarget) {
    throw new Error('源目录与目标目录相同,无需导入');
  }
  if (isStrictlyInside(normSource, normTarget) || isStrictlyInside(normTarget, normSource)) {
    throw new Error('源目录与目标目录不能互相包含');
  }

  await fs.mkdir(targetDir, { recursive: true });

  const report: ImportReport = { copied: 0, conflicts: [], errors: [] };
  await copyDir(sourceDir, targetDir, '', report);
  return report;
}
