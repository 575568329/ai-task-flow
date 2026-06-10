// backend/src/application/research/SearchOrchestrator.ts
import type { Source, ClassificationResult } from '@ai-task-flow/shared';
import { DuckDuckGoClient } from '../../infrastructure/search/DuckDuckGoClient.js';
import { ArxivClient } from '../../infrastructure/search/ArxivClient.js';

/**
 * 搜索编排器（抄 Perplexica researcher/index.ts）
 * 并行检索 + URL 去重（同 URL 合并内容）
 */
export class SearchOrchestrator {
  constructor(
    private readonly ddgClient: DuckDuckGoClient,
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

    // 网页源（DDG 兜底，后续加 Tavily）
    promises.push(
      ...queries.map((q: string) => this.ddgClient.search(q, 3)),
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
