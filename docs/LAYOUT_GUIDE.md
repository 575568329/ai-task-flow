# 前端布局规范(shadcn/ui v4 + Tailwind v4)

> 适用范围:本项目所有前端界面。
> 日期:2026-07-07
> 替代已失效的 `STYLE_GUIDE.md`(Spark-design 移植版,随 shadcn 重写作废)。

---

## 一、设计体系

- **shadcn/ui v4 + Tailwind v4**:颜色/字号/圆角用 CSS 变量(`--background` `--foreground` `--primary` `--radius` 等,定义在 `frontend/src/index.css`),间距用 Tailwind scale(`p-3` `gap-2`,均为 rem)。
- **不再使用** `--sp-*`(Spark)或 `--bg-bottom/--text-1`(旧看板)变量 —— 已随重写删除。
- 暗色主题走 `@custom-variant dark`,变量自动切换。

---

## 二、布局铁律

### 1. 全屏填满,不留白
根容器 `h-screen flex`,内容区 `flex-1 overflow-hidden`。

```tsx
<div className="flex h-screen overflow-hidden">
  <SidebarNav />
  <main className="flex-1 overflow-hidden">...</main>
</div>
```

### 2. 多列平铺用 `min-w + flex-1` 填满,不固定列宽横滚
看板这类 N 列平铺视图,列用 `min-w-[Npx] flex-1`:
- 宽屏列等分铺满(不留白)
- 窄屏 min-w 撑超才横滚(保底可读宽度)

```tsx
<div className="flex gap-3 overflow-x-auto p-3">
  <div className="min-w-[260px] flex-1">...</div>  {/* 每列 */}
</div>
```

❌ 反例:`w-72 shrink-0`(固定列宽,宽屏右侧留白)

### 3. 弹层用视口/百分比单位
抽屉、对话框、聊天气泡等弹层/浮层,宽度用 `vw`/`%`,限高用 `vh`:

```tsx
<SheetContent className="w-[80vw]">           {/* 抽屉:视口宽 */}
<div className="max-w-[80%]">                 {/* 气泡:百分比 */}
<DiffViewer className="max-h-[60vh]" />       {/* 限高:视口高 */}
```

### 4. 内容横滚的合理场景
代码块、表格、长 URL 等内容本身超宽时,用 `overflow-x-auto`(内容横滚,而非容器固定宽度):

```tsx
<pre className="overflow-x-auto">...</pre>
```

### 5. 侧栏/分栏优先可拖拽
侧栏宽度优先用 `react-resizable-panels`(已装),允许用户调宽;固定宽度仅在次要、空间紧的场景用。

```tsx
<PanelGroup direction="horizontal">
  <Panel defaultSize={18} minSize={12} maxSize={28}><aside>...</aside></Panel>
  <PanelResizeHandle className="w-1 cursor-col-resize" />
  <Panel defaultSize={82}><main>...</main></Panel>
</PanelGroup>
```

---

## 三、间距与字号

- **间距**:Tailwind scale(`gap-2` `px-3` `py-4`),均为 rem,根字号缩放时整体响应。**禁止裸 px**(逻辑像素阈值除外,如 DnD `distance: 8`)。
- **字号**:`text-xs`(12px)/ `text-sm`(14px)/ `text-base`(16px),标题 `font-semibold`。
- **圆角**:`rounded-md`(组件默认)/ `rounded-lg`(卡片),顶层由 `--radius` 统一。

---

## 四、抽屉/表单:多栏而非单栏堆叠

任务详情这类**信息密度高**的抽屉,用多栏布局,避免某区(如步骤)被挤到下方:

```
┌──────────┬──────────┬──────────┐
│ 元信息    │   步骤    │   预览   │
│ (固定窄)  │ (flex-1)  │ (flex-1) │
└──────────┴──────────┴──────────┘
       顶部 header / 底部按钮 跨全宽
```

- 元信息栏固定窄宽(`w-[240px] shrink-0`),字段紧凑纵向
- 主操作区(步骤/编辑)`flex-1`
- 辅助区(预览)`flex-1`,可收起

---

## 五、必填与表单

- 仅业务上确实必要的字段标必填(`标题 *`),其余默认非必填,留空时后端给默认值(如任务前缀留空 → `TASK`)。
- 表单字段紧凑:`gap-1` + `text-xs` label,降低视觉噪音。

---

## 六、参考

- shadcn/ui v4:https://ui.shadcn.com
- Tailwind v4:https://tailwindcss.com
- 颜色/圆角变量源头:`frontend/src/index.css`
