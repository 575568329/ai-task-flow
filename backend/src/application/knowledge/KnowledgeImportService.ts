// backend/src/application/knowledge/KnowledgeImportService.ts
// 知识库导入:把用户在页面选择的文本(单文件/多文件/整目录)写入知识库根目录。
// 内容级幂等:目标已有内容相同的文件(含历史 -imported 副本)直接跳过;
// 同名但内容不同不覆盖,新文件改名为 <name>-imported<ext>。路径限定在目标根内。
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { KnowledgeImportFile, KnowledgeImportReport } from '@ai-task-flow/shared';

/** 冲突文件改名后缀 */
const IMPORTED_SUFFIX = '-imported';

/** 导入报告类型统一由 shared 定义(前端直接复用,避免两处漂移) */
export type ImportReport = KnowledgeImportReport;
export type ImportConflict = KnowledgeImportReport['conflicts'][number];
export type ImportError = KnowledgeImportReport['errors'][number];

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

async function exists(abs: string): Promise<boolean> {
  try {
    await fs.stat(abs);
    return true;
  } catch {
    return false;
  }
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 导入用户「选择文件/选择文件夹」得到的文件内容(文本 + base64 二进制)。
 * 路径只允许落在目标根内:拒绝 . / .. / 隐藏目录,防止越界写入。
 */
export async function importKnowledgeFiles(
  targetDir: string,
  files: KnowledgeImportFile[],
): Promise<ImportReport> {
  const root = path.resolve(targetDir);
  await fs.mkdir(root, { recursive: true });
  const report: ImportReport = { copied: 0, skipped: 0, conflicts: [], errors: [] };

  for (const file of files) {
    const rel = String(file.path ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
    const segments = rel.split('/').filter(Boolean);
    if (!rel || segments.some((seg) => seg === '.' || seg === '..' || seg.startsWith('.'))) {
      report.errors.push({ path: rel || '(空路径)', message: '非法文件路径' });
      continue;
    }
    const abs = path.resolve(root, ...segments);
    if (!abs.startsWith(root + path.sep)) {
      report.errors.push({ path: rel, message: '路径越界' });
      continue;
    }

    try {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      // 文本保持 utf8 原样写入;二进制按 base64 解码后写字节,保证导出/导入往返一致
      const payload =
        file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : Buffer.from(file.content, 'utf8');
      const contentHash = createHash('sha256').update(payload).digest('hex');
      const slot = await resolveTargetSlot(abs, contentHash);
      if ('skipped' in slot) {
        report.skipped += 1;
        continue;
      }
      await fs.writeFile(slot.targetAbs, payload);
      report.copied += 1;
      if (slot.targetAbs !== abs) {
        report.conflicts.push({
          from: toPosix(rel),
          to: toPosix(path.relative(root, slot.targetAbs)),
        });
      }
    } catch (err) {
      report.errors.push({ path: toPosix(rel), message: errorMessage(err) });
    }
  }

  return report;
}
