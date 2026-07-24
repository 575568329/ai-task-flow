// backend/src/infrastructure/persistence/TaskSessionStore.ts
// 任务对话 sessionId 存储:taskId → { windows?, wsl? },供 AgentRunner --resume 续接。
// 分侧:Windows 与 WSL 是两套独立 claude、两个独立 session 池,必须按侧存取,
// 否则拿 Windows 的 sessionId 去 resume WSL claude 会报 "No conversation found"。
// 简单 JSON 文件 + 内存缓存(对话是低频操作,无需 watcher/并发控制)。
import fs from 'node:fs/promises';
import { taskSessionsFilePath } from '../../config/dataDir.js';

type Side = 'windows' | 'wsl';
/** 旧格式(扁平 string)= 全是 Windows 侧历史,加载时归一化到 { windows } */
type Stored = string | Partial<Record<Side, string>> | undefined;

export class TaskSessionStore {
  private cache: Map<string, Partial<Record<Side, string>>> | null = null;

  private async load(): Promise<Map<string, Partial<Record<Side, string>>>> {
    if (this.cache) return this.cache;
    const filePath = taskSessionsFilePath();
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const obj = JSON.parse(raw) as Record<string, Stored>;
      this.cache = new Map();
      for (const [k, v] of Object.entries(obj)) {
        // 兼容旧扁平格式:string 视为 windows 侧
        if (typeof v === 'string') this.cache.set(k, { windows: v });
        else if (v && typeof v === 'object') this.cache.set(k, v);
      }
    } catch (error) {
      // ENOENT = 首次运行/文件未创建,正常空态;其他(坏 JSON/权限)告警但不抛——
      // 续接 sessionId 是非关键旁路状态,不应让一个损坏文件阻断对话。重置 + 留日志便于排查。
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        console.warn('[TaskSessionStore] 读取失败,重置为空', {
          filePath,
          code,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      this.cache = new Map();
    }
    return this.cache;
  }

  async get(taskId: string, side: Side): Promise<string | undefined> {
    return (await this.load()).get(taskId)?.[side];
  }

  async set(taskId: string, side: Side, sessionId: string): Promise<void> {
    const map = await this.load();
    const cur = map.get(taskId) ?? {};
    cur[side] = sessionId;
    map.set(taskId, cur);
    const obj = Object.fromEntries(map);
    await fs.writeFile(taskSessionsFilePath(), JSON.stringify(obj, null, 2), 'utf8');
  }
}
