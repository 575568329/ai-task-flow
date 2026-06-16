// backend/src/infrastructure/persistence/JsonLlmConfigRepository.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveDataDir } from '../../config/dataDir.js';
import type { PersistedLlmConfig } from '../../domain/llm-config/LlmConfigEntity.js';
import type { LlmConfigRepository } from '../../domain/llm-config/LlmConfigRepository.js';

/**
 * JSON 文件持久化的 LLM 配置仓储
 * 存储位置: ~/.ai-task-flow/llm-config.json
 * 与 tasks.json / chats.json 同目录，复用 resolveDataDir()
 */
export class JsonLlmConfigRepository implements LlmConfigRepository {
  private readonly filePath: string;

  constructor() {
    const dataDir = resolveDataDir();
    this.filePath = path.join(dataDir, 'llm-config.json');
  }

  async load(): Promise<PersistedLlmConfig> {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      const data = JSON.parse(content);
      // 基本校验：必须有 baseURL 和 model
      if (data && typeof data.baseURL === 'string' && typeof data.model === 'string') {
        return {
          baseURL: data.baseURL,
          apiKey: data.apiKey || '',
          model: data.model,
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

  async save(config: PersistedLlmConfig): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(config, null, 2), 'utf-8');
  }
}
