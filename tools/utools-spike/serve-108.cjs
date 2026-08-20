/**
 * uTools 兼容性 spike:托管"CSS 降级版"前端产物,模拟 uTools(Electron 22/Chromium 108)
 * 加载生产打包形态的页面。
 *
 * - 静态文件来自 backend/public(最新构建产物)
 * - 所有 .css 请求替换为 lc108.css(lightningcss 按 chrome 108 降级后的产物)
 * - /api/* 反向代理到本机 3000(复用已在运行的 backend)
 *
 * 用法: node serve-108.cjs  (监听 http://127.0.0.1:3108)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.resolve(__dirname, '../../backend/public');
const DOWNGRADED_CSS = path.join(__dirname, 'lc108.css');
const BACKEND_PORT = 3000;
const LISTEN_PORT = 3108;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  if (urlPath.startsWith('/api/')) {
    const proxy = http.request(
      { host: '127.0.0.1', port: BACKEND_PORT, path: req.url, method: req.method, headers: req.headers },
      (upstream) => {
        res.writeHead(upstream.statusCode, upstream.headers);
        upstream.pipe(res);
      },
    );
    proxy.on('error', (err) => {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`proxy error: ${err.message}`);
    });
    req.pipe(proxy);
    return;
  }

  let rel = urlPath === '/' ? '/index.html' : urlPath;
  rel = path.normalize(rel).replace(/^([/\\])+/, '');
  let filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  if (filePath.endsWith('.css')) {
    res.writeHead(200, { 'content-type': MIME['.css'] });
    res.end(fs.readFileSync(DOWNGRADED_CSS));
    return;
  }
  try {
    const body = fs.readFileSync(filePath);
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    // SPA fallback
    const body = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'));
    res.writeHead(200, { 'content-type': MIME['.html'] });
    res.end(body);
  }
});

server.listen(LISTEN_PORT, '127.0.0.1', () => {
  console.log(`serve-108 running at http://127.0.0.1:${LISTEN_PORT}`);
});
