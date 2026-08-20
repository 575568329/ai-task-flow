/**
 * uTools 兼容性 spike:Electron 22.3.27 空壳(与 uTools 7.8.0 完全同版本内核,Chromium 108),
 * 依次加载原版/降级版前端页面并截图,同时收集 console error 暴露 JS 兼容问题。
 *
 * 用法: electron.exe <本目录>
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SHOTS = [
  { name: 'orig', url: 'http://127.0.0.1:3000/', note: '原版产物(Tailwind v4 原生 oklch/color-mix)' },
  { name: 'lc108', url: 'http://127.0.0.1:3108/', note: '降级产物(lightningcss chrome108)' },
];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 900, show: true });
  win.webContents.on('console-message', (_e, _level, message) => {
    if (/error|failed|uncaught/i.test(message)) console.log(`[console] ${message.slice(0, 300)}`);
  });

  for (const shot of SHOTS) {
    console.log(`\n=== 加载 ${shot.name}: ${shot.url} (${shot.note}) ===`);
    await win.loadURL(shot.url);
    await new Promise((r) => setTimeout(r, 6000));
    const img = await win.webContents.capturePage();
    const out = path.join(__dirname, `shot-${shot.name}.png`);
    fs.writeFileSync(out, img.toPNG());
    console.log(`saved: ${out}`);
  }
  app.quit();
});
