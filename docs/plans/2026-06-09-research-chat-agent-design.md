# 资料调研聊天 Agent — 设计文档

> 状态：设计已确认（含竞品源码级评审），待转实施计划
> 日期：2026-06-09
> 关联 skill：superpowers:brainstorming → superpowers:writing-plans
> 评审基准：Perplexica/Vane（源码级）、GPT Researcher、MindSearch、Vercel AI SDK 流式协议

## 文档导读

- 第 1~3 节：目标、范围、关键决策
- 第 4 节：**竞品源码级评审**（Perplexica 逐文件拆解 + 我们的取舍）——本次新增，最重要
- 第 5~13 节：架构、数据流、数据模型、API、错误处理、样式、测试、目录
- 第 14 节：**用户体验设计**（每条有竞品代码依据）——本次新增
- 附：实施任务概览

---

## 一、目标与定位

在现有「AI Task Flow 看板」中新增一个 **资料调研型聊天 Agent**，核心是**检索增强 + 带引用溯源**，而非普通闲聊。

**一句话定位**：用户提问 → 后端先联网检索（含论文）→ 把真实资料喂给大模型 → 模型基于资料回答，并在论断处标注可点击的引用来源 → 可把结果整理导出为带引用的 Markdown。

**核心价值**：用 WebSearch 提高回答的事实准确性，每个关键论断都能溯源到具体网址/论文，降低大模型幻觉。

---

## 二、范围（YAGNI）

### MVP 包含
- 多对话管理（会话列表 / New Chat / 历史 / 删除 / 自动命名）
- 持续多轮对话（保留上下文）
- 检索前「分类+改写」：判断是否需检索，把多轮问题改写成独立 query
- 联网检索增强：Tavily（主力，可填 key）+ DuckDuckGo（兜底，无 key）+ arXiv（论文）
- 检索进度实时可视化（思考过程区：改写词 → 检索中 → 找到 N 篇）
- 带引用角标 `ⁿ` + 右侧溯源面板（标题/摘要/来源/链接/日期）
- 引用编号合法性校验（剥除越界 `[n]`）
- 流式输出（SSE 逐字）+ 停止生成 + 重新回答
- 导出会话/单条回答为带引用脚注的 Markdown 到 `docs/research/`
- 页面可配置 Agent：LLM（OpenAI 兼容 / GLM 预设）+ 搜索（Tavily key 可选）+ 测试连接
- 应用级左侧导航栏，在「任务看板」与「资料调研」间切换

### MVP 不包含（留架构口子，后续做）
- MCP 工具暴露（ChatService 复用同一份 JSON，后续加 MCP 即可）
- Skill 集成
- 多模态附件（图片/文件上传）
- 多轮迭代检索（Perplexica quality 模式的 5-6 轮 agent 循环）——MVP 用单轮
- 嵌入向量 rerank（需 embedding provider）——MVP 用频次+顺序
- 点赞点踩、`speed/balanced/quality` 三档
- 用户鉴权（沿用现有 MVP「仅本地可信网络」前提）

---

## 三、关键决策（已与用户确认 + 竞品评审修正）

| 分叉点 | 决策 | 理由 |
|--------|------|------|
| LLM 调用架构 | **后端代理** | 避免浏览器 CORS、key 不暴露、WebSearch 注入与引用编号在后端最干净 |
| 会话存储 | **后端 JSON**（`~/.ai-task-flow/chats.json`） | 与 tasks 一套体系；可跨设备、可导出、可被后续 MCP 复用 |
| 页面入口 | **应用级左侧导航栏切换**（非路由） | 改动小、不引入 react-router 依赖、体验统一 |
| Provider 抽象 | **统一 OpenAI 兼容格式，GLM 做预设** | OpenAI/DeepSeek/Moonshot/GLM 的 chat completions 同构，一套 SSE 解析即可 |
| 联网开关默认 | **默认开** | 联网检索是本功能的核心价值 |
| **搜索源（评审修正）** | **Tavily 主力（可填 key）+ DDG 兜底（无 key）+ arXiv 论文源** | 见 §4.2：DDG 非官方抓取并发即限流，不能当主力；Tavily 专为 LLM 返回干净 snippet |
| **检索前置（评审新增）** | **一次「分类+改写」LLM 调用**：判断是否需检索 + 把多轮问题改写成独立 query | Perplexica `classifier.ts` 实证：合成一次调用，省一次往返 |
| **引用机制（评审确认）** | **LLM 输出 `[n]` 标记 → 前端正则替换成可点角标** | Perplexica `useChat.tsx` `citationRegex` 实证，主流做法 |
| **流式协议（评审修正）** | **借鉴 Vercel part 分型**：`text-delta`/`source`/`progress`/`done`/`error` 带 `type` 字段 | 比原四类固定事件更可扩展，§4.3 |
| **检索去重（评审新增）** | **按 URL 去重，同 URL 内容合并而非丢弃** | Perplexica `researcher/index.ts` `seenUrls` 实证 |

---

## 四、竞品源码级评审（本次新增，最重要）

调研了三个开源「带引用的研究 Agent」+ Vercel 流式协议，**逐文件读了 Perplexica（现名 Vane）源码**，把可落地的具体方案抄进我们的设计。下面每条都标注了来源文件，不是泛泛而谈。

### 4.1 三个竞品的定位差异

| 项目 | 架构 | 适合借鉴的点 | 不适合我们的点 |
|------|------|------------|--------------|
| **Perplexica/Vane** | Next.js 单体，分类→检索→写作三段 | 分类+改写 prompt、引用正则、去重、断线重连，**源码全开** | 绑 SearxNG（要自建）、绑 Next.js |
| **GPT Researcher** | Python，planner→crawler→publisher | 进度日志事件模型（`content/output/metadata`） | 多 agent 重型、WebSocket、Python |
| **MindSearch** | planner 构建 DAG 分解子问题 | 思路（复杂问题拆子查询） | 太重，MVP 不做 DAG |

> 实证：搜索源现状（[Firecrawl 2026 评测](https://www.firecrawl.dev/blog/best-search-tools-for-agents)）+ DDG 限流（[open-webui #9504](https://github.com/open-webui/open-webui/issues/9504)、[local-deep-research #18](https://github.com/LearningCircuit/local-deep-research/issues/18)）。

### 4.2 搜索源策略（原设计推翻重来）

**原设计问题**：「arXiv + Semantic Scholar + DDG 全程无 key」看着零配置，但实测会经常空手——`duck-duck-scrape` 是非官方抓取，几个并发就触发 202/429；S2 匿名共享池限流极严；这恰好砸了「提高准确性」的核心卖点。

**修正方案（可插拔 Provider）**：
- **通用网页**：默认 **Tavily**（1000 次/月免费、专为 LLM 返回干净 snippet）。**没配 key 时降级用 DDG 兜底**（不当主力，且做厚降级/限流处理）。
- **论文**：**arXiv API**（无 key，返回 XML 需解析）。Semantic Scholar 改为**配置里可选填 key**（填了才启用）。
- Perplexica 的做法是全交给 SearxNG 的 `engines: ['arxiv','google scholar','pubmed']`（见 `academicSearch.ts`），但那要自建 SearxNG，我们直连 arXiv 官方 API 更轻。

### 4.3 流式协议（借鉴 Vercel + Perplexica 实证）

**Vercel AI SDK** 把消息流拆成带 `type` 的多种 part（[stream-protocol 文档](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)）：`text-delta` / `source-url` / `data-*`(自定义) / `finish` / `error`。

**Perplexica 的实证更具体**（`useChat.tsx` + `session`）：它用 **block + JSON Patch** 模型——
- 后端 `emitBlock({id, type:'text'|'source'|'research', data})` 推整块
- 增量更新走 `updateBlock(id, [{op:'replace', path:'/data', value}])`（rfc6902 JSON Patch）
- 前端 `applyPatch(block, patch)` 打补丁，React 重渲染
- 消息类型：`block`（新块）/ `updateBlock`（增量）/ `researchComplete` / `messageEnd` / `error`

**我们的取舍**：MVP 不引入 JSON Patch 的复杂度（那是为了支持任意块乱序更新）。**采用 Vercel 的 part 分型 + Perplexica 的块类型语义**，固定顺序流：

```
data: {"type":"progress","content":"classifying","output":"🔍 正在理解问题…"}
data: {"type":"progress","content":"rewritten","output":"检索词：扩散模型 视频生成 2025"}
data: {"type":"progress","content":"searching","output":"⟳ 检索 arXiv…","metadata":["q1"]}
data: {"type":"progress","content":"found","output":"✓ 找到 8 篇","metadata":["url1"]}
data: {"type":"source","sources":[{"index":1,"title":"...","url":"...",...}]}
data: {"type":"text-delta","delta":"扩散模型"}
data: {"type":"text-delta","delta":"在视频生成"}
data: {"type":"done","messageId":"...","sources":[...]}
data: {"type":"error","message":"调用大模型失败: ..."}
```

`progress` 的 `{content,output,metadata}` 结构直接抄 **GPT Researcher 的日志事件**（[all-about-logs](https://docs.gptr.dev/docs/gpt-researcher/handling-logs/all-about-logs)）：`content` 机器可读状态码，`output` 给人看的中文文案，`metadata` 带 URL/query 数组。

### 4.4 分类 + 查询改写（直接落地 Perplexica `classifier.ts`）

Perplexica 用**一次** `generateObject`（结构化输出）同时完成「判断是否检索」+「改写成独立问题」。我们简化它的 schema（去掉 widget/personal/discussion）：

```ts
// 我们的 classifier schema（精简自 Perplexica classifier.ts）
const schema = z.object({
  skipSearch: z.boolean(),      // 寒暄/常识/纯写作 → true 跳过检索
  academicSearch: z.boolean(),  // 明确要论文/研究 → true 启用 arXiv
  standaloneQuery: z.string(),  // 把"那它的复杂度呢"改写成独立问题
  searchQueries: z.array(z.string()).max(3), // SEO 关键词式检索词,非整句
});
```

**关键实证**（Perplexica `webSearch.ts` 的 prompt）：检索词要 **SEO 关键词式**而非整句——"GPT-5.1 features" 而非 "Tell me about GPT-5.1"，一次最多 3 条。这个细节直接写进我们的 prompt。

`skipSearch` 的判定规则也抄它：寒暄、纯写作、常识题 → 跳过检索（省一次无意义搜索 + 直接答）；**不确定时一律 false（去搜）**。

### 4.5 引用渲染（直接落地 Perplexica `useChat.tsx`）

Perplexica 的引用是「**模型输出 `[n]` → 前端正则替换**」，核心代码：

```ts
const citationRegex = /\[([^\]]+)\]/g;       // 匹配 [1] [1,2] 等
processedText.replace(citationRegex, (_, captured) => {
  const numbers = captured.split(',').map(s => s.trim());
  return numbers.map(numStr => {
    const number = parseInt(numStr);
    if (isNaN(number) || number <= 0) return `[${numStr}]`; // 非数字原样
    const source = sources[number - 1];                      // 编号→来源
    return source?.metadata?.url
      ? `<citation href="${url}">${numStr}</citation>`        // 渲染成角标
      : ``;                                                   // 越界 → 剥除
  }).join('');
});
```

**我们直接采用**：① `[n]`/`[n,m]` 都支持；② 编号映射到 `sources[n-1]`；③ **越界编号剥除**（这就是我们说的「引用编号合法性校验」，Perplexica 在前端做，我们在前后端各做一层更稳）。

**写作 prompt** 也抄 Perplexica `writer.ts` 的引用要求：「每个事实/句子用 `[number]` 标注；多源用 `[1][2]`；无来源支撑要明说限制」。

### 4.6 检索去重（落地 Perplexica `researcher/index.ts`）

Perplexica 用 `seenUrls = Map<url, index>`：**重复 URL 不丢弃，而是把内容追加合并**到首次出现的那条（`existingResult.content += '\n\n' + result.content`）。我们采用同款——同源多次命中时合并内容，比简单去重保留更多上下文。

> GPT Researcher 的「多源频次」去重（同信息多站点出现则可信）更进一步，但需要语义比对，列为 P2。

### 4.7 断线重连（Perplexica `checkReconnect` —— 列为 P1）

Perplexica 消息有 `status:'answering'|'completed'|'error'`，刷新页面时若最后一条还在 `answering`，调 `/api/reconnect/:backendId` 续上 SSE 流。**这是「生成中刷新不丢」的关键**，但 MVP 可先不做（生成中断就显示「重新回答」），列 P1。

### 4.8 评审结论汇总

| 抄什么 | 来源文件 | 落地到我们 | 优先级 |
|--------|---------|-----------|--------|
| 分类+改写一次调用 | `classifier.ts` | ChatService 检索前置步骤 | P0 |
| SEO 关键词式检索词 | `webSearch.ts` prompt | classifier prompt | P0 |
| 引用 `[n]` 正则渲染 | `useChat.tsx` | MessageBubble | P0 |
| 写作引用 prompt | `writer.ts` | ChatService 写作 prompt | P0 |
| URL 去重+内容合并 | `researcher/index.ts` | SearchOrchestrator | P0 |
| 进度事件 content/output/metadata | GPT Researcher logs | SSE `progress` part | P0 |
| Vercel part 分型 | AI SDK 文档 | SSE 协议 | P0 |
| 断线重连 | `checkReconnect` | 列 P1 | P1 |
| 多源频次去重 | GPT Researcher | 列 P2 | P2 |
| DAG 子问题分解 | MindSearch | 不做（太重） | — |

---

## 五、整体架构

新增后端限界上下文 `research`，与现有 `workflow` 平级，遵循同样的 DDD 四层。前端新增 `ChatView` 与应用级导航。

```
┌─────────────────────────────────────────────────────────────┐
│ 前端 (React + Tailwind + Spark Token)                         │
│  AppSidebar ──切换──> BoardView(现有看板) | ChatView(新增)     │
│  ChatView: 会话侧栏 + 消息流 + 溯源面板 + 输入框 + 配置弹窗     │
└───────────────┬─────────────────────────────────────────────┘
                │ POST /api/chat (SSE 流)  +  conversations CRUD
                ▼
┌─────────────────────────────────────────────────────────────┐
│ 后端 research 上下文 (DDD 四层)                                │
│                                                               │
│  interfaces/http   chatRoutes (SSE) + conversationRoutes      │
│        │                                                      │
│  application       ChatService                                │
│        ├─ 1. SearchOrchestrator: arXiv ∥ S2 ∥ DDG             │
│        │       → 去重 → 编号 [1..N] → Source[]                │
│        ├─ 2. 拼 RAG prompt(来源清单 + 历史 + 问题)            │
│        ├─ 3. LlmProvider 流式转发(OpenAI兼容/GLM)            │
│        └─ 4. SSE 事件: sources → delta* → done                │
│                                                               │
│  domain/research   Conversation / Message / Source 值对象      │
│  infrastructure                                               │
│        ├─ llm/      OpenAiCompatibleProvider                  │
│        ├─ search/   ArxivClient / SemanticScholarClient /     │
│        │            DuckDuckGoClient + SearchOrchestrator     │
│        └─ persistence/ JsonChatRepository                     │
└───────────────────────────────────────────────────────────────┘
                │ 读写
                ▼
   ~/.ai-task-flow/chats.json        (会话 + 消息)
   ~/.ai-task-flow/chat-config.json  (Agent 配置, key 不进 git/浏览器)
   <项目>/docs/research/*.md         (导出的调研文档)
```

---

## 六、数据流（一次提问的完整链路）

```
用户在输入框提问 "2025 年扩散模型在视频生成的进展"
   │
   ▼
POST /api/chat { conversationId, message, useWebSearch: true }
   │
   ▼ (后端 ChatService)
1. 持久化用户消息到 chats.json (status: 'answering')
2. 【分类+改写】一次 LLM generateObject (抄 Perplexica classifier.ts):
     → { skipSearch, academicSearch, standaloneQuery, searchQueries[≤3] }
     SSE: progress {content:'classifying', output:'🔍 正在理解问题…'}
     SSE: progress {content:'rewritten', output:'检索词：扩散模型 视频生成 2025'}
3. if !skipSearch → SearchOrchestrator 按 searchQueries 检索:
     - TavilyClient.search() (有 key) 否则 DuckDuckGoClient (兜底)
     - if academicSearch → ArxivClient.search()
     SSE: progress {content:'searching', output:'⟳ 检索网页…', metadata:[q]}
     去重(seenUrls, URL 相同则合并内容) → 编号 Source[1..N] (限 k≈5-8)
     SSE: progress {content:'found', output:'✓ 找到 6 篇高相关来源'}
4. SSE: source {sources:[...]}  (前端先渲染"N 篇内容来源")
5. 拼 RAG messages (抄 writer.ts 引用要求):
     system: "基于<context>回答,每个事实用 [n] 标注来源,多源 [1][2],
              无来源支撑要明说限制" + <context>[1]标题|摘要|URL ... </context>
     history: 该会话历史消息
     user: 当前问题(原话)
6. LlmProvider.streamText() → 逐 token:
     SSE: text-delta {delta:"扩散模型"}
7. 流结束 → 引用编号合法性校验(剥越界[n]) → 持久化(status:'completed')
     SSE: done {messageId, sources}
   (skipSearch 分支: 跳过 3-4,直接 5-7 无 context 纯模型回答)
   │
   ▼ (前端)
- 收 progress: 思考过程区逐行点亮(转圈→对勾)
- 收 source: 渲染消息头"N 篇内容来源 >"
- 收 text-delta: 逐字追加,正则把 [n] 渲染成上标角标 ⁿ(抄 useChat.tsx)
- 收 done: 思考过程自动收起,显示操作栏(复制/重答/导出)
- 点角标/溯源标签 → 右侧滑出溯源面板
- 收 error: AI 消息位显示失败 + 「重试」
```

---

## 七、数据模型

`shared/src/types/research.ts`（前后端共享）：

```ts
export type ChatRole = 'user' | 'assistant';
export type SourceType = 'arxiv' | 'web';   // S2 归入 web 或后续扩展
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
  status?: MessageStatus; // 仅 assistant; 'answering' 用于断线重连判断(P1)
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;          // 自动命名; 失败退化为首条用户消息前 N 字
  createdAt: string;
  updatedAt: string;
}

// Agent 配置: LLM 与 搜索 分两段
export type LlmProviderKind = 'openai-compatible' | 'glm';
export interface LlmConfig {
  provider: LlmProviderKind;
  baseURL: string;        // GLM 预设 https://open.bigmodel.cn/api/paas/v4
  apiKey: string;         // 后端存储; GET 时脱敏返回
  model: string;          // e.g. glm-4-plus / gpt-4o / deepseek-chat
}
export interface SearchConfig {
  provider: 'tavily' | 'duckduckgo';  // 默认 tavily; 无 key 自动 duckduckgo
  tavilyApiKey?: string;              // 可选; 不填则降级 DDG
  semanticScholarApiKey?: string;     // 可选; 填了才启用 S2
  enableArxiv: boolean;               // 论文源开关,默认 true
}
export interface ChatConfig {
  llm: LlmConfig;
  search: SearchConfig;
}
```

存储文件 `~/.ai-task-flow/chats.json`：

```json
{
  "conversations": [{ "id": "...", "title": "...", "createdAt": "...", "updatedAt": "..." }],
  "messages": [{ "id": "...", "conversationId": "...", "role": "...", "content": "...", "sources": [], "status": "completed", "createdAt": "..." }]
}
```

---

## 八、API 契约

| 方法 | 路径 | 入参 | 出参 | 说明 |
|------|------|------|------|------|
| GET | `/api/conversations` | — | `Conversation[]` | 会话列表 |
| POST | `/api/conversations` | `{ title? }` | `Conversation` | 新建会话 |
| DELETE | `/api/conversations/:id` | — | 204 | 删会话(连带消息) |
| GET | `/api/conversations/:id/messages` | — | `ChatMessage[]` | 某会话消息 |
| POST | `/api/chat` | `{ conversationId, message, useWebSearch }` | **SSE 流** | 核心:分类+检索+流式回答 |
| POST | `/api/conversations/:id/export` | `{ messageId? }` | `{ path }` | 导出 md 到 docs/research/ |
| GET | `/api/chat-config` | — | `ChatConfig`(key 脱敏) | 读 Agent 配置 |
| PUT | `/api/chat-config` | `ChatConfig` | `ChatConfig`(key 脱敏) | 存 Agent 配置 |
| POST | `/api/chat-config/test` | `{ target: 'llm'\|'search' }` | `{ ok, message }` | 测试连接(实测一次最小请求) |

### `/api/chat` SSE 事件协议（part 分型，抄 Vercel + GPT Researcher）

所有事件统一 `data: {json}\n\n`，靠 `type` 字段区分（不用 SSE `event:` 名，前端按 `type` switch，与 Perplexica `useChat` 一致）：

```
// 进度(可多条) —— content 机器码 / output 中文文案 / metadata URL或query数组
data: {"type":"progress","content":"classifying","output":"🔍 正在理解问题…"}
data: {"type":"progress","content":"rewritten","output":"检索词：扩散模型 视频生成 2025"}
data: {"type":"progress","content":"searching","output":"⟳ 检索网页…","metadata":["扩散模型 视频生成"]}
data: {"type":"progress","content":"found","output":"✓ 找到 6 篇高相关来源"}

// 来源(检索完成,一次性推) —— 前端据此渲染"N 篇内容来源"
data: {"type":"source","sources":[{"index":1,"title":"...","url":"...","snippet":"...","sourceType":"arxiv"}]}

// 正文增量(逐 token)
data: {"type":"text-delta","delta":"扩散模型"}

// 结束
data: {"type":"done","messageId":"...","sources":[...]}

// 失败
data: {"type":"error","message":"调用大模型失败: 401 invalid api key"}
```

`progress.content` 状态码枚举：`classifying`/`rewritten`/`searching`/`found`/`writing`/`degraded`(降级用 DDG)/`no_results`(检索为空)。

---

## 九、错误处理

| 场景 | 处理 |
|------|------|
| Tavily 限流/失败 | 降级 DDG 兜底,SSE `progress {content:'degraded'}` 告知前端挂"免费搜索"标签 |
| 检索全失败/为空 | SSE `progress {content:'no_results'}`,正文提示"未检索到资料,以下为模型已有知识" |
| arXiv XML 解析失败 | 跳过论文源,日志记录,不阻断网页结果 |
| 大模型调用失败(key 错/网络) | SSE `error`,前端 AI 消息位显示失败 + 「重试」按钮(Ai_chat.md 第 236 行) |
| 分类调用失败 | 降级为"默认需检索 + 用原话当 query",不阻断主流程 |
| 未配置 Agent | 发送前前端校验弹配置弹窗;后端 400 返回明确文案 |
| DDG 限流(已知风险) | `duck-duck-scrape` 加重试+退避,仍失败则空结果走 no_results;不作主力 |
| 流式中断/用户停止 | 已生成内容保留,持久化已有部分(status 留 answering),显示「重新回答」 |
| 引用编号越界 | 前后端各一层:正文 `[n]` 若 n 越界则剥除(抄 useChat.tsx 逻辑) |

所有后端检索/调用关键节点写日志到文件（遵循项目 CLAUDE.md「前后端都需日志，保存到文件」）。

---

## 十、样式落地（Spark-design）

技术栈是 React + Tailwind v4 + 自建 ui 组件，**不引入 Element Plus**（那是 Vue 规范）。落地方式：

1. **设计 Token**：引入 `Spark-design/assets/root.scss` 的色板 / 字体 / 间距 / 圆角 / 阴影作为**唯一色值来源**，禁止硬编码 `#xxx`。与现有 `--bg-bottom / --text-1` 等 Token 对齐或合并。
2. **布局严格照 `references/Ai_chat.md`**：
   - 会话侧栏宽 240px，底部用户区 h:56px
   - 对话区 max-w 800px 水平居中
   - 用户气泡：右对齐、max-w 70%、主色背景、白字、圆角 12px
   - AI 消息：左对齐、头像 32px、角色名 14px/500、「N 篇内容来源 >」标签、正文行高 1.8、引用角标上标圆形
   - 溯源面板：右侧滑入 320px、覆盖层形式（不压缩对话区）、悬停角标对应来源高亮
   - 底部输入框：圆角 12px、h:104px、内侧工具栏（🌐联网开关）、右下发送/停止圆形按钮 32px
3. **动效**：内容淡入上移 300ms；AI 逐字流式；溯源面板右滑 250ms（对应 Ai_chat.md 第 267 行动效规范）。
4. **禁止事项**（Ai_chat.md 第 276 行）：生成中发送按钮变停止、生成完成前不显示操作栏、溯源面板不压缩对话区、不省略失败重试入口。

---

## 十一、测试策略

- **单元（domain/application）**：Source 编号去重+合并逻辑、分类输出 schema 校验、RAG prompt 拼装、引用 `[n]` 越界剥除、ChatConfig 脱敏
- **集成（infrastructure）**：JsonChatRepository 增删查、各 SearchClient 解析（mock HTTP 响应）、OpenAI 兼容 SSE 解析、分类 generateObject 解析
- **E2E（curl）**：conversations CRUD、`/api/chat` SSE 流（验证 progress/source/text-delta/done 事件顺序）、chat-config 读写脱敏、test 连接
- 沿用项目 vitest + tests/curl/ 约定

---

## 十二、用户体验设计（每条有竞品实证）

从 Perplexica/GPT Researcher 验证的**实战 UX 模式**,按交互成本排优先级（少等>少点>少猜>少配）：

### P0（MVP 必做，直接决定好不好用）

| 功能 | 实现细节 | 竞品实证 |
|------|--------|---------|
| **检索进度可视化** | 思考过程区（Ai_chat.md 第 206 行）逐行点亮,按 SSE `progress.content` 切转圈/对勾:<br>「🔍 问题理解中… → ✓ 检索词:… → ⟳ 检索 arXiv… → ✓ 找到 8 篇 → ⟳ 整理来源… → ✓ 开始作答」<br>完成后自动收起成一行摘要「已深度思考,用时 N 秒」 | GPT Researcher `progress` 事件 + Perplexica `research` block 子步骤 |
| **自动滚动+回顶浮标** | 用户在底部→跟随滚动;上滑→停止跟随,显示「↓ 回到最新」浮标<br>判定:窗口底部距 scrollHeight < 100px 为"在底部" | Perplexica 前端滚动逻辑(标准聊天 UI 模式) |
| **停止/重答/复制三件套** | 生成中发送按钮变「停止」(Ai_chat.md 第 228 行)<br>AI 消息下方:「复制(带引用/纯文本)」「重新回答」「导出」<br>停止后保留已生成内容,`status:'answering'` 保留,显示「重新回答」入口 | Perplexica `rewrite(messageId)` + `status` 判断 |
| **测试连接按钮** | AgentConfigModal 填完 LLM/搜索配置,点「测试连接」→ `/api/chat-config/test` 发最小请求<br>绿勾「✓ LLM 可用」/红叉「✗ 401 invalid key」实时反馈<br>阻止「配置错但发送后才知道」 | Perplexica `checkConfig` 预检 provider 可用性 |
| **引导态（空会话）** | 未配 Agent 或空会话列表时,中央显示引导卡片:「先配置一个 AI Agent」+按钮<br>而非让用户对着空输入框发消息后报错 | Perplexica `hasError/isReady` 状态门控 |
| **降级告知（不静默）** | 检索降级 DDG 时,回答头部挂标签「⚠ 免费搜索模式,配置 Tavily 可提升」<br>检索全失败时,正文前置「ℹ️ 未检索到资料,以下为模型已有知识」<br>让用户清楚答案的可信度来源,不要静默掉链 | 设计原则(Perplexica 有 widget/source 分离但未显式降级标记,我们补上) |
| **空/错/载三态** | 空会话列表→引导文案<br>检索/生成失败→AI 消息位显示失败原因+「重试」<br>首屏→骨架屏(头像圆+3 行灰条 shimmer)<br>生成中→末尾光标闪烁 | Spark `components/feedback.md` + Perplexica 错误处理 |

### P1（锦上添花，用户会感知但不影响核心流程）

| 功能 | 实现细节 | 竞品实证 |
|------|--------|---------|
| **引用悬停预览** | `<citation>` 角标鼠标悬停弹小卡片(title+来源+1 句摘要+链接)<br>想看全部再点开右侧溯源面板,少一次点击 | Perplexity 实测体验(Perplexica 未做,但 Perplexity 有) |
| **会话自动命名** | 首条回答结束后,用一次极小 LLM 调用浓缩成 6-12 字标题<br>失败退化为「用户首句前 20 字」<br>不让用户手动起名 | Perplexica `getSuggestions` 同款轻量调用(我们改为命名) |
| **推荐追问** | 回答末尾给 2-3 个相关追问 chip,点击即填入并发送<br>prompt 让模型多输出 `followUpQuestions` 字段 | Perplexica `suggestion` block + `getSuggestions` |
| **键盘流** | Enter 发送、Shift+Enter 换行、`Ctrl/Cmd+K` 新对话<br>调研型用户打字多,提效明显 | 标准聊天 UI 约定 |
| **联网开关记忆** | 用户关了联网,localStorage 记住,刷新后仍是关的 | Perplexica `sources` 存 localStorage |
| **断线重连** | 消息 `status:'answering'` 时刷新→调 `/api/reconnect/:backendId` 续上 SSE 流<br>「生成中刷新不丢」 | Perplexica `checkReconnect` + `backendId` + 消息重放 |

### 不做（过度设计或成本>收益）

- 推荐问题自动触发（Perplexica 有,但 MVP 保持简单,点了再发）
- 图片/视频搜索（Perplexica 的 media search,需额外 API）
- TTS 语音播报（Perplexica 的 speechMessage,调研场景用不上）
- `speed/balanced/quality` 三档（Perplexica 有,但 MVP 固定一档即可）

---

## 十三、目录结构（新增部分）

```
shared/src/types/research.ts            # 共享类型

backend/src/
├── domain/research/
│   ├── entities/            Conversation.ts / ChatMessage.ts
│   ├── value-objects/       Source.ts / ClassificationResult.ts
│   └── repositories/        ChatRepository.ts (接口)
├── application/research/
│   ├── ChatService.ts       (检索→RAG→流式→持久化 主编排)
│   ├── ClassifierService.ts (分类+改写,抄 Perplexica classifier.ts)
│   └── SearchOrchestrator.ts(多源并行+去重)
├── infrastructure/
│   ├── llm/                 LlmProvider.ts(接口) / OpenAiCompatibleProvider.ts
│   ├── search/              TavilyClient.ts / DuckDuckGoClient.ts / ArxivClient.ts
│   └── persistence/         JsonChatRepository.ts / chatExport.ts(md 导出)
└── interfaces/http/routes/  chatRoutes.ts / conversationRoutes.ts / chatConfigRoutes.ts

frontend/src/
├── components/
│   ├── AppSidebar.tsx               # 应用级导航(看板/调研切换)
│   ├── chat/ChatView.tsx            # 调研主视图
│   ├── chat/ConversationList.tsx    # 会话侧栏
│   ├── chat/MessageList.tsx         # 消息流
│   ├── chat/MessageBubble.tsx       # 用户/AI 气泡(引用角标)
│   ├── chat/SourcePanel.tsx         # 右侧溯源面板
│   ├── chat/ChatInput.tsx           # 底部输入框(联网开关)
│   └── chat/AgentConfigModal.tsx    # Agent 配置弹窗
├── stores/chatStore.ts              # 会话/消息/流式状态
├── api/chat.ts                      # conversations + chat-config 封装
└── api/chatStream.ts                # /api/chat SSE 流式客户端
└── styles/spark-tokens.css          # 引入/对齐 Spark root.scss Token
```

---

## 十四、依赖新增

| 包 | 用途 | 位置 |
|----|------|------|
| `eventsource-parser` | 解析大模型返回的 SSE 流（备注:后端解析 LLM → 前端,不是前端解析） | backend |
| `duck-duck-scrape` | DuckDuckGo 无 key 检索（风险:非官方抓取,兜底用） | backend |
| `zod` | 分类输出结构化 schema(generateObject) | backend(已有) |
| `tavily` | Tavily 官方 SDK（可选,直接 fetch 也行） | backend |

前端 SSE 用浏览器原生 `fetch` + `ReadableStream`（POST 不能用 EventSource，需手动读流），无新依赖。arXiv API 用 `fetch` + XML 解析（内置 DOMParser 或 fast-xml-parser）。

---

## 十五、待实施确认项

1. **Tavily 是否用官方 SDK 还是直接 fetch**  
   - 官方 `@tavily/core` 很薄,只封了 `search(query, options)`,我们直接 `fetch('https://api.tavily.com/search', {body})` 也行,零依赖。实施时看哪个更清晰。
2. **Spark `root.scss` Token 合并策略**  
   - 倾向**增量引入 Spark Token**（`--sp-color-primary` / `--sp-spacing-4` 等）、保留现有看板 `--bg-bottom / --text-1` 不动。实施时先对比冲突再定。
3. **GLM 默认 model**  
   - `glm-4-plus`（质量）vs `glm-4-flash`（便宜）。配置弹窗给 `glm-4-plus` 默认，用户可改。
4. **断线重连是否进 MVP**  
   - 实现成本低(Perplexica 已验证),但可后置 P1——MVP 先显示「重新回答」兜底。
5. **自动命名的 LLM 调用是否复用配置的主模型**  
   - 是（零额外配置）。失败不阻断,退化为「用户首句前 20 字」。

---

## 附：实施任务概览（详见后续 writing-plans 实施计划）

```
后端 research 上下文
- P0 依赖 + research 目录骨架
- P0 Source/Conversation/ChatMessage 模型 + JsonChatRepository
- P0 LlmProvider 抽象 + OpenAI兼容/GLM 适配(流式)
- P0 SearchOrchestrator: arXiv + S2 + DDG, 去重编号
- P0 ChatService: RAG + 流式编排 + 持久化
- P0 HTTP: /api/chat(SSE) + conversations CRUD + chat-config
- P1 md 导出(带引用脚注)

前端 ChatView
- P0 Spark Token + AppSidebar 视图切换
- P0 chatStore + SSE 流式接收
- P0 会话侧栏 + 消息流(气泡)
- P0 引用角标 + 溯源面板
- P0 底部输入框(联网/发送/停止)
- P1 Agent 配置弹窗
- P1 导出 md

联调
- P0 curl 测试 /api/chat + conversations
- P1 端到端: 提问→检索→引用→导出
```

预估 1.5~2 天。
