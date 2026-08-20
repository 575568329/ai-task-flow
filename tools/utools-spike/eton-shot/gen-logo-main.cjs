// 生成 logo.png 并保存到 plugin 目录。用法: electron.exe <本文件>
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '../plugin/logo.png');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 300, height: 300, show: false });
  win.webContents.on('console-message', (_e, _level, message) => {
    if (!message.startsWith('LOGO ')) return;
    const base64 = message.slice('LOGO data:image/png;base64,'.length);
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, Buffer.from(base64, 'base64'));
    console.log('saved:', OUT);
    app.quit();
  });
  await win.loadFile(path.join(__dirname, 'gen-logo.html'));
  setTimeout(() => { console.error('logo generation timed out'); app.quit(); }, 5000);
});
