# uTools 移植可行性 Spike(2026-08-20)

验证目标:ai-task-flow 前端(React 19 + Tailwind CSS v4 + Radix)能否在 uTools 插件环境中可用,
并确定所需的兼容层与移植路径。

## 核心结论

**可行,但必须走"uTools 壳 + backend 独立常驻"路线,且前端 CSS 产物必须做 Chromium 108 降级。**

| 验证项 | 结果 |
|---|---|
| uTools 7.8.0 内核 | Electron 22.3.27 / **Chromium 108**(二进制 UA 字符串实测),preload 为 CJS + Node 16 |
| 原版 CSS 产物在 108 渲染 | **近乎白屏**:唯一颜色 2 种、非白像素 0.1%(oklch/color-mix 全部无效,含文字色) |
| lightningcss 降级后 | **恢复正常**:唯一颜色 202 种、非白像素 62.4% |
| backend 跨源访问 | `Origin: null`(file:// 页面)返回 `access-control-allow-origin: *`,HTTP 200 ✅ |
| JS 兼容性 | Electron 22 壳加载生产产物,主界面正常渲染、API 数据正常加载,未见阻断性 console error |

## CSS 降级链路(Tailwind v4 → Chromium 108)

```bash
# 1. 构建前端(产物进 backend/public)
cd frontend && npm run build
# 2. 抽取 CSS 并降级(targets: chrome 108)
cp ../backend/public/assets/index-*.css ../tools/utools-spike/orig.css
cd ../tools/utools-spike && node downgrade-css.cjs orig.css lc108.css
```

降级效果:
- `oklch()` 123 处 → **全部转 rgb()** ✅(lightningcss 静态转换,含 CSS 变量值)
- `color-mix()` 187 处 → **全部保留** ❌(带 `var()` 操作数无法静态求值,108 下这些声明无效)

已知限制:残留的 color-mix 影响半透明类样式(遮罩、`bg-black/50`、ring/hover 半透明态),
主界面渲染不受阻(实测截图)。若要彻底解决,后续可用 lightningcss visitor 做"作用域感知的
变量内联 + color-mix 求值"(注意 .dark 主题变量覆盖),或对高频半透明 utility 手写 108 回退。

## 目录说明

- `downgrade-css.cjs` — CSS 降级脚本(lightningcss,复用根 node_modules)
- `serve-108.cjs` — 托管降级版产物的静态服务(3108),`/api` 反代到本机 backend(3000)
- `eton-shot/` — Electron 22.3.27 空壳(与 uTools 同内核),用于截图与像素统计
  - `main.cjs` 依次加载原版(3000)/降级版(3108)并截图
  - `stat.html` + `stat-main.cjs` 对截图做颜色统计(唯一色数/非白占比)
  - `gen-logo-*.cjs/html` 生成插件 logo
- `plugin/` — uTools 插件脚手架(开发模式指向 serve-108)
- `shot-orig.png` / `shot-lc108.png` — 验证证据截图

Electron 22 二进制安装方式(spike 临时,勿提交):
`npm install --no-save --prefix .tmp-eton electron@22.3.27 --electron-mirror=https://npmmirror.com/mirrors/electron/`

## 窗口适配(第二轮验证,2026-08-20)

用户在 uTools 内确认:降级渲染样式无问题,但**窗口是主要问题**。实测数据(`winrect.ps1`):

- uTools 主窗口宽 **802px 固定不可调**(`setExpendHeight` 只能调高度,无宽度 API),当前屏 1920x1200
- 本应用按 >=1024 宽设计 → 内嵌主窗口形态不可用

适配策略(已实现于 `plugin/preload.js`):`onPluginEnter` 即
`utools.createBrowserWindow(当前页面URL, {width:1440, height:900, minWidth:1024, resizable/maximizable})`
→ 加载完成后 `show + maximize` → `utools.hideMainWindow()`。独立窗口可自由调整/最大化。

待实测风险:`createBrowserWindow` 文档标注 url 为相对路径 html,传入绝对 URL
(serve-108)是否可行;失败则回退 plugin/ 内放 launcher.html 中转。
已知限制:再次呼出会多开窗口(uTools 无单例 API),生产形态需防重入。

## 手动验证步骤(uTools 内最终确认)

1. 确认 backend 在跑(默认 3000);若否:`cd backend && npm run dev`
2. 启动降级版服务:`cd tools/utools-spike && node serve-108.cjs`(监听 3108)
3. uTools → 设置 → 开启「开发者插件」;将 `tools/utools-spike/plugin/plugin.json` 拖入 uTools 窗口
   (已拖入过且改了 preload 的:在 uTools 插件管理里移除后重新拖入,或开发者模式下重启 uTools)
4. `alt+space` 呼出 uTools,输入 `atf` 或 `任务看板` 回车 → 应弹出独立的 1440x900(最大化)工作台窗口,
   uTools 主窗口自动隐藏
5. 检查点:独立窗口尺寸/缩放、看板列/卡片颜色、任务数据加载、画布平移缩放、窗口关闭后再呼出

## 移植路线(确认可行后)

生产形态 = `plugin/` 打包前端产物(CSS 已降级)+ preload 提供 `backendBase`;
backend 以独立进程常驻(开机自启或插件 preload `spawn(detached)` 拉起);
`~/.ai-task-flow/` 存储保持不动(MCP stdio server 不受影响)。

前端源码需一处小改:`src/api/http.ts` 与 `chat.ts` 的 API base 支持
`import.meta.env.VITE_API_BASE` 注入(当前硬编码 `/api`,仅同源托管形态可用)。
