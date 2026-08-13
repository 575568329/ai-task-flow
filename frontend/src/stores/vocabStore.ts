// frontend/src/stores/vocabStore.ts
// 翻译生词本状态:列表(搜索/筛选/分页) + translate + CRUD。
// 仿 taskStore 模式(zustand create + store 内调 api + upsert 局部更新)。
import { create } from 'zustand';
import type {
  VocabDTO,
  VocabCreateDTO,
  VocabListQuery,
  TranslateResponse,
  YoudaoImportResultDTO,
} from '@ai-task-flow/shared';
import { vocabApi } from '@/api/vocab';
import { toast } from '@/components/ui/toaster';

const PAGE_SIZE = 50;

interface VocabState {
  items: VocabDTO[];
  total: number;
  loading: boolean;
  translating: boolean;
  /** 最近一次翻译结果(供「存入生词本」复用) */
  lastTranslate: { text: string; result: TranslateResponse } | null;
  /** 导入有道 .bin 进行中 */
  importing: boolean;
  /** 最近一次导入结果(供页面行内卡展示) */
  importResult: YoudaoImportResultDTO | null;
  query: VocabListQuery;

  translate: (text: string, targetLang?: string) => Promise<TranslateResponse | null>;
  fetchList: (query?: Partial<VocabListQuery>) => Promise<void>;
  setQuery: (patch: Partial<VocabListQuery>) => void;
  saveFromTranslate: (extra?: Partial<VocabCreateDTO>) => Promise<boolean>;
  saveVocab: (dto: VocabCreateDTO) => Promise<VocabDTO | null>;
  toggleStar: (vocab: VocabDTO) => Promise<void>;
  toggleMastered: (vocab: VocabDTO) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** 导入有道 .bin 生词本，成功后刷新列表 */
  importYoudaoBin: (file: File) => Promise<YoudaoImportResultDTO | null>;
  /** 清除导入结果卡 */
  clearImportResult: () => void;
  upsert: (vocab: VocabDTO) => void;
}

export const useVocabStore = create<VocabState>((set, get) => ({
  items: [],
  total: 0,
  loading: false,
  translating: false,
  lastTranslate: null,
  importing: false,
  importResult: null,
  query: { page: 1, pageSize: PAGE_SIZE },

  translate: async (text, targetLang) => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    set({ translating: true });
    try {
      const result = await vocabApi.translate(trimmed, targetLang);
      set({ lastTranslate: { text: trimmed, result } });
      return result;
    } catch {
      return null; // http 拦截器已 toast
    } finally {
      set({ translating: false });
    }
  },

  fetchList: async (query) => {
    if (query) get().setQuery(query);
    set({ loading: true });
    try {
      const res = await vocabApi.list(get().query);
      set({ items: res.items, total: res.total });
    } finally {
      set({ loading: false });
    }
  },

  setQuery: (patch) => {
    set((s) => {
      // 筛选/搜索条件变化时回到第 1 页,仅翻页(page)不变更页
      const resetPage =
        'kw' in patch ||
        'mastered' in patch ||
        'starred' in patch ||
        'sourceLang' in patch ||
        'studySyncStatus' in patch;
      return {
        query: {
          ...s.query,
          ...patch,
          page: resetPage ? 1 : (patch.page ?? s.query.page),
        },
      };
    });
  },

  /** 把最近一次翻译结果存入生词本(word=原文) */
  saveFromTranslate: async (extra) => {
    const last = get().lastTranslate;
    if (!last) return false;
    const r = last.result;
    const dto: VocabCreateDTO = {
      word: last.text,
      translation: r.translation,
      sourceLang: r.sourceLang || undefined,
      pos: r.pos,
      definition: r.definition,
      example: r.example,
      ...extra,
    };
    return !!(await get().saveVocab(dto));
  },

  saveVocab: async (dto) => {
    try {
      const vocab = await vocabApi.save(dto);
      set((s) => ({
        items: [vocab, ...s.items],
        total: s.total + 1,
        lastTranslate: null, // 存完清空,避免重复存
      }));
      toast.success('已加入生词本');
      return vocab;
    } catch {
      return null; // 重复 409 等由 http 拦截器 toast
    }
  },

  toggleStar: async (vocab) => {
    try {
      get().upsert(await vocabApi.update(vocab.id, { starred: !vocab.starred }));
    } catch {
      /* http toast */
    }
  },

  toggleMastered: async (vocab) => {
    try {
      get().upsert(await vocabApi.update(vocab.id, { mastered: !vocab.mastered }));
    } catch {
      /* http toast */
    }
  },

  remove: async (id) => {
    try {
      await vocabApi.remove(id);
      set((s) => ({
        items: s.items.filter((v) => v.id !== id),
        total: Math.max(0, s.total - 1),
      }));
    } catch {
      /* http toast */
    }
  },

  importYoudaoBin: async (file) => {
    set({ importing: true });
    try {
      const result = await vocabApi.importYoudao(file);
      set({ importResult: result });
      // 导入后回到第 1 页刷新，让新增词（默认 studySyncStatus=pending）可见
      await get().fetchList({ page: 1 });
      if (result.added > 0) {
        toast.success(`已导入 ${result.added} 词${result.duplicates ? `·跳过 ${result.duplicates} 重复` : ''}`);
      } else if (result.duplicates > 0) {
        toast.info(`全部 ${result.duplicates} 词已存在，无新增`);
      } else {
        toast.info('未解析到任何词条');
      }
      return result;
    } catch {
      return null; // api 层已 toast
    } finally {
      set({ importing: false });
    }
  },

  clearImportResult: () => set({ importResult: null }),

  upsert: (vocab) => {
    set((s) => {
      const idx = s.items.findIndex((v) => v.id === vocab.id);
      if (idx >= 0) {
        const next = [...s.items];
        next[idx] = vocab;
        return { items: next };
      }
      return { items: [vocab, ...s.items] };
    });
  },
}));
