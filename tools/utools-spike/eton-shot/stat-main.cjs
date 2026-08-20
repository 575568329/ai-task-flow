// uTools spike: 统计入口。用法: electron.exe <本目录> --stat
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 400, height: 300, show: false });
  win.webContents.on('console-message', (_e, _level, message) => console.log('[page]', message));
  await win.loadFile(path.join(__dirname, 'stat.html'));
  setTimeout(() => app.quit(), 3000);
});
