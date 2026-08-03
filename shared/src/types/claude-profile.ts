// shared/src/types/claude-profile.ts
// Claude Code settings.json 多套配置(profile)一键切换的前后端共享类型。
//
// 与 llm-config 的区别:llm-config 管「看板自己调 LLM」;本模块管「Claude Code 读的
// ~/.claude/settings.json」——两者互不相干,别混用。

/** 可写入的目标 settings.json(WSL 各 distro + Windows 本机) */
export interface ClaudeSettingsTarget {
  /** 稳定标识(文件名安全),如 windows / wsl-Ubuntu-fjyu9 */
  key: string;
  /** 展示名,如 「WSL · Ubuntu / fjyu9」 */
  label: string;
  side: 'windows' | 'wsl';
  /** settings.json 绝对路径(Windows 侧为 C:\...,WSL 侧为 UNC \\wsl.localhost\...) */
  path: string;
  /** 文件当前是否存在(不存在也可作为切换目标,写入时自动创建) */
  exists: boolean;
}

/** profile 视图(含完整 settings 供前端编辑回显) */
export interface ClaudeProfileSummary {
  id: string;
  name: string;
  /** env.ANTHROPIC_BASE_URL,无则空 */
  baseURL: string;
  /** 顶层 model 字段,无则空 */
  model: string;
  /** env.ANTHROPIC_AUTH_TOKEN 打码后的值,未配置为空 */
  authTokenMasked: string;
  /** settings 顶层字段名(让用户知道这份快照包含什么,如 env/model/hooks) */
  topLevelKeys: string[];
  /** 完整 settings JSON(编辑时回显用) */
  settings: Record<string, unknown>;
  updatedAt: string;
}

/** 某目标下的 profile 列表 + 当前生效项 */
export interface ClaudeProfileListResponse {
  profiles: ClaudeProfileSummary[];
  /** 内容与目标文件一致的 profile id;都不一致(或文件不存在)为 null */
  activeProfileId: string | null;
  target: ClaudeSettingsTarget;
}

/** 新建 profile(粘贴整份 settings JSON) */
export interface ClaudeProfileCreateRequest {
  name: string;
  /** settings.json 的完整内容(对象) */
  settings: Record<string, unknown>;
}

/** 从某目标的现有 settings.json 导入为 profile(明文不经过前端) */
export interface ClaudeProfileImportRequest {
  name: string;
  targetKey: string;
}

/** 改名 / 换内容(settings 省略表示只改名) */
export interface ClaudeProfileUpdateRequest {
  name?: string;
  settings?: Record<string, unknown>;
}

/** 应用结果 */
export interface ClaudeProfileApplyResponse {
  ok: true;
  /** 覆盖前的备份文件路径;原文件不存在时为 null */
  backupPath: string | null;
  /** 写入 WSL 目标时被改写成 /mnt 形态的 Windows 路径条数 */
  rewrittenPaths: number;
  target: ClaudeSettingsTarget;
}
