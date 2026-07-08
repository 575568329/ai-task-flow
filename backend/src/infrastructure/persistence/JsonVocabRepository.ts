// backend/src/infrastructure/persistence/JsonVocabRepository.ts
import fs from 'fs/promises';
import path from 'path';
import { injectable } from 'tsyringe';
import { vocabFilePath } from '../../config/dataDir.js';
import type { VocabRepository } from '../../domain/vocab/repositories/VocabRepository.js';
import { Vocab } from '../../domain/vocab/entities/Vocab.js';
import type { VocabDTO } from '@ai-task-flow/shared';

interface VocabStorageData {
  vocabs: VocabDTO[];
}

/**
 * JSON 文件存储的 Vocab 仓储实现。
 * 存储位置：~/.ai-task-flow/vocab.json
 * 仿 JsonChatRepository：@injectable、loadAll/saveAll、fromJSON/toJSON。
 */
@injectable()
export class JsonVocabRepository implements VocabRepository {
  private readonly filePath: string;

  constructor(customPath?: string) {
    // 走统一的 resolveDataDir()，与 tasks.json / chats.json 同目录，
    // 保证 --data-dir / AI_TASK_FLOW_DATA_DIR 改动时 vocab.json 跟随、存储监控不漏扫。
    this.filePath = customPath ?? vocabFilePath();
  }

  async save(vocab: Vocab): Promise<void> {
    const data = await this.loadAll();
    const index = data.vocabs.findIndex(v => v.id === vocab.id);
    if (index >= 0) {
      data.vocabs[index] = vocab.toJSON();
    } else {
      data.vocabs.push(vocab.toJSON());
    }
    await this.saveAll(data);
  }

  async findById(id: string): Promise<Vocab | null> {
    const data = await this.loadAll();
    const dto = data.vocabs.find(v => v.id === id);
    return dto ? Vocab.fromJSON(dto) : null;
  }

  async findAll(): Promise<Vocab[]> {
    const data = await this.loadAll();
    return data.vocabs.map(dto => Vocab.fromJSON(dto));
  }

  async findByWordAndLang(word: string, targetLang: string): Promise<Vocab | null> {
    const data = await this.loadAll();
    // 与 Vocab.uniqueKey() 保持一致的规范化（trim + 小写），避免大小写差异导致漏判
    const key = `${word.trim().toLowerCase()}|${targetLang}`;
    const dto = data.vocabs.find(v => `${v.word.trim().toLowerCase()}|${v.targetLang}` === key);
    return dto ? Vocab.fromJSON(dto) : null;
  }

  async delete(id: string): Promise<void> {
    const data = await this.loadAll();
    data.vocabs = data.vocabs.filter(v => v.id !== id);
    await this.saveAll(data);
  }

  private async loadAll(): Promise<VocabStorageData> {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const content = await fs.readFile(this.filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return { vocabs: [] };
      }
      throw error;
    }
  }

  private async saveAll(data: VocabStorageData): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2));
  }
}
