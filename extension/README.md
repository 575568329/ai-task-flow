# @ai-task-flow/extension

AI Task Flow 浏览器扩展（Manifest V3），以**侧边栏（side panel）**形式提供「网页剪藏」与「划词翻译」两大能力，数据回传本地后端（`http://localhost:3000`），与看板/生词本联动。

---

## 功能

- **网页剪藏**：抓取当前页内容 → AI 拆解为任务草案 → 一键建到看板。
  - 划词优先：先在页面选中文字/图片再抓，只抓选区；
  - 未选区时：Readability 自动提取正文 + 全页图片。
- **划词翻译**：选中网页文字后打开侧栏，自动翻译选区；也可在输入框手动翻译；译文可**存入生词本**（与网页端生词本同步）。

---

## 前置条件

- Node ≥ 18
- 本地后端运行在 **`http://localhost:3000`**（`host_permissions` 锁定，端口必须是 3000）
- Chrome / Edge（用到 MV3 `sidePanel` API）

---

## 构建

```bash
# 1. 先构建 shared（扩展依赖 @ai-task-flow/shared 的产物）
npm run build:shared

# 2. 构建扩展，产物输出到 extension/dist
npm run build:extension
```

> 也可在 `extension/` 目录内直接 `npm run build`。
> `shared` 改动后需重新 `build:shared`，再 `build:extension`。

---

## 浏览器加载（首次使用）

1. 打开 `chrome://extensions`（Edge：`edge://extensions`）
2. 右上角开启 **「开发者模式」**
3. 点 **「加载已解压的扩展程序」**，选择 **`extension/dist`** 目录
4. 启动后端：`npm run dev:backend`（确认监听 3000 端口）
5. 点浏览器工具栏的扩展图标 → 侧边栏打开 → 切换「剪藏」/「翻译」Tab 使用

---

## 日常使用

| 场景 | 操作 |
|------|------|
| 剪藏网页 | （可选）先选中要抓的内容 → 打开侧栏「剪藏」Tab → 抓取 → 确认任务草案 → 建到看板 |
| 划词翻译 | 在网页选中文字 → 打开侧栏「翻译」Tab，自动翻译选区；或手动输入翻译 → 可存入生词本 |

> 侧边栏 Tab 选择会记忆（`chrome.storage`），下次打开保持上次 Tab。

---

## 开发模式

```bash
npm run dev:extension   # crxjs vite-plugin，带 HMR
```

- 日常使用建议用 `build` 产物；`dev:extension` 适合二次开发。
- 改了扩展代码后：回 `chrome://extensions` 点该扩展的 **「刷新」** 按钮重新加载。
- 开发时通常三个进程一起跑：`dev:shared`（shared build:watch）+ `dev:backend` + `dev:extension`。

---

## 架构要点（排障时看）

- **side panel**：侧边栏 UI（Tab 切换），扩展主界面。入口 `src/sidepanel/`。
- **service worker（background）**：点工具栏图标开关侧栏；并作为**网络代理**——侧栏直接 `fetch localhost` 会触发 Chrome「本地网络访问（Private Network Access）」拦截，故所有到后端的请求都由 service worker 代发，统一用 `text/plain` 简单请求绕过预检。详见 [`docs/20260617020000_网页剪藏扩展联调踩坑记录.md`](../docs/20260617020000_网页剪藏扩展联调踩坑记录.md)。
- **content scripts**：动态注入（按需），抓取页面选区/正文/图片；选区跨 frame 隔离已处理。入口 `src/content/`。

---

## 常见问题

- **侧栏提示连不上后端**：确认 `npm run dev:backend` 在跑，且端口是 **3000**（不是前端的 5173/5678）。
- **改代码后没生效**：`chrome://extensions` 里点扩展的「刷新」；改了 `shared` 要重新 `build:shared`。
- **抓不到选区**：先在页面选中内容再抓取；iframe 内（如富文本编辑器）选区可能受限。
- **工具栏图标点了没反应**：首次安装需 `onInstalled` 触发后才注册 `openPanelOnActionClick`，重载一次扩展即可。

---

## 权限说明（`manifest.json`）

| 权限 | 用途 |
|------|------|
| `sidePanel` | 侧边栏 |
| `activeTab` + `scripting` | 当前页抓取 / 动态注入脚本（不声明 `<all_urls>`，避免高权限警告） |
| `storage` | 记忆侧栏 Tab |
| `tabs` | 配合 activeTab 读取当前页信息 |
| `host_permissions: localhost:3000` | 后端地址 |
