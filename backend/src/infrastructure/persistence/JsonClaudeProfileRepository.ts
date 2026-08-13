// backend/src/infrastructure/persistence/JsonClaudeProfileRepository.ts
// Claude Code settings profile 的 JSON 持久化。
// 存储位置: ~/.ai-task-flow/claude-profiles.json(走 resolveDataDir,与 llm-config.json 同级)
//
// ⚠️ 该文件含 ANTHROPIC_AUTH_TOKEN 明文(profile 就是 settings.json 的完整快照)。
// 与 llm-config.json 同等敏感:仅后端读写,任何下发前端的响应都必须先过 summarizeSettings 脱敏。
//
// 并发与崩溃安全:继承 JsonRepository(withWriteLock 串行化 + tmp+rename 原子写)。
// 历史问题(已修):原 saveAll 裸 fs.writeFile,写一半崩溃损坏含明文 token 的全量数据;
// 且 loadAll→改→saveAll 非原子。现 save/delete 经 withWriteLock 串行化 + 原子写。
import { claudeProfilesFilePath } from '../../config/dataDir.js';
import type { ClaudeSettings } from '../../domain/claude-profile/settingsCodec.js';
import type { ClaudeApiPreset } from '@ai-task-flow/shared';
import { JsonRepository } from './JsonRepository.js';

/** 存储中的单条 profile(settings 为完整快照明文) */
export interface StoredClaudeProfile {
  id: string;
  name: string;
  settings: ClaudeSettings;
  /** 每个 profile 可存多组 API 预设(model+baseURL+apiKey) */
  apiPresets: ClaudeApiPreset[];
  updatedAt: string;
}

interface ProfileStorageData {
  profiles: StoredClaudeProfile[];
}

export class JsonClaudeProfileRepository extends JsonRepository {
  constructor(customPath?: string) {
    super(customPath ?? claudeProfilesFilePath());
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
    await this.withWriteLock(async () => {
      const data = await this.loadAll();
      const index = data.profiles.findIndex((item) => item.id === profile.id);
      if (index >= 0) data.profiles[index] = profile;
      else data.profiles.push(profile);
      await this.saveAll(data);
    });
  }

  async delete(id: string): Promise<void> {
    await this.withWriteLock(async () => {
      const data = await this.loadAll();
      data.profiles = data.profiles.filter((profile) => profile.id !== id);
      await this.saveAll(data);
    });
  }

  private async loadAll(): Promise<ProfileStorageData> {
    const text = await this.read();
    if (text === undefined) return { profiles: [] };
    const parsed = JSON.parse(text) as Partial<ProfileStorageData>;
    return {
      profiles: Array.isArray(parsed.profiles)
        ? parsed.profiles.map((p) => ({ ...p, apiPresets: Array.isArray(p.apiPresets) ? p.apiPresets : [] }))
        : [],
    };
  }

  private async saveAll(data: ProfileStorageData): Promise<void> {
    await this.write(JSON.stringify(data, null, 2));
  }
}
