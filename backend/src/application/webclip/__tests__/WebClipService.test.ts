// backend/src/application/webclip/__tests__/WebClipService.test.ts
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { WebClipService } from '../WebClipService.js';
import type { LlmProvider, StreamChunk } from '../../../infrastructure/llm/LlmProvider.js';
import type { LlmConfigService } from '../../llm-config/LlmConfigService.js';

let testUploadsDir: string;

beforeEach(() => { testUploadsDir = path.join(os.tmpdir(), `clip-uploads-${Date.now()}`); });
afterEach(async () => { try { await fs.rm(testUploadsDir, { recursive: true, force: true }); } catch {} });

/** 构造一个返回固定 generateObject 结果的 mock provider */
function mockProvider(result: unknown): LlmProvider {
  return {
    async *streamText(): AsyncIterable<StreamChunk> { yield { delta: '', done: true }; },
    async generateObject<T>(): Promise<T> { return result as T; },
  };
}

/** 构造 mock LlmConfigService:返回指定 provider,且 isConfigured 可控 */
function mockLlmConfig(provider: LlmProvider, configured = true): LlmConfigService {
  return {
    getProvider: () => provider,
    isConfigured: () => configured,
  } as unknown as LlmConfigService;
}

// 1x1 透明 png base64,测试用
const PNG_DATAURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

describe('WebClipService', () => {
  it('should decompose content into drafts and replace image refs with urls', async () => {
    const llmResult = {
      drafts: [{
        title: '审核页未国际化',
        description: '页面位置:审核判定页',
        steps: [{ blocks: [
          { type: 'text', content: '提示文本未国际化' },
          { type: 'image', ref: 'img-1' },
        ]}],
      }],
    };
    const service = new WebClipService(mockLlmConfig(mockProvider(llmResult)), testUploadsDir);

    const resp = await service.clip({
      sourceUrl: 'https://x.com/bug/1',
      title: 'Bug',
      content: { text: '审核判定页文本未国际化' },
      images: [{ name: 'img-1', base64: PNG_DATAURL }],
    });

    expect(resp.sourceUrl).toBe('https://x.com/bug/1');
    expect(resp.drafts).toHaveLength(1);
    expect(resp.drafts[0].title).toBe('审核页未国际化');
    const imgBlock = resp.drafts[0].steps[0].blocks!.find((b) => b.type === 'image');
    expect(imgBlock && imgBlock.type === 'image' && imgBlock.url).toMatch(/^\/api\/uploads\//);
  });

  it('should fallback to a single whole-task draft when LLM decompose throws', async () => {
    const badProvider: LlmProvider = {
      async *streamText(): AsyncIterable<StreamChunk> { yield { delta: '', done: true }; },
      async generateObject<T>(): Promise<T> { throw new Error('boom'); },
    };
    const service = new WebClipService(mockLlmConfig(badProvider), testUploadsDir);

    const resp = await service.clip({
      sourceUrl: 'https://x.com/bug/2',
      title: 'Title',
      content: { text: '一段内容' },
      images: [{ name: 'img-1', base64: PNG_DATAURL }],
    });

    expect(resp.drafts).toHaveLength(1);
    // 回退:所有图作为单任务步骤
    const blocks = resp.drafts[0].steps[0].blocks!;
    expect(blocks.some((b) => b.type === 'image')).toBe(true);
  });

  it('should throw friendly error when LLM not configured', async () => {
    const service = new WebClipService(mockLlmConfig(mockProvider({ drafts: [] }), false), testUploadsDir);
    await expect(service.clip({
      sourceUrl: 'u', title: 't', content: { text: 'x' },
    })).rejects.toThrow(/API Key/);
  });
});
