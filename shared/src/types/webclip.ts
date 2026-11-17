// shared/src/types/webclip.ts
// 网页剪藏的前后端共享契约(扩展 → 后端 WebClipService → 扩展)。

/** 步骤内容块(原 types/task.ts,webclip 任务草稿使用;任务链路砍除后由本文件承接) */
export type StepBlock =
  | { type: 'text'; content: string }
  | { type: 'image'; url: string };

/** 任务步骤:有序图文块(顺序即渲染顺序);description/imageUrl 为旧格式兼容字段 */
export interface TaskStep {
  blocks?: StepBlock[];
  completed?: boolean;
  /** @deprecated 旧格式字段，仅用于兼容历史数据 */
  description?: string;
  /** @deprecated 旧格式字段，仅用于兼容历史数据 */
  imageUrl?: string;
}

/** 抓取到的图片(base64 形式,WebClipService 落盘后转为 url) */
export interface ClipImage {
  name: string;        // 占位引用名,如 "img-1",供 LLM 在步骤里引用
  base64: string;      // data:image/png;base64,...
}

/** 扩展 → 后端的剪藏请求 */
export interface ClipRequest {
  sourceUrl: string;                    // location.href
  title: string;                        // document.title
  content: { html?: string; text: string };
  images?: ClipImage[];
}

/** AI 拆解出的单个任务草案 */
export interface ClipDraft {
  title: string;
  description: string;
  steps: TaskStep[];   // 图文块(image block 的 url 已替换为真实地址)
}

/** 后端 → 扩展的响应 */
export interface ClipResponse {
  drafts: ClipDraft[];
  sourceUrl: string;
}
