# AGENTS.md

---

## 一、通用原则 (Universal Principles)

### 1.1 设计哲学

- **极简导向**：少即是美，如无必要勿增实体 (KISS & YAGNI)。
- **性能平衡**：不追求极致优化，但拒绝显而易见的性能陷阱（如循环查库、N+1 查询）。
- **防御式编程**：优先"卫语句 (Guard Clauses)"尽早返回，拒绝深层嵌套（最多 3 层）。
- **关注点分离**：每个模块/函数只做一件事，高内聚低耦合。

### 1.2 通用编码规范

- **命名**：变量/函数用业务语义命名，禁止无意义缩写（循环索引 `i/j/k` 除外）。
- **异常处理**：禁止吞掉异常，禁止空 catch/except 块；异常信息必须包含上下文。
- **魔法值**：禁止裸数字/字符串散落在代码中，提取为常量或枚举。
- **注释**：解释 Why 而非 What；复杂业务逻辑必须写注释，显而易见的代码不写。

### 1.3 通用模式应用

- **策略模式**：`if-else > 3` 或复杂状态判断 → 重构为策略映射 (Map/Dict/Object)。
- **责任链/中间件**：多级校验、数据清洗场景优先使用。
- **Builder 模式**：参数 > 4 个的对象构建推荐使用。

### 1.4 任务执行流程

- **前置规划**：先规划（业务拆解 → 技术选型 → 流程梳理 → 方案输出）再编码。
- **后置总结**：任务完成后输出总结（实现思路、决策依据、优化点），除非用户明确不需要。
- **设计优先级**：需求优先聚焦接口设计（定义、入参出参、交互逻辑），数据库设计后置。

### 1.5 职业视角与决策维度

- **架构师**：技术选型合理性、扩展性、长期演进。
- **资深开发**：代码可读性、执行效率、落地成本、最佳实践。
- **产品经理**：业务价值、时间成本、可行性。
- **底线**：成本可控、时间可预期、交付质量有保障。

### 1.6 文档管理

- 持久化文档放在项目 `docs/` 目录下（不存在则创建）。
- 命名规则：`YYYYMMDDHHMMSS_文档标题`。
- 不要每次都写文档，除非用户明确提出或任务复杂度确实需要。
- 注意日志,前后端都需要日志，保存到文件中,方便排查.

---

## 二、Java 领域 (Java Domain)

### 2.1 架构与分层

- 严格遵循职责分层（Controller → Service → Repository/Mapper），禁止跨层调用。
- 领域逻辑内聚在 Service 层，Controller 只做参数校验和结果包装。
- 追求自闭环：一个领域模块尽量不依赖其他领域的内部实现。

### 2.2 编码规范

- **类引用**：使用 import 导入，禁止代码中出现全限定类名。
- **数据对象策略**：
  - RPC/SDK 接口 (Dubbo/Feign)：使用普通 POJO + Lombok `@Data`，确保序列化兼容。
  - 内部逻辑/HTTP 层：推荐 Record（Java 16+），利用不可变性提升安全性。
- **数据库操作**：所有读写优先批量处理，禁止单条循环操作。
- **技术栈**：优先选择与当前项目 JDK 和 Spring Boot 版本兼容的依赖。

### 2.3 数据库表设计

- 禁用外键约束（分布式架构考量）。
- 必需审计字段：`create_by`, `insert_time`, `update_time`, `del_status`。
- 索引设计跟随查询场景，禁止盲目加索引。

### 2.4 常用约定

- 方法参数 > 3 个时封装为请求对象。
- Service 方法返回业务对象而非 Entity，做好 DTO 转换。
- 日志打印包含关键业务参数，敏感字段脱敏。

---

## 三、Python 领域 (Python Domain)

### 3.1 代码风格

- 遵循 PEP 8，行宽 120 字符。
- 所有函数/方法必须添加类型注解（Type Hints），包括返回值。
- 优先使用 `dataclass` 或 `Pydantic BaseModel` 定义数据结构，少用裸 dict 传递业务数据。

### 3.2 项目结构

- 按功能/领域组织包结构，避免单文件过大（建议单文件 < 500 行）。
- 配置管理使用环境变量 + `.env` 文件，禁止硬编码密钥和连接串。
- 依赖管理使用 `pyproject.toml`（优先）或 `requirements.txt`，锁定版本号。

### 3.3 常用约定

- 异步场景优先使用 `async/await`，避免混用同步阻塞调用。
- 列表/字典推导式适度使用，超过两层嵌套时改为显式循环。
- 使用 `pathlib.Path` 处理路径，不用字符串拼接。
- 上下文管理器 (`with`) 管理资源（文件、连接、锁）。
- f-string 格式化字符串（Python 3.6+）。

### 3.4 测试

- 测试框架统一 `pytest`。
- 关键业务逻辑需有单元测试覆盖，工具函数优先写测试。

---

## 四、前端领域 (Frontend Domain)

### 4.1 通用规范

- **TypeScript 优先**：所有新代码使用 TS，严格模式 (`strict: true`)，禁止 `any`（实在不得已用 `unknown`）。
- **组件设计**：单一职责，UI 组件与业务逻辑分离（容器组件 vs 展示组件）。
- **状态管理**：能用局部状态解决的不上全局状态；全局状态按领域拆分 store。
- **组件封装**: 能够封装成组件的都封装,最好所有组件都可以随时抽出来单独放入组件库

### 4.2 React 约定（如适用）

- 函数组件 + Hooks，不使用 class 组件。
- 自定义 Hook 抽离可复用逻辑，命名 `useXxx`。
- `useEffect` 依赖数组必须完整声明，禁止空依赖数组执行有依赖的副作用。
- 列表渲染必须提供稳定唯一 `key`，禁止使用数组索引。
- 组件 Props 定义 interface，导出供外部使用。

### 4.3 前端框架约定

> 本项目前端为 **React 19 + shadcn/ui(Radix) + Tailwind CSS v4 + Zustand**(详见 4.2 节),不使用 Vue。
> 若未来引入 Vue 3 项目,遵循 Composition API + `<script setup>` + `defineProps<T>()` + `ref`/`reactive` 惯例。

### 4.4 样式与 CSS

- 组件级样式使用 CSS Modules / Scoped CSS / CSS-in-JS，避免全局污染。
- 设计 Token（颜色、间距、字号）提取为 CSS 变量或主题常量，禁止硬编码。
- 响应式设计移动端优先 (mobile-first)，使用相对单位 (rem/em/%)。

### 4.5 工程化

- ESLint + Prettier 统一代码风格，提交前自动格式化。
- 路由懒加载，大型依赖按需导入 (tree-shaking)。
- 图片资源压缩，合理使用 WebP 格式和懒加载。
- API 请求层统一封装（拦截器处理 token、错误码、loading 状态）。

---

## 五、测试驱动开发 (TDD Strategy)

### 5.1 TDD 核心流程

- 严格遵循 Red → Green → Refactor 循环：先写失败测试 → 最小实现通过 → 重构优化。
- 每个功能点先定义"什么算完成"（验收条件），再转化为测试用例。
- 测试粒度：单元测试覆盖核心逻辑，集成测试覆盖模块协作，E2E 测试覆盖关键链路。

### 5.2 curl 测试驱动（API 层 TDD）

适用于 HTTP 接口的快速验证，在接口开发过程中同步编写。

```bash
# 放置位置：项目根目录 tests/curl/ 或 tests/api/
# 命名规则：test_<模块>_<场景>.sh

# --- 示例：tests/curl/test_user_create.sh ---
#!/bin/bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"

echo "=== 测试：创建用户 - 正常场景 ==="
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/users" \
  -H "Content-Type: application/json" \
  -d '{"name": "test", "email": "test@example.com"}')

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ne 200 ]; then
  echo "FAIL: 期望 200，实际 $HTTP_CODE"
  echo "Response: $BODY"
  exit 1
fi

echo "PASS"

echo "=== 测试：创建用户 - 参数缺失 ==="
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/users" \
  -H "Content-Type: application/json" \
  -d '{"name": ""}')

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
if [ "$HTTP_CODE" -ne 400 ]; then
  echo "FAIL: 期望 400，实际 $HTTP_CODE"
  exit 1
fi

echo "PASS"
echo "=== 全部通过 ==="
```

**约定：**
- 每个 curl 测试脚本必须包含正常场景和异常场景（至少各一个）。
- 使用 `set -euo pipefail` 确保失败立即退出。
- 支持环境变量覆盖 `BASE_URL`，方便多环境执行。
- 复杂断言（JSON 字段校验）使用 `jq` 提取判断。

### 5.3 原生单元测试 TDD

各语言测试框架与约定：

| 语言 | 框架 | 测试目录 | 命名规则 |
|------|------|----------|----------|
| Java | JUnit 5 + Mockito | `src/test/java/` | `XxxTest.java` / `XxxServiceTest.java` |
| Python | pytest | `tests/` | `test_xxx.py` |
| JS/TS | Vitest / Jest | `__tests__/` 或 `*.test.ts` | `xxx.test.ts` / `xxx.spec.ts` |

**编写原则：**
- 测试方法命名：`should_<预期行为>_when_<前置条件>`（或对应语言的惯用风格）。
- 每个测试只验证一个行为，禁止一个 test case 塞多个断言逻辑。
- Mock 外部依赖（数据库、HTTP、MQ），不 Mock 被测对象自身方法。
- 测试数据就近构造，禁止依赖共享可变状态。

### 5.4 Shell 脚本测试与自动化

```bash
# --- 示例：tests/run_all.sh（测试编排脚本）---
#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PASSED=0
FAILED=0

echo "=============================="
echo " Running All Tests"
echo "=============================="

for test_file in "$SCRIPT_DIR"/curl/test_*.sh; do
  echo ""
  echo "▶ Running: $(basename "$test_file")"
  if bash "$test_file"; then
    ((PASSED++))
  else
    ((FAILED++))
    echo "✗ FAILED: $(basename "$test_file")"
  fi
done

echo ""
echo "=============================="
echo " Results: $PASSED passed, $FAILED failed"
echo "=============================="

[ "$FAILED" -eq 0 ] || exit 1
```

**Shell 脚本约定：**
- 所有脚本头部加 `set -euo pipefail`。
- 提供 `run_all.sh` 作为统一入口，支持一键跑全部测试。
- 脚本输出清晰的 PASS/FAIL 标记和汇总统计。
- CI 环境可直接调用 `bash tests/run_all.sh` 集成。

### 5.5 TDD 工作节奏

1. 拿到需求 → 先写接口契约（入参、出参、状态码）
2. 根据契约写 curl 测试脚本（API 层红灯）
3. 写核心逻辑的单元测试（Service 层红灯）
4. 实现代码让测试变绿
5. 重构，保持测试全绿
6. 提交前执行 `run_all.sh` 确认无回归

---

## 六、大型复杂任务分解 (Complex Task Decomposition)

### 6.1 分解原则

- **自顶向下**：先看全局再拆局部，避免一头扎进细节。
- **交付粒度**：每个子任务必须有可验证的交付物（能跑的代码、能调的接口、能看的页面）。
- **依赖最小化**：子任务之间尽量解耦，可并行推进；有依赖的明确标注先后顺序。
- **单任务时间盒**：单个子任务控制在 30 分钟~2 小时可完成的粒度，超过则继续拆。

### 6.2 分解流程（五步法）

```
Step 1: 需求澄清
  └─ 明确业务目标、边界条件、验收标准
  └─ 产出：需求确认清单（含明确的 Done 定义）

Step 2: 架构草案
  └─ 技术选型、模块划分、核心流程图
  └─ 产出：模块依赖关系图 + 接口契约草案

Step 3: 任务拆解
  └─ 按模块/层级拆为可独立交付的子任务
  └─ 产出：任务清单（含优先级 P0/P1/P2、依赖关系、预估耗时）

Step 4: 逐个击破
  └─ 按优先级 + 依赖顺序逐个实现
  └─ 每个子任务走 TDD 流程（5.5 节）
  └─ 每完成一个子任务做一次阶段验证

Step 5: 集成收尾
  └─ 模块联调、端到端测试、边界场景补充
  └─ 产出：完成总结（决策记录、遗留问题、优化建议）
```

### 6.3 任务清单模板

在分解任务时使用如下格式输出：

```markdown
## 任务：<总体目标>

### 前置准备
- [ ] P0 | 需求澄清 & 接口契约定义 | 预估 30min

### 核心实现
- [ ] P0 | <子任务1：描述> | 依赖：无 | 预估 1h
- [ ] P0 | <子任务2：描述> | 依赖：子任务1 | 预估 1.5h
- [ ] P1 | <子任务3：描述> | 依赖：无 | 预估 45min

### 测试与联调
- [ ] P0 | 单元测试补充 | 依赖：核心实现完成 | 预估 1h
- [ ] P0 | curl 集成测试 | 依赖：核心实现完成 | 预估 30min
- [ ] P1 | 端到端验证 | 依赖：全部完成 | 预估 30min

### 收尾
- [ ] P2 | 代码审查 & 重构 | 预估 30min
- [ ] P2 | 文档输出（如需要）| 预估 20min
```

### 6.4 复杂度判断标准

什么时候需要启动正式的任务分解流程：

- 涉及 **3 个以上模块/服务** 的协作变更
- 预估开发时间 **> 4 小时**
- 涉及 **数据库表结构变更** + 业务逻辑变更的组合
- 需要 **多端联调**（前后端、多服务）
- 需求描述模糊，需要先做方案对齐

不满足以上条件的简单任务，直接走 TDD 流程即可，无需额外的分解仪式。

---

## 七、协作备忘 (Collaboration Notes)

- 我更倾向于先看方案再写代码，请在动手前先给出思路。
- 遇到模糊需求时主动追问，不要自行假设关键业务逻辑。
- 代码变更尽量最小化影响面，改动前评估关联影响。
- Git 提交信息遵循 Conventional Commits 格式：`feat:` / `fix:` / `refactor:` / `docs:` / `chore:`。

永远使用中文与我对话

---

## 八、记忆系统集成 (Memory Integration)

### 8.1 记忆库架构

**本地优先的记忆系统**：记忆文件存储在 Codex 原生 memory 目录，可选用云同步工具（OneDrive/Dropbox）实现跨设备。

- **主存储目录**：`C:\Users\fjyu9\.Codex\projects\C--Users-fjyu9\memory\`
- **索引文件**：`MEMORY.md`（自动加载前200行）

### 8.2 记忆分类

| 类型 | 目录/文件 | 说明 |
|------|----------|------|
| 偏好 | `preferences/` | 编码风格、工具选择、工作习惯 |
| 决策 | `decisions/` | 技术选型、架构决策及原因 |
| 流程 | `procedures/` | 操作流程（部署、调试、发布等可复用步骤） |
| 项目 | `projects/` | 项目上下文、进度、关键信息 |
| 调试 | `debugging.md` | 踩坑记录和解决方案 |

### 8.3 使用记忆的规则

**每次会话开始时：**
- 自动加载 `MEMORY.md` 前200行
- 根据当前任务加载相关分类文件

**处理任务时参考优先级：**
1. 偏好 → `memory/preferences/`
2. 决策记录 → `memory/decisions/`
3. 操作流程 → `memory/procedures/`
4. 项目上下文 → `memory/projects/`
5. 调试经验 → `memory/debugging.md`

### 8.4 记忆触发条件

**显式触发（用户明确要求）：**
- 用户说"记住"/"记录"/"添加到记忆"/"更新记忆"

**隐式触发（AI 自动检测，即时记录）：**
- 用户在3次以上对话中提到同一习惯或偏好
- 检测到明确的技术选型或架构决策
- 发现用户重复的工作流程模式
- 遇到用户反复遇到的错误并已解决

**定时触发：**
- 每周日晚上8点自动运行周总结

### 8.5 记忆更新流程

```
1. 检测到可记忆信息
   ├─ 检查是否已存在（避免重复）
   └─ 判断归属分类

2. 用户确认
   ├─ 简要说明要记录的内容
   └─ 请求用户确认

3. 写入记忆
   ├─ 写入对应分类文件
   └─ 更新 MEMORY.md 索引（一行摘要）
```

### 8.6 记忆维护

**定期清理（月度）：**
- 检查记忆是否过时，与当前项目状态对比
- 已完成项目的上下文归档或精简
- 过时的调试经验移除（问题已不存在）

**MEMORY.md 索引规范：**
- 每条索引一行，格式：`- [标题](文件路径) — 一句话摘要`
- 索引超过200行时，移除低优先级条目

### 8.7 安全注意事项

**禁止记录的内容：**
- API 密钥、密码、临时凭证
- 敏感个人信息
- 未脱敏的生产数据

**如检测到敏感信息：** 立即停止记录并通知用户




# AI Task Flow - Codex 项目指导

## 项目概述

> **2026-11 worklog 转型**: 任务编排看板/AI 聊天/任务文档/用量统计已砍除(代码在 git 历史,旧数据文件保留于
> ~/.ai-task-flow)。下文关于看板/worktree/MCP 任务工具的描述为历史设计,仅作背景。

**产品定位**: 个人 AI 工作记录中枢 + 个人工具集合。核心循环:在终端用 Claude Code/ZCode 干活 →
AI 通过 MCP 调 record_work 记录「建设主题 → 版本 → 需求 → 条目」(含 diff 与文件行号) → 工作记录页
(默认视图)按主题/版本/需求回溯、按项目(条目属性)筛选,页面直接看 diff,支持人工增删改与重命名。
建设主题、版本与需求由用户在页面创建,AI 先用 list_programs/list_versions/list_requirements 取 id 再写入;
项目是条目属性与路径归属字典,不再是树根。
其余模块(知识库/思维导图/生词本/墨墨/网页剪藏/Claude 配置切换)为个人工具延伸。
MCP 工具说明见工作记录页「AI 使用指南」。

**核心价值**: 干完活先记录再汇报,成果不留在对话里;删除/重命名自动快照备份(~/.ai-task-flow/worklog-backups/,
保留 10 份);旧任务存档仍在 ~/.ai-task-flow/tasks/(DocsView 已移除,手工可看)。

**技术栈**: 
- Backend: Node.js + TypeScript + Fastify + @modelcontextprotocol/sdk
- Frontend: React 19 + TypeScript + Vite + shadcn/ui(Radix) + Tailwind CSS v4 + Zustand
- Architecture: DDD 四层 + worklog 双层锁写协议(进程内 mutex + proper-lockfile 跨进程文件锁)

**MVP 周期**: 2-3 周

---

---

## 历史文档与归档(旧看板时代,仅作决策背景)

> 以下为 2026-06~08 任务编排看板时代的文档与实施指南,对应功能已随 worklog 转型砍除。
> 新会话请勿按其执行;了解当时设计动机时可查阅。

- 旧版设计/实施计划:`.Codex/2026-06-05-ai-task-flow-*.md`(Task 1-5)、
  `docs/plans/2026-06-05-ai-task-flow-phase3-6-summary.md`(Task 6-35 概要)
- 各阶段设计与踩坑归档:`docs/` 下 `YYYYMMDDHHMMSS_*` 命名的历史文档
- 旧功能代码:git 历史(任务派发/聊天/SSE/worktree/用量,2026-11 转型时移除)
- 旧数据:保留于 `~/.ai-task-flow/`(tasks.json/chats.json/tasks 存档等,不再有页面入口)

**现行文档入口**(权威,勿与历史混淆):
- README.md —— 项目概览/快速启动/模块清单/文档地图
- docs/mcp-registration.md —— MCP 注册登记与版本记录(更新 SOP)
- docs/plans/2026-11-17-worklog-slim-design.md —— 现行产品设计与架构决策
