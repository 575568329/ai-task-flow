// backend/src/application/system/StorageService.ts
// 数据目录(~/.ai-task-flow)的占用监控与按类清理。
//
// 设计要点:
// - 业务数据(tasks.json / chats.json)只统计、不提供整体清理,避免误删;
//   用户应回到对应界面逐个删除。
// - 可清理项:events.jsonl(审计) / uploads(图片) / tasks 存档(md) / logs(日志)。
// - 阈值由后端统一计算,前端只接收 warning 标志,无需感知具体字节。
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Dirent } from 'node:fs';
import {
  tasksFilePath,
  chatFilePath,
  eventsFilePath,
  uploadsDirPath,
  taskDocsDirPath,
  logsDirPath,
} from '../../config/dataDir.js';
import type {
  StorageCategoryKey,
  StorageItem,
  StorageInfo,
  StorageClearResult,
} from '@ai-task-flow/shared';

/** 单项告警阈值:50MB */
export const WARN_ITEM_BYTES = 50 * 1024 * 1024;
/** 总占用告警阈值:100MB */
export const WARN_TOTAL_BYTES = 100 * 1024 * 1024;

interface CategoryDef {
  key: StorageCategoryKey;
  label: string;
  description: string;
  clearable: boolean;
  /** 清理有副作用需强提示(如图片引用失效) */
  danger?: boolean;
  /** 取该类别的绝对路径(文件或目录) */
  resolvePath: () => string;
  /** 是否目录类(影响 fileCount 统计方式) */
  isDir: boolean;
}

/** 类别定义表:顺序即前端展示顺序 */
const CATEGORY_DEFS: CategoryDef[] = [
  {
    key: 'tasks',
    label: '任务数据',
    description: '任务看板的全部任务(tasks.json)。业务核心数据,请回到看板逐个删除任务。',
    clearable: false,
    resolvePath: () => tasksFilePath(),
    isDir: false,
  },
  {
    key: 'chats',
    label: '调研聊天',
    description: '资料调研的全部会话与消息(chats.json)。业务数据,请回到调研页删除会话。',
    clearable: false,
    resolvePath: () => chatFilePath(),
    isDir: false,
  },
  {
    key: 'events',
    label: '事件日志',
    description: '领域事件审计(events.jsonl),只增不删。清空仅丢失审计,不影响业务。',
    clearable: true,
    resolvePath: () => eventsFilePath(),
    isDir: false,
  },
  {
    key: 'uploads',
    label: '上传图片',
    description: '任务描述/聊天粘贴的图片。清空后,已被引用的图片将显示为破图。',
    clearable: true,
    danger: true,
    resolvePath: () => uploadsDirPath(),
    isDir: true,
  },
  {
    key: 'taskDocs',
    label: '任务存档',
    description: '派发时落盘的任务 Markdown 存档。清空后,进行中任务的 Claude 可能读不到存档。',
    clearable: true,
    danger: true,
    resolvePath: () => taskDocsDirPath(),
    isDir: true,
  },
  {
    key: 'logs',
    label: '运行日志',
    description: '后端运行日志(如聊天链路全量日志)。清空安全,不影响业务。',
    clearable: true,
    resolvePath: () => logsDirPath(),
    isDir: true,
  },
];

/** 递归计算目录总大小与文件数 */
async function dirStat(dir: string): Promise<{ bytes: number; fileCount: number }> {
  let bytes = 0;
  let fileCount = 0;
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { bytes: 0, fileCount: 0 };
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await dirStat(full);
      bytes += sub.bytes;
      fileCount += sub.fileCount;
    } else if (entry.isFile()) {
      try {
        const stat = await fs.stat(full);
        bytes += stat.size;
        fileCount += 1;
      } catch {
        // 文件可能在统计中被删,忽略
      }
    }
  }
  return { bytes, fileCount };
}

async function fileStat(file: string): Promise<{ bytes: number; fileCount: number }> {
  try {
    const stat = await fs.stat(file);
    return { bytes: stat.size, fileCount: stat.isFile() ? 1 : 0 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { bytes: 0, fileCount: 0 };
    throw error;
  }
}

/** 清空目录下所有内容(保留空目录本身,供运行时继续写入),返回清理前大小 */
async function clearDirContents(dir: string): Promise<number> {
  const before = (await dirStat(dir)).bytes;
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
  for (const entry of entries) {
    await fs.rm(path.join(dir, entry.name), { recursive: true, force: true });
  }
  return before;
}

/** 清空单个文件(写空串,保留文件供后续 append),返回清理前大小 */
async function clearFile(file: string): Promise<number> {
  try {
    const before = (await fs.stat(file)).size;
    await fs.writeFile(file, '', 'utf-8');
    return before;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
}

export class StorageService {
  /** 扫描所有类别,返回占用汇总 */
  async getStorage(): Promise<StorageInfo> {
    const items: StorageItem[] = [];
    let totalBytes = 0;

    for (const def of CATEGORY_DEFS) {
      const target = def.resolvePath();
      const { bytes, fileCount } = def.isDir ? await dirStat(target) : await fileStat(target);
      totalBytes += bytes;
      items.push({
        key: def.key,
        label: def.label,
        description: def.description,
        bytes,
        fileCount,
        clearable: def.clearable,
        danger: def.danger,
        warning: bytes >= WARN_ITEM_BYTES,
      });
    }

    return { items, totalBytes, warning: totalBytes >= WARN_TOTAL_BYTES };
  }

  /**
   * 按类别清理。仅 clearable=true 的类别生效;tasks/chats 等业务数据被忽略。
   * 返回每类释放字节 + 清理后的最新占用。
   */
  async clearCategories(
    categories: StorageCategoryKey[],
  ): Promise<{ results: StorageClearResult[]; storage: StorageInfo }> {
    const wanted = new Set(categories);
    const results: StorageClearResult[] = [];

    for (const def of CATEGORY_DEFS) {
      if (!wanted.has(def.key) || !def.clearable) continue; // 业务数据禁止整体清空

      const target = def.resolvePath();
      const releasedBytes = def.isDir ? await clearDirContents(target) : await clearFile(target);
      results.push({ key: def.key, releasedBytes });
    }

    return { results, storage: await this.getStorage() };
  }
}
