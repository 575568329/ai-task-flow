// backend/src/infrastructure/persistence/JsonMaimemoConfigRepository.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { maimemoConfigFilePath } from '../../config/dataDir.js';
import type { PersistedMaimemoConfig } from '../../domain/maimemo/MaimemoConfig.js';
import type { MaimemoConfigRepository } from '../../domain/maimemo/MaimemoConfigRepository.js';

/**
 * JSON 文件持久化的墨墨配置仓储。
 * 存储位置：~/.ai-task-flow/maimemo-config.json
 * 仿 JsonLlmConfigRepository：路径走 maimemoConfigFilePath()，load/save 覆盖写。
 *
 * ⚠️ 本文件含 token 明文，与 llm-config.json / claude-profiles.json 同等敏感：
 *    任何下发前端的响应都必须先经 MaimemoService.getMaskedConfig() 脱敏。
 */
export class JsonMaimemoConfigRepository implements MaimemoConfigRepository {
  private readonly filePath: string;

  constructor(customPath?: string) {
    this.filePath = customPath ?? maimemoConfigFilePath();
  }

  async load(): Promise<PersistedMaimemoConfig> {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      const data = JSON.parse(content);
      // 基本校验：必须有 token 字段才算已配置
      if (data && typeof data.token === 'string') {
        return {
          token: data.token,
          notepadId: typeof data.notepadId === 'string' ? data.notepadId : undefined,
          notepadTitle: typeof data.notepadTitle === 'string' ? data.notepadTitle : undefined,
          lastNotepadSyncAt: typeof data.lastNotepadSyncAt === 'string' ? data.lastNotepadSyncAt : undefined,
        };
      }
      return null;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async save(config: PersistedMaimemoConfig): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(config, null, 2), 'utf-8');
  }
}
