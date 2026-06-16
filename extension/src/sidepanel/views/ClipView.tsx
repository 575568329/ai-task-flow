// extension/src/sidepanel/views/ClipView.tsx
import { usePageContext } from '../PageContextStore.js';

/** 从 crxjs 编译后的 manifest 动态读取 content script 产物路径（哈希随内容变，不可硬编码） */
function getClipPath(): string {
  const cs = chrome.runtime.getManifest().content_scripts;
  const path = cs?.[0]?.js?.[0];
  if (!path) throw new Error('未找到 content script 产物路径');
  return path;
}

/** 抓取桩：点按钮注入 content script，结果经 onMessage 进 store。完整草案编辑在 Task 7。 */
export function ClipView() {
  const { pageContext, error } = usePageContext();

  async function handleCapture() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id) return;
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [getClipPath()] });
  }

  return (
    <div>
      <button className="btn btn-primary" onClick={handleCapture}>✂️ 抓取本页</button>
      <p className="msg msg-info">划词优先（先选中内容），否则自动提取正文 + 图片。</p>
      {error && <p className="msg msg-error">{error}</p>}
      {pageContext && <p className="msg msg-info">已抓取：{pageContext.title || pageContext.sourceUrl}</p>}
    </div>
  );
}
