// upx 安装形态验证:Electron 22(= uTools 7.8 内核)以 file:// 加载插件包 index.html,
// 复现 upx 安装后的真实环境:file:// origin(null) + API_BASE=http://127.0.0.1:3000 + 降级 CSS。
// 断言:页面渲染、API 跨源取数、SSE 连接,截图留档。
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const PLUGIN_INDEX = path.resolve(__dirname, '../plugin/index.html');
const SHOT = path.resolve(__dirname, 'shot-file-mode.png');

const PROBE = `(() => {
  const aside = document.querySelector('aside');
  const rows = [...document.querySelectorAll('main div.rounded-lg')].filter(el => el.querySelector(':scope > button[aria-expanded]') !== null);
  return JSON.stringify({
    readyState: document.readyState,
    hasApp: !!aside,
    asideW: aside ? Math.round(aside.getBoundingClientRect().width) : null,
    kanbanRows: rows.length,
    rowLabels: rows.map(r => (r.querySelector('.text-sm') || {}).textContent || ''),
    taskText: (document.querySelector('main') || { textContent: '' }).textContent.slice(0, 60),
    sseDotGreen: !!document.querySelector('.bg-green-500'),
  });
})()`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 802, height: 602, useContentSize: true, show: true });
  const report = { loadError: null, console: [] };
  win.webContents.on('console-message', (_e, _lvl, msg) => {
    if (/error|fail|refused|blocked/i.test(msg)) report.console.push(msg.slice(0, 200));
  });
  try {
    await win.loadFile(PLUGIN_INDEX);
  } catch (e) {
    report.loadError = String(e);
  }
  await new Promise((r) => setTimeout(r, 6000));
  report.probe = JSON.parse(await win.webContents.executeJavaScript(PROBE));
  fs.writeFileSync(SHOT, (await win.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.resolve(__dirname, 'report.json'), JSON.stringify(report, null, 2));
  console.log('REPORT ' + JSON.stringify(report));
  app.quit();
});
