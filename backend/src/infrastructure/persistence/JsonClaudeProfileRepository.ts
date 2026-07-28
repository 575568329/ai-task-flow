// backend/src/infrastructure/persistence/JsonClaudeProfileRepository.ts
// Claude Code settings profile 的 JSON 持久化。
// 存储位置: ~/.ai-task-flow/claude-profiles.json(走 resolveDataDir,与 llm-config.json 同级)
//
// ⚠️ 该文件含 ANTHROPIC_AUTH_TOKEN 明文(profile 就是 settings.json 的完整快照)。
// 与 llm-config.json 同等敏感:仅后端读写,任何下发前端的响应都必须先过 summarizeSettings 脱敏。
import fs from 'node:fs/promises';
import path from 'node:path';
import { claudeProfilesFilePath } from '../../config/dataDir.js';
import type { ClaudeSettings } from '../../domain/claude-profile/settingsCodec.js';

/** 存储中的单条 profile(settings 为完整快照明文) */
export interface StoredClaudeProfile {
  id: string;
  name: string;
  settings: ClaudeSettings;
  updatedAt: string;
}

interface ProfileStorageData {
  profiles: StoredClaudeProfile[];
}

export class JsonClaudeProfileRepository {
  private readonly filePath: string;

  constructor(customPath?: string) {
    this.filePath = customPath ?? claudeProfilesFilePath();
  }

  async findAll(): Promise<StoredClaudeProfile[]> {
    const data = await this.loadAll();
    return data.profiles;
  }

  async findById(id: string): Promise<StoredClaudeProfile | null> {
    const data = await this.loadAll();
    return data.profiles.find((profile) => profile.id === id) ?? null;
  }

  /** 新增或覆盖(按 id) */
  async save(profile: StoredClaudeProfile): Promise<void> {
    const data = await this.loadAll();
    const index = data.profiles.findIndex((item) => item.id === profile.id);
    if (index >= 0) data.profiles[index] = profile;
    else data.profiles.push(profile);
    await this.saveAll(data);
  }

  async delete(id: string): Promise<void> {
    const data = await this.loadAll();
    data.profiles = data.profiles.filter((profile) => profile.id !== id);
    await this.saveAll(data);
  }

  private async loadAll(): Promise<ProfileStorageData> {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(content) as Partial<ProfileStorageData>;
      return { profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { profiles: [] };
      throw error;
    }
  }

  private async saveAll(data: ProfileStorageData): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }
}
