/**
 * uTools 内置 MCP 工具适配(必须保持明文可读)
 *
 * 全部 14 个工具统一走本机 backend 的 `/api/tools/:name` 桥接端点;
 * 该端点直接复用 stdio MCP 的 HANDLERS,因此参数校验、错误文案、返回格式完全一致,
 * 不存在"市场版一套逻辑、stdio 版另一套"的漂移。
 *
 * 安全边界:只请求固定的本机 127.0.0.1 地址与固定工具名;不读文件、不执行命令、不接受任意 URL。
 */
const TOOL_NAMES = [
  'record_work',
  'query_work',
  'list_projects',
  'list_programs',
  'list_versions',
  'update_work',
  'delete_work',
  'delete_version',
  'delete_project',
  'rename_version',
  'rename_project',
  'record_conclusion',
  'query_conclusions',
  'save_to_knowledge',
];

async function post(base, path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && payload.error
      ? payload.error
      : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

/** MCP handler 统一返回 {content:[{type:'text',text}], isError?};这里转成 AI 可读文本 */
function unwrap(result) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.content)) return result;
  const text = result.content
    .map((item) => (item && item.type === 'text' ? item.text : JSON.stringify(item)))
    .join('\n');
  if (result.isError) throw new Error(text.replace(/^❌\s*/, ''));
  return text;
}

async function invoke(base, name, params) {
  const args = params && typeof params === 'object' ? params : {};
  // uTools 没有 stdio 的 CLAUDE_CODE_SESSION_ID;用对话名做稳定会话 id,
  // 保证 record_conclusion 在同一对话内自动续写同一张卡。
  const conversationId = typeof args.conversationId === 'string' && args.conversationId.trim()
    ? args.conversationId.trim()
    : (typeof args.conversationName === 'string' && args.conversationName.trim()
      ? `utools:${args.conversationName.trim()}`
      : undefined);
  const sourcePath = typeof args.sourcePath === 'string' && args.sourcePath.trim()
    ? args.sourcePath.trim()
    : undefined;
  const result = await post(base, `/api/tools/${encodeURIComponent(name)}`, {
    args,
    ...(conversationId ? { conversationId } : {}),
    ...(sourcePath ? { sourcePath } : {}),
  });
  return unwrap(result);
}

/**
 * @param {() => Promise<string>} getBase 返回本机 backend 地址(等 preload 启动完成)
 */
function registerTools(getBase) {
  const api = typeof utools !== 'undefined' ? utools : window.utools;
  if (!api || typeof api.registerTool !== 'function') return;
  for (const name of TOOL_NAMES) {
    api.registerTool(name, async (params) => {
      const base = await getBase();
      return invoke(base, name, params);
    });
  }
}

module.exports = { registerTools };
