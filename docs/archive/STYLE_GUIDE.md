# 本项目样式规范（Spark-design 移植版）

> 来源：吸收自 `Spark-design` skill，去除 Element Plus 依赖，用纯 CSS 变量 + React 落地。
> 适用范围：本项目所有前端界面（看板、调研聊天、后续新增页面）。
> 日期：2026-06-09

---

## 一、核心原则

1. **禁止硬编码色值**：所有 `#xxx` / `rgb()` / `rgba()` 必须用 `--sp-*` Token（定义在 `frontend/src/styles/spark-tokens.css`）。
2. **不引入 Element Plus**：只吸收 Spark 的设计语言（色板/字号/圆角/间距/阴影），组件用 React + 原生 CSS 自己实现。
3. **Token 隔离**：调研聊天用 `--sp-*` 前缀；现有看板的 `--bg-bottom/--text-1` 保留不动，二者互不污染。
4. **图标统一 lucide-react**：`stroke-width` 固定为 `2`，正文/操作图标 18px，提示图标 14px。
5. **禁止用 opacity/filter 模拟 hover/disabled**：用对应 Token 切换。

---

## 二、设计 Token 速查

完整定义见 `frontend/src/styles/spark-tokens.css`。常用：

### 颜色
| 用途 | Token | 值 |
|------|-------|-----|
| 主色 | `--sp-color-primary` | `#216bff` |
| 主色 hover | `--sp-color-primary-hover` | `#4785ff` |
| 主色浅底（选中/标签） | `--sp-color-primary-light-9` | `#e9f0ff` |
| 成功 | `--sp-color-success` | `#12b312` |
| 警告 | `--sp-color-warning` | `#fa830c` |
| 错误（危险操作） | `--sp-color-error` | `#fa3946` |
| 正文 | `--sp-text-primary` | `rgba(0,0,0,.85)` |
| 次要文本 | `--sp-text-secondary` | `rgba(0,0,0,.65)` |
| 辅助文本 | `--sp-text-tertiary` | `rgba(0,0,0,.45)` |
| placeholder | `--sp-text-placeholder` | `rgba(0,0,0,.25)` |
| 主色上的文字 | `--sp-text-on-primary` | `#fff` |
| 页面背景 | `--sp-bg-page` | `#fafafa` |
| 卡片/内容背景 | `--sp-bg` | `#fff` |
| 边框 | `--sp-border` | `#d9d9d9` |
| 浅边框/分割线 | `--sp-border-secondary` | `#f0f0f0` |
| 填充 hover | `--sp-fill-hover` | `#f5f5f5` |

### 字号
| Token | 值 | 场景 |
|-------|-----|------|
| `--sp-font-size-xs` | 12px | 角标、标签 |
| `--sp-font-size-sm` | 13px | 辅助文字 |
| `--sp-font-size-base` | 14px | 正文（默认） |
| `--sp-font-size-md` | 16px | 输入框 |
| `--sp-font-size-lg` | 18px | 小标题 |
| `--sp-font-size-xl` | 20px | 大标题 |

### 圆角
| Token | 值 | 场景 |
|-------|-----|------|
| `--sp-radius-sm` | 2px | 标签 |
| `--sp-radius-base` | 4px | 按钮/输入 |
| `--sp-radius-md` | 8px | 卡片/菜单项 |
| `--sp-radius-lg` | 12px | 气泡/输入框容器 |
| `--sp-radius-round` | 9999px | 胶囊/角标 |
| `--sp-radius-circle` | 50% | 头像/圆形按钮 |

### 间距
`--sp-spacing-1`(4) / `-2`(8) / `-3`(12) / `-4`(16) / `-5`(20) / `-6`(24)

### 阴影
`--sp-shadow`（弹窗）/ `--sp-shadow-light`（卡片）/ `--sp-shadow-lighter`（轻浮层）

### 过渡
`--sp-transition-fast`（0.2s，hover）/ `--sp-transition-base`（0.3s，入场）

---

## 三、顶部导航栏规范（AppNav）

| 元素 | 规格 | Token |
|------|------|-------|
| 高度 | 56px（Spark B 端标准） | 固定值 |
| 背景 | 白色，浅边框底部 | `--sp-bg` + `--sp-border-secondary` |
| Logo 图标 | 32px 圆角方形，渐变主色底 | `--sp-radius-md` |
| 品牌名 | 18px / 600 | `--sp-font-size-lg` |
| Tab 按钮高 | 36px | `--sp-menu-item-height` |
| Tab 未选中 | 透明底，次要文本色；hover 填充色 | `--sp-text-secondary` / `--sp-fill-hover` |
| Tab 选中 | 主色底白字，hover 加深 | `--sp-color-primary` / `--sp-color-primary-hover` |
| 图标规范 | 18px / stroke-width 2 | Lucide |

---

## 四、AI 对话页布局规范（Ai_chat）

| 元素 | 规格 | Token |
|------|------|-------|
| 侧栏宽度 | 240px | `--sp-sidebar-width` |
| 对话区最大宽 | 800px，水平居中 | `--sp-chat-max-width` |
| 溯源面板宽 | 320px，右侧滑入（覆盖层，不压缩对话区） | `--sp-source-panel-width` |
| 菜单项/会话项高 | 36px | `--sp-menu-item-height` |
| 底部用户区高 | 56px | `--sp-user-area-height` |
| 输入框高 | 104px | `--sp-input-height` |

### 用户消息
- 右对齐，max-width 70%，背景 `--sp-color-primary`，白字，圆角 `--sp-radius-lg`(12px)，padding `12px 16px`

### AI 消息
- 左对齐；头像 32px 圆形（`--sp-color-primary-light-9` 底 + 主色图标）
- 角色名 14px / 500 / `--sp-text-primary`
- 「N 篇内容来源 ›」标签：12px，主色，浅主色底
- 正文行高 1.8（`--sp-line-height-relaxed`）

### 引用角标
- 圆形上标，主色底白字，10px，min-width 16px，`--sp-radius-round`
- 悬停变 hover 色，点击打开来源链接

### 思考过程区
- 位于 AI 内容上方，圆角卡片包裹（`--sp-grey-1` 底 + 浅边框）
- 生成完成自动收起（MVP 简化为列表展示）

### 输入框
- 容器圆角 12px，边框 `--sp-border`，focus 时主色边框
- placeholder 16px，`--sp-text-placeholder`
- 工具栏在内侧底部靠左（联网开关）
- 发送按钮圆形 32px，主色底白图标；空输入禁用变 `--sp-border` 底

---

## 四、全局交互铁律

- ❌ 禁止硬编码色值 → 用 `--sp-*` Token
- ❌ 危险操作（删除）禁止用主色蓝 → 用 `--sp-color-error`
- ❌ 操作 >1 秒无反馈 → 必须有 loading（流式光标 / 骨架屏）
- ❌ 错误提示只写"失败" → 必须说明原因
- ❌ 空状态不处理 → 列表为空必须有引导文案
- ✅ 生成中发送按钮变停止按钮
- ✅ 联网开关等用户偏好存 localStorage

---

## 五、动效规范

| 场景 | 动效 |
|------|------|
| 内容入场 | 淡入上移 300ms ease-out（`sp-fade-in-up`） |
| AI 流式输出 | 逐字追加 + 末尾光标闪烁（`sp-blink`） |
| 思考过程收起 | 高度动画 250ms ease-in-out |
| 溯源面板 | 右侧滑入 250ms ease-out |
| hover/focus | `--sp-transition-fast`(0.2s) |

---

## 六、文件组织

```
frontend/src/
├── styles/
│   └── spark-tokens.css        # 设计 Token 唯一来源（--sp-*）
├── components/
│   ├── AppNav.tsx              # 应用级导航栏
│   ├── AppNav.css
│   └── chat/
│       ├── ChatView.tsx        # 调研聊天主视图
│       └── ChatView.css        # 组件样式（全部用 --sp-* Token）
└── index.css                   # @import spark-tokens.css
```

### 新建组件样式约定
1. 组件目录下放同名 `.css`，`import './XxxView.css'`
2. 类名前缀 `sp-`（spark），避免与 Tailwind/看板冲突
3. 任何色值/间距/圆角先查 `spark-tokens.css`，没有再补 Token，**不直接写值**

---

## 七、参考来源

- Spark-design skill：`C:\Users\fjyu9\.claude\skills\Spark-design`
  - `SKILL.md`：模式判断 + B 端铁律
  - `references/Ai_chat.md`：AI 对话页完整规范
  - `scripts/base.css`：浅色主题 Token 原始值（已提取到本项目 spark-tokens.css）
