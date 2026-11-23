// backend/src/application/knowledge/KnowledgeImportService.ts
// 知识库一次性合并导入:把仓库内孤儿知识库(默认 <repo>/knowledge-base)递归复制到
// 用户数据目录(knowledgeDirPath())。内容级幂等:目标已有内容相同的文件(含历史 -imported
// 副本)直接跳过;同名但内容不同不覆盖,新文件改名为 <name>-imported<ext>。
// 源目录保留作为回滚源。跳过隐藏文件与 .git / node_modules 等无关目录。
import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { KnowledgeImportReport, KnowledgeImportSuggestion } from '@ai-task-flow/shared';

/** 冲突文件改名后缀 */
const IMPORTED_SUFFIX = '-imported';
/** 无关目录名黑名单(隐藏目录已由 '.' 前缀统一跳过) */
const SKIP_DIR_NAMES = new Set(['node_modules']);

/** 导入报告类型统一由 shared 定义(前端直接复用,避免两处漂移) */
export type ImportReport = KnowledgeImportReport;
export type ImportConflict = KnowledgeImportReport['conflicts'][number];
export type ImportError = KnowledgeImportReport['errors'][number];

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
 * 第 slot 个候选落盘路径:
 * slot 0 = 原路径,slot 1 = <name>-imported<ext>,slot 2 = <name>-imported-1<ext> …
 * (与历史导入生成的副本命名保持一致,便于二次导入命中已有内容)
 */
function candidatePathForSlot(targetAbs: string, slot: number): string {
  if (slot === 0) return targetAbs;
  const dir = path.dirname(targetAbs);
  const ext = path.extname(targetAbs);
  const base = path.basename(targetAbs, ext);
  const suffix = slot === 1 ? IMPORTED_SUFFIX : `${IMPORTED_SUFFIX}-${slot - 1}`;
  return path.join(dir, `${base}${suffix}${ext}`);
}

/** 读取文件 sha256(小文件一次读入内存;知识库文档量级可接受) */
async function fileSha256(abs: string): Promise<string> {
  const content = await fs.readFile(abs);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * 计算目标落盘路径(内容级幂等):
 * - 依槽位依次检查已有文件,内容相同 → 跳过(含之前生成的 -imported 副本);
 * - 遇到空槽位 → 在该位置落盘,保证绝不覆盖已有文件。
 */
async function resolveTargetSlot(
  targetAbs: string,
  sourceHash: string,
): Promise<{ targetAbs: string } | { skipped: true }> {
  for (let slot = 0; ; slot += 1) {
    const candidate = candidatePathForSlot(targetAbs, slot);
    if (!(await exists(candidate))) return { targetAbs: candidate };
    try {
      if ((await fileSha256(candidate)) === sourceHash) return { skipped: true };
    } catch {
      // 读不了(如同名目录)就当作不匹配,继续找下一个槽位
    }
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
      const sourceHash = await fileSha256(childSourceAbs);
      const slot = await resolveTargetSlot(childTargetAbs, sourceHash);
      // 目标中已有内容相同的文件(可能是上次导入的产物):跳过,不再生成重复副本
      if ('skipped' in slot) {
        report.skipped += 1;
        continue;
      }
      await fs.copyFile(childSourceAbs, slot.targetAbs);
      report.copied += 1;
      if (slot.targetAbs !== childTargetAbs) {
        report.conflicts.push({
          from: toPosix(childRel),
          to: toPosix(path.relative(targetRoot, slot.targetAbs)),
        });
      }
    } catch (err) {
      report.errors.push({ path: toPosix(childRel), message: errorMessage(err) });
    }
  }
}

/** 递归统计可导入文件数(与导入同一套跳过规则:隐藏文件/目录 + node_modules);目录缺失返回 0 */
async function countImportableFiles(dir: string): Promise<number> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    if (shouldSkip(entry.name)) continue;
    if (entry.isDirectory()) total += await countImportableFiles(path.join(dir, entry.name));
    else if (entry.isFile()) total += 1;
  }
  return total;
}

export interface ImportSuggestionOptions {
  /** 源目录;缺省为仓库内 knowledge-base */
  sourceDir?: string;
  /** 目标目录(通常是 knowledgeDirPath()) */
  targetDir: string;
}

/**
 * 导入引导判断:源目录(仓库 knowledge-base)有可导入文件,且目标比源少 → 建议导入。
 * 源目录不存在/为空时不建议(避免对已合并或非仓库运行环境弹提示)。
 */
export async function suggestImport(
  options: ImportSuggestionOptions,
): Promise<KnowledgeImportSuggestion> {
  const sourceDir = path.resolve(options.sourceDir ?? defaultImportSourceDir());
  const targetDir = path.resolve(options.targetDir);
  const sourceCount = await countImportableFiles(sourceDir);
  const targetCount = await countImportableFiles(targetDir);
  return { suggested: sourceCount > 0 && targetCount < sourceCount, sourceCount, targetCount };
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

  const report: ImportReport = { copied: 0, skipped: 0, conflicts: [], errors: [] };
  await copyDir(sourceDir, targetDir, '', report);
  return report;
}
