// backend/src/infrastructure/persistence/JsonVocabRepository.ts
import fs from 'fs/promises';
import path from 'path';
import type { StudySyncStatus } from '@ai-task-flow/shared';
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
 * 仿 JsonChatRepository：loadAll/saveAll、fromJSON/toJSON。
 *
 * 并发安全：所有写操作（save/saveMany/delete）经 withWriteLock 串行化，
 * 避免「loadAll → 改内存 → saveAll」整文件重写在 async 织入下后写覆盖前写。
 * Node 单进程，进程内 promise-chain mutex 即可，无需文件锁。
 */
export class JsonVocabRepository implements VocabRepository {
  private readonly filePath: string;
  /** 写操作串行化链：每次写追加到链尾，保证 loadAll→saveAll 临界区不交织 */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(customPath?: string) {
    // 走统一的 resolveDataDir()，与 tasks.json / chats.json 同目录，
    // 保证 --data-dir / AI_TASK_FLOW_DATA_DIR 改动时 vocab.json 跟随、存储监控不漏扫。
    this.filePath = customPath ?? vocabFilePath();
  }

  /**
   * 串行化一段「读-改-写」临界区。即使 task 抛错，链也不断（catch 后继续），
   * 保证后续写不会被一个失败的操作永久阻塞。
   */
  private withWriteLock<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(task, task);
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async save(vocab: Vocab): Promise<void> {
    await this.withWriteLock(async () => {
      const data = await this.loadAll();
      const index = data.vocabs.findIndex(v => v.id === vocab.id);
      if (index >= 0) {
        data.vocabs[index] = vocab.toJSON();
      } else {
        data.vocabs.push(vocab.toJSON());
      }
      await this.saveAll(data);
    });
  }

  async saveMany(vocabs: Vocab[]): Promise<void> {
    if (vocabs.length === 0) return;
    await this.withWriteLock(async () => {
      const data = await this.loadAll();
      // 用 id→index 映射，O(n) 完成批量 upsert（而非每条 findIndex 的 O(n²)）
      const indexById = new Map<string, number>();
      data.vocabs.forEach((v, i) => indexById.set(v.id, i));
      for (const vocab of vocabs) {
        const dto = vocab.toJSON();
        const idx = indexById.get(vocab.id);
        if (idx !== undefined) {
          data.vocabs[idx] = dto;
        } else {
          indexById.set(vocab.id, data.vocabs.length);
          data.vocabs.push(dto);
        }
      }
      await this.saveAll(data);
    });
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

  async findByStudySyncStatus(status: StudySyncStatus): Promise<Vocab[]> {
    const data = await this.loadAll();
    return data.vocabs
      .filter(v => (v.studySyncStatus ?? 'pending') === status)
      .map(dto => Vocab.fromJSON(dto));
  }

  async findByStudySyncStatuses(statuses: StudySyncStatus[]): Promise<Vocab[]> {
    if (statuses.length === 0) return [];
    const set = new Set<StudySyncStatus>(statuses);
    const data = await this.loadAll();
    return data.vocabs
      .filter(v => set.has((v.studySyncStatus ?? 'pending') as StudySyncStatus))
      .map(dto => Vocab.fromJSON(dto));
  }

  async delete(id: string): Promise<void> {
    await this.withWriteLock(async () => {
      const data = await this.loadAll();
      data.vocabs = data.vocabs.filter(v => v.id !== id);
      await this.saveAll(data);
    });
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
