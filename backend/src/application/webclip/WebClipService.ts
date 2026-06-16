// backend/src/application/webclip/WebClipService.ts
// 网页剪藏应用服务:落盘图片 → LLM 结构化拆解 → 产出任务草案(drafts),失败回退单任务。
// 不落库——草案返回给前端确认后,再走 POST /api/tasks 正式建任务。
import type { LlmConfigService } from '../llm-config/LlmConfigService.js';
import type { LlmMessage } from '../../infrastructure/llm/LlmProvider.js';
import { saveBase64Image } from '../../infrastructure/storage/saveBase64Image.js';
import { FileLogger } from '../../infrastructure/logging/FileLogger.js';
import { CLIP_SYSTEM_PROMPT, buildClipUserPrompt } from './clipPrompt.js';
import type { ClipRequest, ClipDraft, ClipResponse, StepBlock, TaskStep } from '@ai-task-flow/shared';

const logger = new FileLogger('webclip');

/** LLM 原始输出的一个 block(type 运行时判断,content/ref 可选) */
interface RawBlock {
  type: string;
  content?: string;
  ref?: string;
}

/** LLM 原始输出结构(图片用 ref,待替换) */
interface RawOutput {
  drafts: { title: string; description: string; steps: { blocks?: RawBlock[] }[] }[];
}

export class WebClipService {
  constructor(
    private readonly llmConfigService: LlmConfigService,
    private readonly uploadsDir?: string,   // 测试注入;生产用 saveBase64Image 默认 uploads 目录
  ) {}

  async clip(request: ClipRequest): Promise<ClipResponse> {
    if (!this.llmConfigService.isConfigured()) {
      throw new Error('尚未配置 API Key,请先在「设置」配置 LLM 后再剪藏');
    }

    // 1. 落盘图片:name → /api/uploads/xxx url
    const imageMap = new Map<string, string>();
    for (const img of request.images ?? []) {
      try {
        const url = await saveBase64Image(img.base64, this.uploadsDir);
        imageMap.set(img.name, url);
      } catch (error: unknown) {
        // 单张图失败不阻断,跳过
        logger.warn('保存图片失败,跳过', { name: img.name, error: String(error) });
      }
    }

    // 2. LLM 拆解,失败回退单任务
    let drafts: ClipDraft[];
    try {
      drafts = await this.decompose(request.content.text, imageMap);
    } catch (error: unknown) {
      logger.warn('LLM 拆解失败,回退为单任务', { error: String(error) });
      drafts = [this.fallbackDraft(request, imageMap)];
    }

    return { drafts, sourceUrl: request.sourceUrl };
  }

  private async decompose(text: string, imageMap: Map<string, string>): Promise<ClipDraft[]> {
    const llm = this.llmConfigService.getProvider();
    const messages: LlmMessage[] = [
      { role: 'system', content: CLIP_SYSTEM_PROMPT },
      { role: 'user', content: buildClipUserPrompt(text) },
    ];
    const raw = await llm.generateObject<RawOutput>(messages, {});
    if (!raw?.drafts?.length) {
      throw new Error('LLM 未返回有效草案');
    }
    return raw.drafts.map((d) => this.resolveDraft(d, imageMap));
  }

  /** 把 LLM 输出的 ref 占位替换为真实图片 url */
  private resolveDraft(raw: RawOutput['drafts'][number], imageMap: Map<string, string>): ClipDraft {
    const steps: TaskStep[] = (raw.steps ?? []).map((s) => {
      const blocks: StepBlock[] = (s.blocks ?? []).flatMap((b): StepBlock[] => {
        if (b.type === 'text') {
          return b.content ? [{ type: 'text', content: b.content }] : [];
        }
        if (b.type === 'image') {
          const url = b.ref ? imageMap.get(b.ref) : undefined;
          return url ? [{ type: 'image', url }] : [];
        }
        return [];
      });
      return { blocks };
    });
    return { title: raw.title, description: raw.description, steps };
  }

  /** 回退:原文进 description,所有图作为单任务步骤 */
  private fallbackDraft(request: ClipRequest, imageMap: Map<string, string>): ClipDraft {
    const imageBlocks: StepBlock[] = [...imageMap.values()].map((url) => ({ type: 'image', url }));
    const textBlock: StepBlock[] = request.content.text.trim()
      ? [{ type: 'text', content: request.content.text.slice(0, 1000) }]
      : [];
    const blocks = [...textBlock, ...imageBlocks];
    return {
      title: request.title || '网页剪藏任务',
      description: request.content.text.slice(0, 500),
      steps: blocks.length > 0 ? [{ blocks }] : [{ blocks: [{ type: 'text', content: '（无内容）' }] }],
    };
  }
}
