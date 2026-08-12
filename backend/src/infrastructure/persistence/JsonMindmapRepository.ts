// backend/src/infrastructure/persistence/JsonMindmapRepository.ts
import fs from 'fs/promises';
import path from 'path';
import { injectable } from 'tsyringe';
import type { MindmapDocDTO } from '@ai-task-flow/shared';
import { mindmapsFilePath } from '../../config/dataDir.js';
import type { MindmapRepository } from '../../domain/mindmap/repositories/MindmapRepository.js';
import { MindmapDoc } from '../../domain/mindmap/entities/MindmapDoc.js';

interface MindmapStorageData {
  documents: MindmapDocDTO[];
}

/**
 * JSON 文件存储的思维导图仓储实现。
 * 存储位置：~/.ai-task-flow/mindmaps.json（单文件多文档集合）。
 * 仿 JsonVocabRepository：@injectable、loadAll/saveAll、withWriteLock、customPath（测试用）。
 *
 * 并发安全：写操作经 withWriteLock 串行化（promise-chain mutex），避免 loadAll→改→saveAll
 * 在 async 织入下后写覆盖前写。Node 单进程内 mutex 即可，无需文件锁。
 *
 * 原子写：saveAll 用「写临时文件 + fs.rename」替换。思维导图单文档体积大、自动保存写频繁，
 * 直接 writeFile 写一半进程崩溃会损坏整个 mindmaps.json（全部图丢失）；
 * rename 是 POSIX 原子操作，写崩只会留下孤儿 .tmp 文件，主文件不受影响。
 *
 * 演进路径：文档数/体积增长后可拆为 mindmaps/<id>.json + mindmaps/index.json（仅 meta），
 * PUT 只读写单文件，消除读写放大。当前 MVP 单文件够用，与 vocab/tasks 同模式。
 */
@injectable()
export class JsonMindmapRepository implements MindmapRepository {
  private readonly filePath: string;
  /** 写操作串行化链：每次写追加到链尾，保证 loadAll→saveAll 临界区不交织 */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(customPath?: string) {
    this.filePath = customPath ?? mindmapsFilePath();
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

  async save(doc: MindmapDoc): Promise<void> {
    await this.withWriteLock(async () => {
      const data = await this.loadAll();
      const index = data.documents.findIndex(d => d.id === doc.id);
      const dto = doc.toJSON();
      if (index >= 0) data.documents[index] = dto;
      else data.documents.push(dto);
      await this.saveAll(data);
    });
  }

  async findById(id: string): Promise<MindmapDoc | null> {
    const data = await this.loadAll();
    const dto = data.documents.find(d => d.id === id);
    return dto ? MindmapDoc.fromJSON(dto) : null;
  }

  async findAll(): Promise<MindmapDoc[]> {
    const data = await this.loadAll();
    return data.documents.map(dto => MindmapDoc.fromJSON(dto));
  }

  async delete(id: string): Promise<void> {
    await this.withWriteLock(async () => {
      const data = await this.loadAll();
      data.documents = data.documents.filter(d => d.id !== id);
      await this.saveAll(data);
    });
  }

  async count(): Promise<number> {
    const data = await this.loadAll();
    return data.documents.length;
  }

  private async loadAll(): Promise<MindmapStorageData> {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const content = await fs.readFile(this.filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error: any) {
      if (error.code === 'ENOENT') return { documents: [] };
      throw error;
    }
  }

  private async saveAll(data: MindmapStorageData): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    // 原子写：先写 .tmp 再 rename 替换。rename 是原子操作，写崩不会损坏主文件。
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmp, this.filePath);
  }
}
