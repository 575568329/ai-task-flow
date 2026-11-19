# 工作阶段标签（Stage）设计

- 日期：2026-11-19
- 状态：已落地
- 关联：worklog、结论卡、xkzy-harness 阶段模型

## 1. 背景

工作记录和结论卡需要回答「这条内容是在哪个阶段产生的」。自由 tags 无法保证唯一性，也无法稳定筛选；用户实际工作阶段是：

> 获取需求 → 设计文档/实施计划 → 开发 → 自测 → 代码评审 → 缺陷修改 → 覆盖度测试 → 上线 → 复盘

对照 `D:\xunfei\xkzy-harness-workspace` 的 `matrix.yaml`（门禁真相源）stage 0–5 后发现：harness 阶段太粗（开发/自测/评审/缺陷都在 stage4，覆盖度/上线在 stage5，且没有复盘），不适合作为日常记录的唯一标签。

## 2. 决策

- 采用 **8 个生命周期阶段** 作为唯一 `stage` 单值。
- **缺陷修改不占 stage**，用既有 `tags` 中的 `fix` 表示工作类型。
- 自由 `tags` 继续表示 feat/fix/refactor/docs；`stage` 与 `tags` 正交。
- 旧记录允许为空，页面显示「未标注」；不做自动迁移。
- 可选映射到 harness 0–5，仅用于流程报表，不参与唯一标签。

## 3. 枚举

定义在 `shared/src/types/stage.ts`：

| stage | 标签 |
|---|---|
| `req` | 获取需求 |
| `design` | 设计文档/实施计划 |
| `dev` | 开发阶段 |
| `self-test` | 自测阶段 |
| `review` | 代码评审 |
| `coverage` | 覆盖度测试 |
| `release` | 上线 |
| `retro` | 复盘 |

harness 映射：

| stage | harness |
|---|---|
| req | stage1 需求/Issue |
| design | stage2 设计 |
| dev / self-test / review | stage4 编码与本地验证 |
| coverage / release | stage5 集成与交付 |
| retro | 横切/流程外 |

## 4. 数据模型

- `WorklogEntry.stage?: WorkStage`：一条工作记录一个阶段。
- `ConclusionRevision.stage?: WorkStage`：结论卡每个 revision 一个阶段（同一张卡可跨阶段演进）。
- `ConclusionSummary.stage?: WorkStage`：取最新版阶段，用于列表筛选。
- 请求/查询类型（create/append/record/query）都带可选 `stage`；服务端用 `isWorkStage` 校验，非法值 400。
- 结论卡 append 省略 stage 时沿用上一版；显式空值不改变阶段（不提供清空语义）。

## 5. 接口与 UI

- MCP：
  - `record_work`：`stage` 必填。
  - `update_work`：`stage` 可选，传则改。
  - `query_work`：`stage` 可选，按阶段过滤。
  - `record_conclusion`：新建建议填写；同一对话追加省略=沿用。
  - `query_conclusions`：`stage` 可选，按最新版阶段过滤。
- 页面：
  - 工作记录：条目阶段徽标；按阶段筛选（全部/未标注/8 阶段）；表单可选阶段。
  - 结论卡：卡片最新版阶段徽标；按阶段筛选；表单可选阶段；演进时间线每版显示阶段。
- 旧的「查看本版全文」从行内 `<details>` 改为右侧抽屉（Sheet），避免侧栏内阅读长文。

## 6. 示例

任务类结论卡：

```markdown
stage: dev
decision:
**现象/目标**
...
**结论**
1. ...
**处置**
1. ...
```

Bug 修复工作记录：

```markdown
stage: dev
tags: [fix]
detail:
### 问题
...
### 原因
...
### 解决
1. ...
### 验证
...
```

## 7. 兼容与后续

- 旧数据 stage 为空，显示「未标注」，编辑时可补。
- 是否把新记录强制必填，后续可在工具/MCP 层再加；当前 MCP `record_work` schema 已标记必填，HTTP/页面允许未标注。
- 若需要更细的环节（如 stage4 内的 code-review/unit-test），后续可加可选 `gate` 字段，不改变 stage 的唯一性。
