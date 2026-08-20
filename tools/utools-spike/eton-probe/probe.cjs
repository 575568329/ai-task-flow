// 布局溢出探针:加载指定 URL,在给定视口下量化 DOM 溢出情况,报告写入 JSON 文件。
// 全部参数走环境变量(electron CLI 参数传递在 Windows 管道下不可靠):
//   PROBE_URL(默认 serve-108) PROBE_W PROBE_H PROBE_WAIT
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const url = process.env.PROBE_URL || 'http://127.0.0.1:3108/';
const width = parseInt(process.env.PROBE_W || '1440', 10);
const height = parseInt(process.env.PROBE_H || '900', 10);
const waitMs = parseInt(process.env.PROBE_WAIT || '5000', 10);
const OUT = path.join(__dirname, `probe-${width}x${height}.json`);

const PROBE = `(() => {
  const de = document.documentElement;
  const vw = de.clientWidth, vh = de.clientHeight;
  const overflows = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if ((r.right > vw + 1 || r.bottom > vh + 1) && r.width > 50 && r.height > 20 && el.children.length < 8) {
      overflows.push({
        tag: el.tagName,
        cls: String(el.className || '').slice(0, 90),
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)],
        size: [Math.round(r.width), Math.round(r.height)],
      });
    }
  }
  return JSON.stringify({
    viewport: [vw, vh],
    documentScrollSize: [de.scrollWidth, de.scrollHeight],
    overflowElementCount: overflows.length,
    sample: overflows.slice(0, 12),
  }, null, 1);
})()`;

fs.writeFileSync(path.join(__dirname, 'sentinel.txt'), new Date().toISOString());

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ width, height, useContentSize: true, show: false });
    await win.loadURL(url);
    await new Promise((r) => setTimeout(r, waitMs));
    const report = await win.webContents.executeJavaScript(PROBE);
    fs.writeFileSync(OUT, report);
  } catch (err) {
    fs.writeFileSync(OUT, JSON.stringify({ error: String(err) }));
  }
  app.quit();
});
