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

    // 诊断:采集结果散落在扩展端(content script 跑在网页上下文、SW 控制台),后端够不着。
    // 请求到达后端时记录一次,用于排查"草案为何没有图片"——imageCount=0 是采集层问题,
    // imageCount>0 但引用=0 是 LLM 没引用图片。
    logger.info('收到剪藏请求', {
      sourceUrl: request.sourceUrl,
      textLen: request.content.text.length,
      imageCount: request.images?.length ?? 0,
      images: (request.images ?? []).map((i) => ({
        name: i.name,
        bytes: i.base64.length,
        prefix: i.base64.slice(0, 40), // 诊断:看实际是 data:image/png;base64, 还是 data:;base64,(空 mime)
      })),
    });

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
    logger.info('图片落盘完成', { saved: imageMap.size, total: request.images?.length ?? 0 });

    // 2. LLM 拆解,失败回退单任务
    let drafts: ClipDraft[];
    try {
      drafts = await this.decompose(request.content.text, imageMap);
    } catch (error: unknown) {
      logger.warn('LLM 拆解失败,回退为单任务', { error: String(error) });
      drafts = [this.fallbackDraft(request, imageMap)];
    }

    // 诊断:统计草案引用的图片。saved>0 而 referenced=0 即"采到图但 LLM 没引用"。
    const imageSummary = this.summarizeImages(drafts);
    logger.info('草案图片引用', {
      saved: imageMap.size,
      referencedBlocks: imageSummary.blocks,
      uniqueUrls: imageSummary.urls.size,
    });

    // 兜底:LLM 常不主动把图片引用进步骤。把已落盘但未被引用的图补进第一个草案,
    // 保证采集到的图不丢失(用户能在草案里看到对应图)。
    drafts = this.attachUnusedImages(drafts, imageMap, imageSummary.urls);

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

  /** 汇总草案中被引用的图片:image block 总数 + 去重 url 集合(诊断与兜底共用) */
  private summarizeImages(drafts: ClipDraft[]): { blocks: number; urls: Set<string> } {
    const urls = new Set<string>();
    let blocks = 0;
    for (const draft of drafts) {
      for (const step of draft.steps) {
        for (const block of step.blocks) {
          if (block.type === 'image' && block.url) {
            blocks++;
            urls.add(block.url);
          }
        }
      }
    }
    return { blocks, urls };
  }

  /** 把已落盘但未被引用的图片追加到第一个草案末尾(作为"页面附图"步骤),保证不丢图 */
  private attachUnusedImages(
    drafts: ClipDraft[],
    imageMap: Map<string, string>,
    usedUrls: Set<string>,
  ): ClipDraft[] {
    if (imageMap.size === 0) return drafts;
    const unused = [...imageMap.values()].filter((url) => !usedUrls.has(url));
    if (unused.length === 0) return drafts;
    const imageBlocks: StepBlock[] = unused.map((url) => ({ type: 'image', url }));
    if (drafts.length === 0) {
      return [{ title: '页面附图', description: '', steps: [{ blocks: imageBlocks }] }];
    }
    const [first, ...rest] = drafts;
    return [{ ...first, steps: [...first.steps, { blocks: imageBlocks }] }, ...rest];
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
