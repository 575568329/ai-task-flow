// backend/src/infrastructure/search/GlmWebSearchClient.ts
// 智谱 GLM 官方 Web Search（MCP 端点 web_search_prime）网页检索客户端。
//
// 背景:原 DuckDuckGoClient 因 (1) duck-duck-scrape 库 VQD 反爬失效、
// (2) DuckDuckGo 在国内网络不可达,已彻底拿不到结果。改用智谱官方 MCP
// 搜索端点——复用用户已配置的 bigmodel apiKey,境内可访问、返回结构化结果。
//
// 协议要点(经实测锁定):
//   - 必须走标准 MCP 握手:先 initialize 拿 Mcp-Session-Id,
//     再带 session id 调 tools/call,否则鉴权随机 401。
//   - 响应是 SSE 帧(id/event/data 三行),需取末行 data: 后的 JSON。
//   - tools/call 结果是「二层 JSON」:result.content[0].text 本身又是
//     一个 JSON 字符串,parse 后才是 [{title,link,content,refer}] 数组。
import type { Source } from '@ai-task-flow/shared';

const MCP_ENDPOINT = 'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp';

/** MCP 工具返回的单条结果(web_search_prime 的 text 内层结构) */
interface GlmSearchItem {
  title: string;
  link: string;
  content: string;
  refer?: string;
}

/**
 * 修正 GLM 返回的「双重编码」URL。
 * 智谱部分结果把 link 编码了两次,如维基/百科:
 *   %25E8%2594 (错) 应为 %E8%94 (对) —— %25 是 `%` 自身的编码。
 * 检测到 link 含 `%25` 时解码一次还原,否则原样返回。
 * 解码失败(畸形 URL)时回退原值,绝不抛错。
 */
function fixDoubleEncodedUrl(url: string): string {
  if (typeof url !== 'string' || !url.includes('%25')) return url;
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

/**
 * 从 SSE 响应文本中提取最后一帧 `data:` 后的 JSON 对象。
 * 智谱 MCP 每个响应形如:
 *   id:1\n event:message\n data:{...}\n\n
 */
function parseSseData(raw: string): any | null {
  // 逐行找 data: 前缀,取最后一个非空 data 帧
  const lines = raw.split(/\r?\n/);
  let lastData: string | null = null;
  for (const line of lines) {
    if (line.startsWith('data:')) {
      const payload = line.slice(5).trim();
      if (payload) lastData = payload;
    }
  }
  if (!lastData) return null;
  try {
    return JSON.parse(lastData);
  } catch {
    return null;
  }
}

export class GlmWebSearchClient {
  /**
   * @param getApiKey 实时获取当前生效的 bigmodel apiKey(支持热更新;
   *                  不缓存,每次检索取最新值)。
   */
  constructor(private readonly getApiKey: () => string) {}

  async search(query: string, maxResults: number = 6): Promise<Source[]> {
    const apiKey = this.getApiKey().trim();
    if (!apiKey) {
      console.warn('GlmWebSearchClient: apiKey 为空,跳过检索');
      return [];
    }

    try {
      // 1. MCP 握手:initialize 拿 session id
      const sessionId = await this.initialize(apiKey);
      if (!sessionId) {
        console.error('GlmWebSearchClient: 未取得 Mcp-Session-Id,跳过检索');
        return [];
      }

      // 2. tools/call 执行搜索
      const items = await this.callSearch(apiKey, sessionId, query);

      // 3. 映射为 Source(index 临时占位,SearchOrchestrator 会统一重编号)
      return items.slice(0, maxResults).map((item, i) => {
        const url = fixDoubleEncodedUrl(item.link);
        return {
          index: i + 1,
          title: item.title || url,
          url,
          snippet: item.content || item.title || '',
          sourceType: 'web' as const,
        };
      });
    } catch (error: any) {
      console.error('GlmWebSearchClient search failed:', error?.message ?? error);
      // 检索失败不阻断主流程,返回空(与原 DuckDuckGoClient 行为一致)
      return [];
    }
  }

  /** MCP initialize 握手,返回响应头里的 Mcp-Session-Id */
  private async initialize(apiKey: string): Promise<string | null> {
    const res = await fetch(MCP_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'ai-task-flow', version: '0.1.0' },
        },
      }),
    });
    // session id 在响应头(大小写不敏感)
    return res.headers.get('mcp-session-id');
  }

  /** 带 session id 调 tools/call,解析二层 JSON 拿到结果数组 */
  private async callSearch(
    apiKey: string,
    sessionId: string,
    query: string,
  ): Promise<GlmSearchItem[]> {
    const res = await fetch(MCP_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${apiKey}`,
        'Mcp-Session-Id': sessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'web_search_prime',
          arguments: {
            search_query: query.slice(0, 70), // 官方建议 query ≤ 70 字符
            content_size: 'medium',
          },
        },
      }),
    });

    const raw = await res.text();
    const envelope = parseSseData(raw);
    if (!envelope) return [];

    if (envelope.error) {
      throw new Error(`MCP error: ${envelope.error.message ?? JSON.stringify(envelope.error)}`);
    }

    const content = envelope.result?.content;
    if (!Array.isArray(content) || content.length === 0) return [];

    // 服务端用 isError 标记业务失败(如鉴权/限流),text 是错误说明
    if (envelope.result.isError) {
      throw new Error(`MCP tool error: ${content[0]?.text ?? 'unknown'}`);
    }

    const text = content[0]?.text;
    if (typeof text !== 'string') return [];

    // 智谱把结果做了「双重 JSON 编码」:text 解一次仍是 JSON 字符串,
    // 需再解一次才是数组。层数实测为 3,但用循环解包兼容 2/3 层两种情况:
    // 只要解出来还是 string 就继续 parse,直到拿到数组或失败。
    let inner: unknown = text;
    for (let depth = 0; depth < 3 && typeof inner === 'string'; depth++) {
      try {
        inner = JSON.parse(inner);
      } catch {
        return [];
      }
    }
    if (!Array.isArray(inner)) return [];

    return (inner as GlmSearchItem[]).filter((it) => it && it.link);
  }
}
