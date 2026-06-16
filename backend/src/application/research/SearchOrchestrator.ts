// backend/src/application/research/SearchOrchestrator.ts
import type { Source, ClassificationResult } from '@ai-task-flow/shared';
import { ArxivClient } from '../../infrastructure/search/ArxivClient.js';

/** 网页检索源的最小契约,便于替换实现(GLM / 其他) */
export interface WebSearchProvider {
  search(query: string, maxResults?: number): Promise<Source[]>;
}

/**
 * 搜索编排器（抄 Perplexica researcher/index.ts）
 * 并行检索 + URL 去重（同 URL 合并内容）
 */
export class SearchOrchestrator {
  constructor(
    private readonly webClient: WebSearchProvider,
    private readonly arxivClient: ArxivClient,
  ) {}

  async search(
    classification: ClassificationResult,
    maxSources: number = 6,
  ): Promise<Source[]> {
    const queries = classification.searchQueries;
    const promises: Promise<Source[]>[] = [];

    // 论文源
    if (classification.academicSearch) {
      promises.push(
        ...queries.map((q: string) => this.arxivClient.search(q, 3)),
      );
    }

    // 网页源（GLM 官方 MCP 搜索）
    promises.push(
      ...queries.map((q: string) => this.webClient.search(q, 3)),
    );

    const results = await Promise.all(promises);
    const allSources = results.flat();

    // URL 去重+内容合并（抄 Perplexica researcher/index.ts）
    const seenUrls = new Map<string, Source>();

    for (const source of allSources) {
      const existing = seenUrls.get(source.url);
      if (existing) {
        // 同 URL 合并内容
        existing.snippet += `\n\n${source.snippet}`;
      } else {
        seenUrls.set(source.url, source);
      }
    }

    // 重编号 [1..N]，限制数量
    const dedupedSources = Array.from(seenUrls.values()).slice(0, maxSources);
    return dedupedSources.map((s, index) => ({ ...s, index: index + 1 }));
  }
}
