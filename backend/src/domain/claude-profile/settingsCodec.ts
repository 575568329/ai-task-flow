// backend/src/domain/claude-profile/settingsCodec.ts
// settings.json 的纯函数处理:规范化比对、脱敏视图、Windows→WSL 路径改写。
// 纯函数无 IO,便于单测覆盖(这三件事都是「写错就静默失效」的高风险点)。
import { toWslPath } from '../../utils/wslPath.js';
import { maskApiKey } from '../../utils/mask.js';

/** settings.json 内容(结构由 Claude Code 定义,这里只当作任意 JSON 对象透传) */
export type ClaudeSettings = Record<string, unknown>;

/**
 * 匹配字符串里的 Windows 绝对路径(盘符 + 冒号 + 斜杠起头的一段)。
 *
 * `(?<![A-Za-z0-9])` 排除 `https://`、`file://` 这类 scheme 后误命中:URL 里冒号前是
 * 字母数字(http**s**:),而真实盘符前是行首/空格/引号。注意 `file:C:\x` 这种形式里
 * `C` 前是冒号(非字母数字),会被正确识别为盘符——正是 OTEL_LOG_RAW_API_BODIES 的写法。
 * 路径以引号/分号/空白为界(hook command 常形如 `node "C:\a\b.js" -Flag "x"`)。
 */
const WIN_PATH_RE = /(?<![A-Za-z0-9])([A-Za-z]:[\\/][^"';\s]*)/g;

/** 递归改写时需要处理的字段名:hooks 的 command 是唯一含本机路径的地方 */
const PATH_BEARING_KEYS = new Set(['command']);

/**
 * 稳定序列化:递归按 key 排序后 JSON.stringify。
 * 用途:比对「目标文件内容 == 某 profile」时忽略键序与缩进差异,
 * 避免用户手工格式化过文件就判为「无生效 profile」。
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

/**
 * 把 settings 里 hooks command 的 Windows 绝对路径改写为 WSL /mnt 形态。
 *
 * 为什么必须改:profile 快照常来自 Windows 侧(command 是 `node "C:\Users\x\hook.js"`),
 * 原样写进 WSL 的 settings.json,WSL 里的 node 找不到 `C:\...`,hook 静默失败——
 * 用户只会看到「通知不响了」,极难定位。故写入 WSL 目标前统一转成 /mnt/c/...。
 *
 * 只动 command 字段:env 里的值(如 OTEL endpoint、resource attributes)不该被路径逻辑碰,
 * 唯一例外是 `file:C:\...` 形态的日志落盘路径——它也在 env 里,但改写它会让 Windows 侧
 * 的日志目录语义漂移,保守起见不处理(WSL 下该 hook 本来就不写 Windows 目录)。
 *
 * @returns 改写后的新对象(不改入参) + 改写条数
 */
export function rewritePathsForWsl(settings: ClaudeSettings): {
  settings: ClaudeSettings;
  rewritten: number;
} {
  let rewritten = 0;

  const walk = (node: unknown, keyName?: string): unknown => {
    if (Array.isArray(node)) return node.map((item) => walk(item));
    if (node !== null && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        out[k] = walk(v, k);
      }
      return out;
    }
    if (typeof node === 'string' && keyName && PATH_BEARING_KEYS.has(keyName)) {
      return node.replace(WIN_PATH_RE, (match) => {
        const converted = toWslPath(match);
        if (converted !== match) rewritten++;
        return converted;
      });
    }
    return node;
  };

  return { settings: walk(settings) as ClaudeSettings, rewritten };
}

/**
 * 按目标侧「物化」profile:得到真正会写进该目标文件的内容。
 * WSL 侧做路径改写,Windows 侧原样。生效判定与实际写入都走这一个入口,
 * 保证「切完立刻显示为生效」——两边算的是同一份内容。
 */
export function materializeForSide(
  settings: ClaudeSettings,
  side: 'windows' | 'wsl',
): { settings: ClaudeSettings; rewritten: number } {
  if (side === 'wsl') return rewritePathsForWsl(settings);
  return { settings, rewritten: 0 };
}

/** 从 settings 中读取字符串字段(路径形如 env.ANTHROPIC_BASE_URL),缺失返回空串 */
function readString(settings: ClaudeSettings, ...pathSegments: string[]): string {
  let cursor: unknown = settings;
  for (const segment of pathSegments) {
    if (cursor === null || typeof cursor !== 'object') return '';
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return typeof cursor === 'string' ? cursor : '';
}

/** 提取脱敏摘要(下发前端用;settings 原文含密钥,禁止外传) */
export function summarizeSettings(settings: ClaudeSettings): {
  baseURL: string;
  model: string;
  authTokenMasked: string;
  topLevelKeys: string[];
} {
  return {
    baseURL: readString(settings, 'env', 'ANTHROPIC_BASE_URL'),
    model: readString(settings, 'model'),
    authTokenMasked: maskApiKey(readString(settings, 'env', 'ANTHROPIC_AUTH_TOKEN')),
    topLevelKeys: Object.keys(settings).sort(),
  };
}

/**
 * 提取 settings 的「API 身份」签名:ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN(即 API 凭证)。
 *
 * 用于生效判定的兜底:Claude Code 会自行往 settings.json 写 hooks / 权限 / 格式化等字段,
 * 导致「整份内容精确比对」经常失配——但用户关心的「当前用的是哪套 API 配置」只由凭证
 * (baseURL + token)决定,按身份比对即可在文件被重写后仍认出当前配置。
 *
 * ⚠️ 刻意排除 model:Claude Code 在 /model 切换时会把顶层 model 在别名(sonnet/opus/haiku)
 * 与具体名(GLM-5.2 等)之间来回改写,且同一套凭证下用户会频繁切模型——model 不属于
 * 「用的是哪套 API 配置」的范畴,纳入身份会让生效判定随 /model 抖动(别名态永远匹配不上
 * 快照里的具体名)。身份只认凭证,不认模型。
 *
 * 两项全空返回 null(无 API 身份,无法辨识,不参与匹配)。
 */
export function settingsIdentity(settings: ClaudeSettings): string | null {
  const baseURL = readString(settings, 'env', 'ANTHROPIC_BASE_URL');
  const token = readString(settings, 'env', 'ANTHROPIC_AUTH_TOKEN');
  if (!baseURL && !token) return null;
  return stableStringify({ baseURL, token });
}

/** 校验解析出的 JSON 是否可作为 settings(必须是普通对象,不能是数组/标量) */
export function isPlainSettingsObject(value: unknown): value is ClaudeSettings {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
