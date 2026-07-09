// frontend/src/stores/llmConfigStore.ts
import { create } from 'zustand';
import { llmConfigApi, type MaskedLlmConfig, type SaveLlmConfigParams } from '@/api/llmConfig';
import { toast } from '@/components/ui/toaster';

interface LlmConfigState {
  /** 当前配置（脱敏） */
  config: MaskedLlmConfig | null;
  loading: boolean;
  saving: boolean;

  /** 从后端加载配置 */
  fetchConfig: () => Promise<void>;
  /** 保存配置到后端 */
  saveConfig: (params: SaveLlmConfigParams) => Promise<boolean>;
}

export const useLlmConfigStore = create<LlmConfigState>((set) => ({
  config: null,
  loading: false,
  saving: false,

  fetchConfig: async () => {
    set({ loading: true });
    try {
      const config = await llmConfigApi.get();
      set({ config });
    } finally {
      set({ loading: false });
    }
  },

  saveConfig: async (params) => {
    set({ saving: true });
    try {
      const config = await llmConfigApi.save(params);
      set({ config });
      toast.success('LLM 配置已保存并生效');
      return true;
    } catch {
      return false;
    } finally {
      set({ saving: false });
    }
  },
}));
