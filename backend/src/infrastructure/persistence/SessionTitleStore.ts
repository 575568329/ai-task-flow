// backend/src/infrastructure/persistence/SessionTitleStore.ts
// 会话自定义标题存储:sessionId → 用户命名,供看板历史列表显示。
// 刻意不碰 Claude Code 的 jsonl(其会话命名靠 TUI /name 写 system-reminder,格式不稳定),
// 仅在看板侧覆盖显示。终端恢复仍靠 sessionId(claude --resume <id>),与标题无关。
import fs from 'node:fs/promises';
import { sessionTitlesFilePath } from '../../config/dataDir.js';

export class SessionTitleStore {
  private cache: Map<string, string> | null = null;

  private async load(): Promise<Map<string, string>> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(sessionTitlesFilePath(), 'utf8');
      const obj = JSON.parse(raw) as Record<string, string>;
      this.cache = new Map(Object.entries(obj));
    } catch (error) {
      // ENOENT = 首次运行,正常空态;其他(坏 JSON/权限)告警但不抛——
      // 标题是显示增强,损坏不应阻断对话。重置 + 留日志便于排查。
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        console.warn('[SessionTitleStore] 读取失败,重置为空', {
          code,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      this.cache = new Map();
    }
    return this.cache;
  }

  /** 一次性取全部映射(历史列表合并用,避免逐条 await) */
  async getAll(): Promise<Map<string, string>> {
    return this.load();
  }

  async get(sessionId: string): Promise<string | undefined> {
    return (await this.load()).get(sessionId);
  }

  async set(sessionId: string, title: string): Promise<void> {
    const map = await this.load();
    map.set(sessionId, title);
    await fs.writeFile(sessionTitlesFilePath(), JSON.stringify(Object.fromEntries(map), null, 2), 'utf8');
  }
}
