// backend/src/domain/vocab/repositories/VocabRepository.ts
import type { StudySyncStatus } from '@ai-task-flow/shared';
import type { Vocab } from '../entities/Vocab.js';

/** 生词本仓储接口（领域层只定义契约，实现见 infrastructure/persistence） */
export interface VocabRepository {
  save(vocab: Vocab): Promise<void>;
  /** 批量保存：整批只读写文件一次（loadAll→按 id upsert→单次 saveAll），用于导入/同步场景 */
  saveMany(vocabs: Vocab[]): Promise<void>;
  findById(id: string): Promise<Vocab | null>;
  findAll(): Promise<Vocab[]>;
  /** 按 word + targetLang 查重（去重判定） */
  findByWordAndLang(word: string, targetLang: string): Promise<Vocab | null>;
  /** 按墨墨学习计划同步状态筛选（缺省状态视为 'pending'） */
  findByStudySyncStatus(status: StudySyncStatus): Promise<Vocab[]>;
  /** 按多个同步状态筛选（如 pending+failed 一起重试，缺省状态视为 'pending'） */
  findByStudySyncStatuses(statuses: StudySyncStatus[]): Promise<Vocab[]>;
  delete(id: string): Promise<void>;
}
