// shared/src/types/system.ts
// 系统级接口的共享类型:存储占用监控、本机访问上下文。
// 与后端 StorageService / system 路由一一对应,阈值由后端计算后以 warning 标志下发,
// 前端不需要感知具体字节阈值。

/** 可统计/清理的存储类别(与后端 CATEGORY_DEFS 的 key 严格对应) */
export type StorageCategoryKey =
  | 'tasks' // tasks.json — 任务看板业务数据,仅显示大小,不可整体清理
  | 'chats' // chats.json — 调研聊天业务数据,仅显示大小,不可整体清理
  | 'events' // events.jsonl — 领域事件审计,可清空(仅丢审计)
  | 'uploads' // uploads/ — 上传图片,可清空(⚠️ 已引用的图片会变破图)
  | 'taskDocs' // tasks/*.md — 任务派发存档,可清空(⚠️ 进行中任务的 Claude 读不到存档)
  | 'logs'; // logs/ — 后端运行日志,可清空(安全)

/** 单个存储类别的占用信息 */
export interface StorageItem {
  key: StorageCategoryKey;
  /** 展示名 */
  label: string;
  /** 一句话说明该类别是什么 / 清理后果(前端用于提示文案) */
  description: string;
  /** 占用字节 */
  bytes: number;
  /** 文件数(目录类有效,单文件类为 0/1) */
  fileCount: number;
  /** 是否允许通过清理接口清空 */
  clearable: boolean;
  /** 清理有副作用需强提示(如 uploads 令图片引用失效) */
  danger?: boolean;
  /** 单项是否已超过单项告警阈值 */
  warning: boolean;
}

/** 存储占用汇总(GET /api/system/storage 返回) */
export interface StorageInfo {
  items: StorageItem[];
  totalBytes: number;
  /** 总占用是否已超过总告警阈值 */
  warning: boolean;
}

/** 单个类别清理结果 */
export interface StorageClearResult {
  key: StorageCategoryKey;
  /** 本次释放的字节 */
  releasedBytes: number;
}

/** 清理请求体 */
export interface StorageClearRequest {
  categories: StorageCategoryKey[];
}

/** 清理响应 */
export interface StorageClearResponse {
  results: StorageClearResult[];
  /** 清理后重新统计的占用信息 */
  storage: StorageInfo;
}

/** LLM 测试连接请求体 */
export interface TestConnectionRequest {
  baseURL: string;
  /** 空 = 复用已保存的 key(测当前生效配置);非空 = 测新填的 key */
  apiKey: string;
  model: string;
}

/** LLM 测试连接结果 */
export interface TestConnectionResult {
  success: boolean;
  message: string;
  /** 耗时(ms),仅成功时返回 */
  latencyMs?: number;
  /** 实际命中的协议(让用户确认 baseURL 自动检测是否符合预期) */
  protocol?: 'openai' | 'anthropic';
}
