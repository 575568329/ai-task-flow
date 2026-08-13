// backend/src/infrastructure/persistence/JsonRepository.ts
// JSON 文件仓储基类:统一「写串行化 + 原子写」两件套,根治两个数据安全问题——
//   1) loadAll→改→saveAll 在 async 织入下后写覆盖前写(JsonTaskRepository 等的历史问题)
//   2) writeFile 写一半进程崩溃损坏全量数据(整个 tasks.json/chats.json 报废)
//
// 设计参考 JsonMindmapRepository 既有正确实现(withWriteLock + tmp+rename),将其上提为
// 公共基类,供原本裸 writeFile 的 Task/Chat/ClaudeProfile 仓储复用。Vocab/Mindmap 可后续
// 平迁继承本基类(行为不变),本次仅补缺失保护的三者。
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * JSON 文件仓储基类。
 *
 * 并发安全:写操作经 {@link withWriteLock} 串行化(promise-chain mutex),保证
 * loadAll→改→saveAll 临界区不交织。Node 单进程内 mutex 即可,无需文件锁。
 *
 * 崩溃安全:saveAll 用「写临时文件 + fs.rename」替换。rename 是 POSIX 原子操作,
 * 写崩只会留下孤儿 .tmp 文件,主文件不受影响。tmp 与目标强制同目录(避免 Windows
 * 上 rename 跨盘符失败)。
 *
 * 子类职责:实现业务映射(loadAll/saveAll 调 {@link read}/{@link write}),
 * 写操作用 {@link withWriteLock} 包裹「读-改-写」事务。并发与崩溃保护由本基类保证。
 */
export abstract class JsonRepository {
  protected readonly filePath: string;
  /** 写操作串行化链:每次写追加到链尾,保证临界区不交织 */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * 串行化一段「读-改-写」临界区。即使 task 抛错,链也不断(catch 后继续),
   * 保证后续写不会被一个失败的操作永久阻塞。
   */
  protected withWriteLock<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(task, task);
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * 读文件原文;目录不存在自动创建(与历史行为一致);文件不存在返回 undefined,
   * 由子类决定空态(不同仓储空结构不同:[] / {profiles:[]} / {conversations:[],messages:[]})。
   * JSON.parse 失败由子类处理(历史行为:抛错,不静默吞)。
   */
  protected async read(): Promise<string | undefined> {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      return await fs.readFile(this.filePath, 'utf-8');
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  /**
   * 原子写:先写 .tmp(与目标同目录,避开 Windows rename 跨盘符失败)再 rename 替换。
   * rename 是 POSIX 原子操作,写崩不会损坏主文件,最多留下孤儿 .tmp。
   */
  protected async write(text: string): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, text, 'utf-8');
    await fs.rename(tmp, this.filePath);
  }
}
