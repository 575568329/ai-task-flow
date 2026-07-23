// frontend/src/lib/docExport.ts
// 文档导出共用工具:渲染区 → PDF(浏览器打印) + 文本 → 下载。
// KnowledgeViewer 与 TaskDocsView 共用,保证两处导出行为一致(第7条「统一组件」的落点之一)。

/**
 * 把已渲染的 DOM 元素导出为 PDF:新窗口写入 outerHTML + 当页样式表,调浏览器打印(另存为 PDF)。
 * 依赖当页 Tailwind 样式,故需把 <style>/<link> 复制到新窗口,否则 class 全失效。
 *
 * @returns true 成功打开打印窗口;false 表示弹窗被浏览器拦截
 */
export function exportElementToPdf(el: HTMLElement, title: string): boolean {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) return false; // 弹窗被拦
  const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
    .map((n) => n.outerHTML)
    .join('\n');
  win.document.open();
  win.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${styles}<style>body{padding:32px;max-width:900px;margin:0 auto;}</style></head><body>${el.outerHTML}</body></html>`,
  );
  win.document.close();
  win.focus();
  // 留时间给样式表(link)加载完成,否则首屏无样式
  setTimeout(() => win.print(), 500);
  return true;
}

/**
 * 把文本内容作为文件下载(Blob → a[download],纯前端,无需服务端)。
 * 默认 markdown,改 mime 可下载其它文本。
 */
export function downloadText(filename: string, content: string, mime = 'text/markdown'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
