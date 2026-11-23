# 工作记录重构：版本 → 需求 → 条目 + 知识库关联

> 日期：2026-11-23
> 状态：待评审
> 范围：worklog 数据模型与 MCP 接口、前端树、数据迁移、知识库元数据与多视图

## 1. 背景

### 1.1 当前模型的问题

现有结构是「项目 → 版本 → 条目」，版本挂在项目下。实测数据：

| 版本 | 分布 |
|---|---|
| V8.0.5 | 搜题平台 10 条 + 资源加工平台 8 条 |
| V8.0.6 | 搜题平台 4 条 + 资源加工平台 5 条 |
| V8.0.8 | 组卷 11 条 + 资源加工平台 8 条 + 题库 1 条 |

同一个迭代版本被项目树切碎，查「V8.0.8 做了什么」必须分别打开三个项目。同时缺少「需求」这一工作单元：一个需求通常包含多次改动、跨多个项目，现在只能靠标题和 `relatedProjects` 零散表达。

### 1.2 目标模型

```
版本（迭代/发布）
  └─ 需求（工作单元，关联项目）
       └─ 条目（一次具体改动，记录实际项目/文件/diff/阶段）
```

- **版本**是时间与发布维度的主线，全局唯一（V8.0.8）。
- **需求**是工作单元，一个需求可关联多个项目。
- **条目**是流水记录，保留实际改动的项目、stage、文件与 diff。

### 1.3 创建规则（用户明确要求）

- **AI 不得自动创建版本或需求**。
- 版本与需求由用户在页面手动创建，创建后生成可复制的唯一 id（`v_xxx` / `r_xxx`）。
- 用户把 id 告诉 AI，AI 只能写入指定版本/需求；id 不存在时明确报错并提示先创建。
- AI 可以查询现有版本/需求，帮用户确认写法，但**不提供写接口**。

## 2. 数据模型

```ts
interface WorklogData {
  /** 项目字典:名称、稳定 id、归属路径;不再作为树根 */
  projects: WorklogProject[];
  /** 顶层组织:版本 → 需求 → 条目 */
  versions: WorklogVersion[];
}

interface WorklogVersion {
  id: string;              // v_xxx
  name: string;            // 全局唯一,如 V8.0.8
  description?: string;
  createdAt: number;
  requirements: WorklogRequirement[];
}

interface WorklogRequirement {
  id: string;              // r_xxx
  title: string;           // 需求名称,版本内唯一
  description?: string;
  /** 需求级关联项目(名称快照 + id) */
  projects?: string[];
  projectIds?: string[];
  createdAt: number;
  entries: WorklogEntry[];
}

interface WorklogEntry {
  id: string;
  title: string;
  detail: string;
  /** 本条实际改动的项目(由路径归属或显式传入) */
  project?: string;
  projectId?: string;
  files?: WorklogEntryFile[];
  diff?: string;
  tags?: string[];
  stage?: WorkStage;
  sourcePath?: string;
  pathUnmatched?: boolean;
  relatedProjects?: string[];   // 保留:条目级补充关联
  relatedProjectIds?: string[];
  date: string;
  createdAt: number;
  updatedAt: number;
}
```

### 2.1 唯一约束

- 版本名全局唯一。
- 需求名在版本内唯一。
- 项目名仍全局唯一（字典键）。

## 3. MCP 接口

| 工具 | 变更 |
|---|---|
| `record_work` | 必填改为 `versionId`、`requirementId`、`title`、`detail`、`stage`；`project` 改为可选：不传时由路径归属推断，传入时必须是已存在的项目名（不自动创建）。id 不存在 → 报错并列出可选 id/名称 |
| `query_work` | 支持 `versionId` / `requirementId` / `project` / `stage`；结果附带版本与需求名称 |
| `list_versions` | 新增：列出版本（id、名称、需求数、条目数、首末日期） |
| `list_requirements` | 新增：按版本列出需求（id、名称、关联项目、条目数） |
| `update_work` / `delete_work` | 不变（按 entryId） |
| `delete_version` / `delete_project` | 语义调整：删除版本即删其需求与条目；删除项目只从字典移除，不删历史记录 |
| 版本/需求创建 | **不提供 MCP 写工具**，仅页面 |

工具描述（catalog）同步：明确「版本/需求必须由用户先建，AI 传 id；不要尝试创建或猜名称」。

## 4. 前端

### 4.1 树

```
版本 V8.0.8                     [复制 id] [新建需求]
  └─ 澳门底层数据建设            [复制 id]
  └─ 推荐基本学力修复
版本 V8.0.7 …
```

- 条目仍在右栏展示，树到需求级。
- 每个节点可复制 id（沿用现有 `CopyIdButton`）。
- 顶部操作：「新建版本」。
- 需求节点右键：「新建需求」「重命名」「删除」。

### 4.2 筛选与展示

- 项目筛选：按条目/需求的 `project` 过滤（保留现有下拉）。
- 阶段筛选：条目 `stage`。
- 关联项目：条目/需求的 `relatedProjects`。
- 条目卡片显示：实际项目、阶段、关联项目、id。

### 4.3 新建流程

- 新建版本：输入名称 + 描述 → 生成 `v_xxx` → 树中出现 → 复制 id 给 AI。
- 新建需求：在选中版本下输入名称 + 关联项目（多选）→ 生成 `r_xxx` → 复制 id 给 AI。

## 5. 数据迁移

一次性、幂等、HTTP 启动时执行（沿用现有迁移锁协议）：

1. **按版本名归并**：把所有 `projects[].versions[]` 按 `name` 合并为顶层 `versions[]`；同名版本的条目进入同一版本。
2. **每个版本建一个需求**，标题固定为 `澳门底层数据建设`；该版本下所有旧条目挂入。
3. **条目补齐 project**：原所属项目名写入 `entry.project`，并尽量映射 `projectId`。
4. **生成版本/需求 id**：`v_` / `r_` + 短随机。
5. **保留旧结构快照**：迁移前备份 `worklog.json`；迁移后写入标记 `.migration-version-requirement.json`。
6. 迁移不删除任何条目；旧 `projects[].versions` 字段迁移后移除。

> 说明：`worklog-template`、`v0.3.0` 等非业务版本同样按上述规则迁移，保持数据完整。

## 6. 知识库改造

### 6.1 存储

- 统一到 `resolveDataDir()/knowledge-base/`（现状：`~/.ai-task-flow/knowledge-base` 8 篇；项目内 `./knowledge-base` 67 篇为孤儿数据）。
- 提供一次性导入：把项目内 67 篇复制到数据目录（不删除原目录），冲突时保留两份并加后缀。
- 文件仍按主题目录存放（技术方案/工作日志/架构设计…），不按版本搬家。

### 6.2 元数据

文档 frontmatter 增加可选关联：

```yaml
---
title: xxx
versionId: v_xxx
requirementId: r_xxx
projectId: p_xxx
stage: dev
tags: [架构设计]
---
```

- `save_to_knowledge` 增加上述可选参数；缺省不关联。
- 关联字段只做「软关联」：被删除的版本/需求不做级联，展示为「已删除」。

### 6.3 树与视图

左侧树支持切换视图（单选，记忆上次选择）：

| 视图 | 组织方式 |
|---|---|
| 按分类（默认） | 现有目录树 |
| 按版本 | 版本 → 需求 → 文档（未关联文档归「未关联」） |
| 按项目 | 项目 → 文档 |
| 按阶段 | 阶段 → 文档 |

- 文档可同时在多个视图中出现；切换只影响树的组织，不影响存储。
- 搜索、标签筛选在所有视图下保持可用。

## 7. 结论卡

- 结论卡保持「一对话一卡」，不强制挂版本/需求。
- 可选增加 `versionId` / `requirementId` 字段，用于把结论关联到迭代；不参与树的组织。
- 本期不实现，登记为后续。

## 8. 错误与边界

| 场景 | 处理 |
|---|---|
| AI 传入不存在的 versionId/requirementId | 报错，返回现有 id 与名称列表，提示用户先创建 |
| 版本名重复创建 | 拒绝 |
| 需求名在版本内重复 | 拒绝 |
| 删除版本 | 二次确认；删其需求与条目（先备份） |
| 删除项目 | **语义变更（破坏性）**：只从项目字典移除，不再删除其历史条目；条目保留项目名称快照，路径归属失效。页面需明确提示 |
| 创建需求 | 关联项目必须已存在；不存在则拒绝并列出可选项目 |
| 知识库关联 id 不存在 | 拒绝写入该字段或降级为不关联并提示，不阻断文档保存 |
| 迁移重跑 | 标记文件 gate；已迁移则跳过 |
| 知识库文档关联的版本被删 | 显示「已删除关联」，文档保留 |

## 9. 测试

- 迁移：同名跨项目版本归并、每版本一个需求、条目 project 补齐、幂等、备份生成。
- MCP：id 不存在报错、query 按 versionId/requirementId 过滤、list 工具输出。
- 服务层：版本/需求创建校验（重名、空名）、删除级联与备份。
- 前端：树三级、复制 id、新建版本/需求、四种知识库视图切换。
- 回归：现有 277 / 166 / 17 用例按新模型调整后全绿。

## 10. 非目标

- 不做 AI 自动创建版本/需求。
- 不做需求状态机（进行中/完成）。
- 不做跨设备同步。
- 不在本期把结论卡纳入版本树。
