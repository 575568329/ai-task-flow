---
tags: [AI协作, Claude-Code, Super-Powers, Subagent, 学习笔记, 工程实践]
---

# Claude Code 与 Super Powers 工程实践学习笔记

> 手写笔记转录(2026-07-12),主题:Super Powers skills、Skill 串联机制、Super Powers 记忆保存、hooks、Claude Code 工具实现与 OpenCode 对比。

## 一、Super Powers skills 的内容

设计理念:**SDI(先设计再执行)**

0. 拿到需求 → 需求澄清/评审
1. **头脑风暴**(很重要,要按需求澄清):用数据去找漏洞,提前提要求(澄清)
2. **Writing-Plans(写开发计划)**
   - 开发计划写到什么程度?小型/中型需求要求写到具体页面
   - 新技术、项目规范、约束(前端严格样式规范;CSS 不要随意写在文档下;按页面按需引入,避免引入巨型文件)
   - 重要的约束要确认并记录
   - 不要随便优化代码,用注释说明
   - 设计要注意:思路、技术选型、方法
   - 项目目录结构、数据库表设计是否合理(需要评审)
   - 需要人介入设计评审;不放心可以先写一个开发计划
3. **Executing-Plan(执行计划)**
   - 给对应权限(`setting.local.json`)
   - 分步骤跟踪变更,但不推送
   - 不允许回退 `git revert`
     ```
     lang: [
       "Bash(git reset)",
       "Bash(git -c * reset)"
     ]
     ```
   - 可以要求先做完再审核;也可以选择边做边看

## 二、Skill 串联机制

- Plan 先假设执行者需要上下文信息,准备步骤的详细组成,支持 subagent 执行
- **4. TDD(test-driven-development)**
- **subagent-driven level development**:主 agent 编排 + 需要上下文的子 agent 实现 + 人审查。核心工程智慧:**上下文隔离**
- 关注点:文件传递消耗 token、按任务难度分配模型、控制成本、ledger 的计算复杂度
- 思考:这些点是怎么用 skill 串起来的?常单独使用的 skill 有哪些、什么场景?类似 Super Powers 的技能有哪些?

**步骤怎么串联:**

- Skill 中执行到某一步时,用**文本指令**串联,告诉 LLM 下一步用什么 Skill
- **Subagent**:工具在运行时编排(Agent/Task 工具生成子 agent 写代码/审阅,工具调用时编排)
- **共享文件**:作为 Skill 间传递产物的协议,各步骤在指定文件夹留下文件产物
- **hooks/session-start**:会话开始时加载 `using-skill superpower`
- 整体:文本指令告知下一步 Skill + subagent 编排 + 步骤间留文件沟通 + hooks 触发

## 三、Super Powers 记忆保存

因为上下文会被 agent 压缩 → 用**文件**保存任务和状态。
任务完成后在文件后面标注完成状态;后续读取时直接看状态,继续未完成任务。
核心思想:**不信任上下文,信任文件记录**。

## 四、hooks 类型

- `session-start`:会话开始
- `user-prompt-submit`:发消息时
- `pre-tool-use`:工具调用前
- `post-tool-use`:工具调用后
- `stop`:agent 停止后
- `notification`:通知时

## 五、Claude Code 工具实现 & OpenCode 对比

- Claude Code 约 **25 个工具**;改代码/diff:给 LLM,MCP 无限扩展,跟源代码比对,返回旧代码和新代码,执行**整段代码替换**
- **OpenCode**:开源、go 语言开发,性能差
- 执行哲学对比:
  - Claude Code:用 `CLAUDE.md`(权限申明)
  - OpenCode:控制式(自由,事后验证)

## 六、待研究问题

- Claude Code 有多少个工具/Task,功能怎么实现的(改代码/diff 等)?
- OpenCode 和它有什么差距?OpenCode 怎么实现的,有哪些需要了解?
- **用 Astron 桥接 GLM** 怎么做?
- sandbox 是什么,有什么作用?
- qwenpaw 是什么,有什么作用?
- go 语言理解
- 工程实践对个人 / 对公司的价值有哪些?
