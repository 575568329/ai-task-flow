// backend/src/infrastructure/search/ArxivClient.ts
import type { Source } from '@ai-task-flow/shared';

interface ArxivEntry {
  id: string;
  title: string;
  summary: string;
  published: string;
  authors: string[];
}

/**
 * arXiv API 客户端（返回 XML,需解析）
 * API: http://export.arxiv.org/api/query?search_query=...
 * 官方限速 3 req/s
 */
export class ArxivClient {
  private lastRequestTime = 0;
  private readonly minInterval = 350; // 约 3 req/s

  async search(query: string, maxResults: number = 5): Promise<Source[]> {
    // 简单限速
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minInterval) {
      await new Promise(resolve => setTimeout(resolve, this.minInterval - elapsed));
    }
    this.lastRequestTime = Date.now();

    const searchQuery = `all:${encodeURIComponent(query)}`;
    const url = `http://export.arxiv.org/api/query?search_query=${searchQuery}&max_results=${maxResults}&sortBy=relevance&sortOrder=descending`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`arXiv API failed: ${response.status}`);
      }

      const xml = await response.text();
      const entries = this.parseArxivXML(xml);

      return entries.map((e, index) => ({
        index: index + 1,
        title: e.title,
        url: `https://arxiv.org/abs/${e.id.split('/abs/')[1]}`,
        snippet: e.summary.slice(0, 300) + (e.summary.length > 300 ? '...' : ''),
        sourceType: 'arxiv' as const,
        date: e.published.split('T')[0],
        authors: e.authors,
      }));
    } catch (error: any) {
      console.error('arXiv search failed:', error.message);
      return [];
    }
  }

  private parseArxivXML(xml: string): ArxivEntry[] {
    const entries: ArxivEntry[] = [];
    // 简单 regex 解析（生产应用用 DOMParser 或 fast-xml-parser）
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match;

    while ((match = entryRegex.exec(xml)) !== null) {
      const entry = match[1];
      const id = this.extractTag(entry, 'id');
      const title = this.extractTag(entry, 'title').replace(/\n\s+/g, ' ').trim();
      const summary = this.extractTag(entry, 'summary').replace(/\n\s+/g, ' ').trim();
      const published = this.extractTag(entry, 'published');

      const authors: string[] = [];
      const authorRegex = /<author>[\s\S]*?<name>(.*?)<\/name>[\s\S]*?<\/author>/g;
      let authorMatch;
      while ((authorMatch = authorRegex.exec(entry)) !== null) {
        authors.push(authorMatch[1].trim());
      }

      if (id && title) {
        entries.push({ id, title, summary, published, authors });
      }
    }

    return entries;
  }

  private extractTag(xml: string, tag: string): string {
    const regex = new RegExp(`<${tag}>(.*?)<\/${tag}>`, 's');
    const match = xml.match(regex);
    return match ? match[1] : '';
  }
}
