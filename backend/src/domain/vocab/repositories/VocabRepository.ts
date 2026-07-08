// backend/src/domain/vocab/repositories/VocabRepository.ts
import type { Vocab } from '../entities/Vocab.js';

/** 生词本仓储接口（领域层只定义契约，实现见 infrastructure/persistence） */
export interface VocabRepository {
  save(vocab: Vocab): Promise<void>;
  findById(id: string): Promise<Vocab | null>;
  findAll(): Promise<Vocab[]>;
  /** 按 word + targetLang 查重（去重判定） */
  findByWordAndLang(word: string, targetLang: string): Promise<Vocab | null>;
  delete(id: string): Promise<void>;
}
