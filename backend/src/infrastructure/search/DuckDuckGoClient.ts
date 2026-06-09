// backend/src/infrastructure/search/DuckDuckGoClient.ts
import { search as ddgSearch } from 'duck-duck-scrape';
import type { Source } from '@ai-task-flow/shared';

export class DuckDuckGoClient {
  async search(query: string, maxResults: number = 5): Promise<Source[]> {
    try {
      const results = await ddgSearch(query, {
        safeSearch: 'Off' as any, // duck-duck-scrape 类型定义过时，强制转换
      });

      return results.results
        .slice(0, maxResults)
        .map((r, index) => ({
          index: index + 1, // 临时编号,后续统一重编
          title: r.title,
          url: r.url,
          snippet: r.description || r.title,
          sourceType: 'web' as const,
        }));
    } catch (error: any) {
      console.error('DuckDuckGo search failed:', error.message);
      // 限流或失败不阻断,返回空
      return [];
    }
  }
}
