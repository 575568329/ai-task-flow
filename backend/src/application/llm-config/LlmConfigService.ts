// backend/src/application/llm-config/LlmConfigService.ts
import type { LlmConfigRepository } from '../../domain/llm-config/LlmConfigRepository.js';
import type { LlmConfigData, MaskedLlmConfig } from '../../domain/llm-config/LlmConfigEntity.js';
import { maskApiKey } from '../../domain/llm-config/LlmConfigEntity.js';
import type { LlmProvider } from '../../infrastructure/llm/LlmProvider.js';
import { OpenAiCompatibleProvider } from '../../infrastructure/llm/OpenAiCompatibleProvider.js';

/** 默认 LLM 配置（智谱 AI） */
const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
const DEFAULT_MODEL = 'glm-4-plus';

/**
 * LLM 配置服务
 * 职责：
 * - 启动时加载配置（文件 > 环境变量 > 默认值）
 * - 对外提供当前生效的 LlmProvider 实例
 * - 保存新配置后动态替换 Provider（无需重启）
 */
export class LlmConfigService {
  private currentProvider: OpenAiCompatibleProvider;
  /** 当前生效的 apiKey(明文,仅内存),用于 isConfigured 判断,不对外暴露 */
  private activeApiKey: string;

  constructor(
    private readonly repository: LlmConfigRepository,
  ) {
    // 构造时先用环境变量创建默认 Provider
    // startApp 会调用 init() 从文件加载并覆盖
    this.activeApiKey = process.env.LLM_API_KEY || '';
    this.currentProvider = new OpenAiCompatibleProvider(
      process.env.LLM_BASE_URL || DEFAULT_BASE_URL,
      this.activeApiKey,
      process.env.LLM_MODEL || DEFAULT_MODEL,
    );
  }

  /** 启动时调用：从文件加载配置，覆盖默认 Provider */
  async init(): Promise<void> {
    const persisted = await this.repository.load();
    if (persisted) {
      this.rebuildProvider(persisted);
    }
  }

  /** 获取当前生效的 LlmProvider 实例 */
  getProvider(): LlmProvider {
    return this.currentProvider;
  }

  /** 当前是否已配置可用的 apiKey(供调用方提前拦截,给出友好提示) */
  isConfigured(): boolean {
    return !!this.activeApiKey && !!this.activeApiKey.trim();
  }

  /**
   * 获取当前生效的明文 apiKey(仅供后端内部服务使用,如 GLM Web Search)。
   * 注意:不要把返回值透传给前端或日志——前端展示请用 getMaskedConfig()。
   * 实时返回最新值,支持配置热更新后立即生效。
   */
  getActiveApiKey(): string {
    return this.activeApiKey;
  }

  /** 获取脱敏配置（返回给前端展示） */
  async getMaskedConfig(): Promise<MaskedLlmConfig> {
    const persisted = await this.repository.load();
    const active = persisted ?? {
      baseURL: process.env.LLM_BASE_URL || DEFAULT_BASE_URL,
      apiKey: process.env.LLM_API_KEY || '',
      model: process.env.LLM_MODEL || DEFAULT_MODEL,
    };

    return {
      baseURL: active.baseURL,
      apiKeyMasked: maskApiKey(active.apiKey),
      apiKeySet: !!active.apiKey,
      model: active.model,
    };
  }

  /**
   * 保存新配置并立即生效
   * apiKey 为空字符串时表示"保持原值不变"
   */
  async saveConfig(newConfig: { baseURL: string; apiKey: string; model: string }): Promise<MaskedLlmConfig> {
    // 如果 apiKey 为空字符串，表示用户没有修改 Key，保留原值
    let apiKeyToSave = newConfig.apiKey;
    if (!apiKeyToSave) {
      const persisted = await this.repository.load();
      apiKeyToSave = persisted?.apiKey || process.env.LLM_API_KEY || '';
    }

    const configToPersist: LlmConfigData = {
      baseURL: newConfig.baseURL || DEFAULT_BASE_URL,
      apiKey: apiKeyToSave,
      model: newConfig.model || DEFAULT_MODEL,
    };

    await this.repository.save(configToPersist);
    this.rebuildProvider(configToPersist);

    return {
      baseURL: configToPersist.baseURL,
      apiKeyMasked: maskApiKey(configToPersist.apiKey),
      apiKeySet: !!configToPersist.apiKey,
      model: configToPersist.model,
    };
  }

  private rebuildProvider(config: { baseURL: string; apiKey: string; model: string }): void {
    this.activeApiKey = config.apiKey;
    this.currentProvider = new OpenAiCompatibleProvider(
      config.baseURL,
      config.apiKey,
      config.model,
    );
  }
}
