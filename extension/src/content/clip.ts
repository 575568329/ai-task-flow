// extension/src/content/clip.ts
// 动态注入入口：被 chrome.scripting.executeScript({files}) 注入到当前页，
// 在页面上下文采集 PageContext，经 chrome.runtime.sendMessage 回传侧栏。
// （不依赖 executeScript 返回值机制——改用消息，规避其语义不确定性。）
import { capturePageContext } from './capture.js';

async function main(): Promise<void> {
  try {
    const pageContext = await capturePageContext({ wantImages: true });
    console.log('[clip] 采集完成', {
      url: pageContext.sourceUrl,
      title: pageContext.title,
      textLen: pageContext.text.length,
      images: pageContext.images?.length ?? 0,
    });
    chrome.runtime.sendMessage({ type: 'CAPTURE_RESULT', payload: pageContext });
  } catch (error) {
    console.error('[clip] 采集失败', error);
    chrome.runtime.sendMessage({ type: 'CAPTURE_ERROR', message: String(error) });
  }
}

void main();
