// shared/src/types/research.ts
// 资料调研聊天 Agent 前后端共享类型

export type ChatRole = 'user' | 'assistant';
export type SourceType = 'arxiv' | 'web';
export type MessageStatus = 'answering' | 'completed' | 'error';

export interface Source {
  index: number;          // 引用编号 [1..N]
  title: string;
  url: string;
  snippet: string;        // 摘要(截断)
  sourceType: SourceType;
  date?: string;          // 发表/抓取日期
  authors?: string[];     // 论文作者
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;        // assistant 正文含 [n] 引用标记
  sources?: Source[];     // 仅 assistant
  status?: MessageStatus; // 仅 assistant
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  /** 该对话的自定义需求(系统提示追加),每个对话独立,后续每轮都会带上 */
  customPrompt?: string;
  createdAt: string;
  updatedAt: string;
}

// Agent 配置: LLM 与 搜索 分两段
export type LlmProviderKind = 'openai-compatible' | 'glm';

export interface LlmConfig {
  provider: LlmProviderKind;
  baseURL: string;
  apiKey: string;
  model: string;
}

export interface SearchConfig {
  provider: 'tavily' | 'duckduckgo';
  tavilyApiKey?: string;
  semanticScholarApiKey?: string;
  enableArxiv: boolean;
}

export interface ChatConfig {
  llm: LlmConfig;
  search: SearchConfig;
}

// SSE 事件类型（借鉴 Vercel + Perplexica）
export type SSEEventType = 'progress' | 'source' | 'text-delta' | 'done' | 'error';

export interface SSEProgressEvent {
  type: 'progress';
  content: 'classifying' | 'rewritten' | 'searching' | 'found' | 'writing' | 'degraded' | 'no_results';
  output: string;        // 中文文案
  metadata?: string[];   // URL 或 query 数组
}

export interface SSESourceEvent {
  type: 'source';
  sources: Source[];
}

export interface SSETextDeltaEvent {
  type: 'text-delta';
  delta: string;
}

export interface SSEDoneEvent {
  type: 'done';
  messageId: string;
  sources: Source[];
}

export interface SSEErrorEvent {
  type: 'error';
  message: string;
}

export type SSEEvent = SSEProgressEvent | SSESourceEvent | SSETextDeltaEvent | SSEDoneEvent | SSEErrorEvent;

// 分类结果（抄 Perplexica classifier.ts）
export interface ClassificationResult {
  skipSearch: boolean;
  academicSearch: boolean;
  standaloneQuery: string;
  searchQueries: string[];  // 最多 3 条
}
