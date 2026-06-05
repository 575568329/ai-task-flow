# AI Task Flow v3 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 构建一个 MCP Server + 看板的 AI 任务编排工具，保留原生 Claude Code 体验同时实现状态自动同步

**Architecture:** DDD 四层（domain/application/infrastructure/interfaces），双接口（HTTP REST+SSE 给前端，MCP stdio 给 Claude Code），git worktree 隔离，EventBus 跨域协作

**Tech Stack:** 
- Backend: Node.js + TypeScript + Fastify + @modelcontextprotocol/sdk + simple-git + Zod + tsyringe
- Frontend: Vue 3 + TypeScript + Vite + Element Plus + diff2html-vue3
- Storage: JSON 文件 + EventStore (JSONL)
- Git: worktree per task

**MVP 周期:** 2-3 周

**路线图:**
- Week 1: 项目初始化 + DDD 骨架 + Worktree + 任务 CRUD
- Week 2: MCP Server + 5 个工具 + stdio 集成
- Week 3: 前端看板 + SSE 推送 + Diff 审查 + E2E

---

## Phase 1: 项目初始化与 DDD 骨架 (Day 1-2)

### Task 1: 项目结构搭建

**Files:**
- Create: `C:\Users\fjyu9\Desktop\ai-task-flow\package.json`
- Create: `C:\Users\fjyu9\Desktop\ai-task-flow\.gitignore`
- Create: `C:\Users\fjyu9\Desktop\ai-task-flow\README.md`
- Create: `C:\Users\fjyu9\Desktop\ai-task-flow\backend\package.json`
- Create: `C:\Users\fjyu9\Desktop\ai-task-flow\frontend\package.json`

**Step 1: 创建根 package.json (monorepo 管理)**

```json
{
  "name": "ai-task-flow",
  "version": "0.1.0",
  "private": true,
  "workspaces": [
    "backend",
    "frontend",
    "shared"
  ],
  "scripts": {
    "dev": "concurrently \"npm run dev:backend\" \"npm run dev:frontend\"",
    "dev:backend": "cd backend && npm run dev",
    "dev:frontend": "cd frontend && npm run dev",
    "build": "npm run build:shared && npm run build:backend && npm run build:frontend",
    "build:backend": "cd backend && npm run build",
    "build:frontend": "cd frontend && npm run build",
    "build:shared": "cd shared && npm run build"
  },
  "devDependencies": {
    "concurrently": "^8.2.2"
  }
}
```

**Step 2: 创建 .gitignore**

```
node_modules/
dist/
.ai-workspaces/
*.log
.env
.DS_Store
```

**Step 3: 创建 README.md**

```markdown
# AI Task Flow v3

个人 AI 任务编排看板 + MCP Server

## 快速开始

1. 安装依赖: `npm install`
2. 启动开发: `npm run dev`
3. 配置 Claude Code: 复制 `docs/claude.json.example` 到 `~/.claude.json`
4. 打开浏览器: http://localhost:5173

详见 `docs/plans/2026-06-05-ai-task-flow-design.md`
```

**Step 4: 创建后端 package.json**

```json
{
  "name": "@ai-task-flow/backend",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "test": "vitest",
    "mcp": "node dist/interfaces/mcp/mcp-server.js"
  },
  "dependencies": {
    "fastify": "^4.26.0",
    "@fastify/cors": "^9.0.1",
    "zod": "^3.22.4",
    "tsyringe": "^4.8.0",
    "simple-git": "^3.22.0",
    "@modelcontextprotocol/sdk": "^0.5.0",
    "nanoid": "^5.0.5"
  },
  "devDependencies": {
    "typescript": "^5.3.3",
    "tsx": "^4.7.0",
    "vitest": "^1.2.1",
    "@types/node": "^20.11.5"
  }
}
```

**Step 5: 创建前端 package.json**

```json
{
  "name": "@ai-task-flow/frontend",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "vue": "^3.4.15",
    "vue-router": "^4.2.5",
    "pinia": "^2.1.7",
    "element-plus": "^2.5.5",
    "@element-plus/icons-vue": "^2.3.1",
    "axios": "^1.6.5",
    "diff2html": "^3.4.47"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.0.3",
    "vite": "^5.0.11",
    "typescript": "^5.3.3",
    "vue-tsc": "^1.8.27"
  }
}
```

**Step 6: 安装依赖**

Run: `npm install`
Expected: 所有依赖安装成功

**Step 7: Commit**

```bash
git init
git add .
git commit -m "chore: 项目初始化 - monorepo 结构

- 配置 workspaces: backend / frontend / shared
- 添加基础依赖: Fastify, Vue3, MCP SDK, simple-git
- 配置开发脚本: dev / build / test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 后端 TypeScript 配置与目录结构

**Files:**
- Create: `backend/tsconfig.json`
- Create: `backend/src/domain/workflow/entities/Task.ts`
- Create: `backend/src/domain/_shared/DomainEvent.ts`
- Create: `backend/src/application/workflow/.gitkeep`
- Create: `backend/src/infrastructure/persistence/.gitkeep`
- Create: `backend/src/interfaces/http/.gitkeep`
- Create: `backend/src/interfaces/mcp/.gitkeep`

**Step 1: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 2: 创建 DDD 目录结构**

Run: 
```bash
cd backend/src
mkdir -p domain/workflow/entities domain/workflow/value-objects domain/workflow/services domain/workflow/events
mkdir -p domain/_shared
mkdir -p application/workflow application/mcp
mkdir -p infrastructure/persistence infrastructure/git infrastructure/pubsub
mkdir -p interfaces/http/routes interfaces/http/controllers
mkdir -p interfaces/mcp/tools
touch application/workflow/.gitkeep infrastructure/persistence/.gitkeep interfaces/http/.gitkeep interfaces/mcp/.gitkeep
```

Expected: 目录结构符合设计文档第四章 4.2

**Step 3: 创建 DomainEvent 基类**

```typescript
// backend/src/domain/_shared/DomainEvent.ts
import { nanoid } from 'nanoid';

export abstract class DomainEvent {
  public readonly eventId: string;
  public readonly occurredAt: Date;
  public readonly eventType: string;

  constructor(
    public readonly aggregateId: string,
  ) {
    this.eventId = nanoid();
    this.occurredAt = new Date();
    this.eventType = this.constructor.name;
  }
}
```

**Step 4: Commit**

```bash
git add .
git commit -m "chore(backend): 配置 TypeScript + DDD 目录结构

- tsconfig.json: Node16 模块 + 严格模式
- 四层目录: domain / application / infrastructure / interfaces
- DomainEvent 基类 (eventId / occurredAt / eventType)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: TaskStatus 与 Priority 值对象

**Files:**
- Create: `backend/src/domain/workflow/value-objects/TaskStatus.ts`
- Create: `backend/src/domain/workflow/value-objects/Priority.ts`
- Create: `backend/src/domain/workflow/value-objects/TaskId.ts`

**Step 1: 创建 TaskStatus 枚举**

```typescript
// backend/src/domain/workflow/value-objects/TaskStatus.ts
export enum TaskStatus {
  PLANNING = 'planning',
  TODO = 'todo',
  DISPATCHED = 'dispatched',
  REVIEW = 'review',
  DONE = 'done',
  BLOCKED = 'blocked',
}

export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  const validTransitions: Record<TaskStatus, TaskStatus[]> = {
    [TaskStatus.PLANNING]: [TaskStatus.TODO],
    [TaskStatus.TODO]: [TaskStatus.DISPATCHED, TaskStatus.BLOCKED],
    [TaskStatus.DISPATCHED]: [TaskStatus.REVIEW, TaskStatus.BLOCKED],
    [TaskStatus.REVIEW]: [TaskStatus.DONE, TaskStatus.TODO],
    [TaskStatus.DONE]: [],
    [TaskStatus.BLOCKED]: [TaskStatus.TODO],
  };
  return validTransitions[from].includes(to);
}
```

**Step 2: 创建 Priority 值对象**

```typescript
// backend/src/domain/workflow/value-objects/Priority.ts
export enum Priority {
  P0 = 'P0',
  P1 = 'P1',
  P2 = 'P2',
}

export function priorityWeight(p: Priority): number {
  return { [Priority.P0]: 3, [Priority.P1]: 2, [Priority.P2]: 1 }[p];
}
```

**Step 3: 创建 TaskId 值对象**

```typescript
// backend/src/domain/workflow/value-objects/TaskId.ts
export class TaskId {
  private constructor(public readonly value: string) {
    if (!/^[A-Z]+-\d+$/.test(value)) {
      throw new Error(`Invalid TaskId format: ${value}`);
    }
  }

  static create(prefix: string, num: number): TaskId {
    return new TaskId(`${prefix}-${num.toString().padStart(3, '0')}`);
  }

  static fromString(value: string): TaskId {
    return new TaskId(value);
  }

  toString(): string {
    return this.value;
  }

  equals(other: TaskId): boolean {
    return this.value === other.value;
  }
}
```

**Step 4: 写单元测试**

```typescript
// backend/src/domain/workflow/value-objects/__tests__/TaskId.test.ts
import { describe, it, expect } from 'vitest';
import { TaskId } from '../TaskId';

describe('TaskId', () => {
  it('should create valid task id', () => {
    const id = TaskId.create('WS', 1);
    expect(id.value).toBe('WS-001');
  });

  it('should throw on invalid format', () => {
    expect(() => TaskId.fromString('invalid')).toThrow();
  });

  it('should compare equality', () => {
    const id1 = TaskId.fromString('WS-001');
    const id2 = TaskId.fromString('WS-001');
    expect(id1.equals(id2)).toBe(true);
  });
});
```

**Step 5: 运行测试**

Run: `cd backend && npm test`
Expected: 3 tests pass

**Step 6: Commit**

```bash
git add backend/src/domain/workflow/value-objects
git commit -m "feat(domain): 添加 TaskStatus / Priority / TaskId 值对象

- TaskStatus: 6 状态枚举 + 状态转换验证
- Priority: P0/P1/P2 + 权重计算
- TaskId: WS-001 格式 + 工厂方法 + 相等性比较
- 单元测试覆盖

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

由于完整实施计划会非常长（预计 50+ 个 Task，每个 Task 5-7 步骤），写完会超出单次写入限制。

**建议节奏**：我先把核心架构的前 10 个 Task 写完（Phase 1-2: 后端核心），保存当前进度，然后你可以：
1. 先按这前 10 个 Task 开始实施
2. 我后续继续追加 Phase 3（MCP Server）和 Phase 4（前端）的详细步骤

---

## Phase 2: Worktree 管理与 Git 集成 (Day 3-4)

### Task 4: WorktreeManager 基础设施

**Files:**
- Create: `backend/src/infrastructure/git/WorktreeManager.ts`
- Create: `backend/src/infrastructure/git/__tests__/WorktreeManager.test.ts`
- Create: `backend/src/domain/workflow/value-objects/WorktreeRef.ts`

**Step 1: 安装 simple-git**

Run: `cd backend && npm install simple-git`
Expected: simple-git@3.22.0+ 安装成功

**Step 2: 创建 WorktreeRef 值对象**

```typescript
// backend/src/domain/workflow/value-objects/WorktreeRef.ts
export class WorktreeRef {
  constructor(
    public readonly path: string,
    public readonly branch: string,
    public readonly baseCommit: string,
    public readonly createdAt: Date,
  ) {}

  static create(projectPath: string, taskId: string, baseCommit: string): WorktreeRef {
    const path = `${projectPath}/.ai-workspaces/${taskId}`;
    const branch = `ai-task/${taskId}`;
    return new WorktreeRef(path, branch, baseCommit, new Date());
  }
}
```

**Step 3: 编写 WorktreeManager 核心逻辑**

```typescript
// backend/src/infrastructure/git/WorktreeManager.ts
import simpleGit, { SimpleGit } from 'simple-git';
import { WorktreeRef } from '../../domain/workflow/value-objects/WorktreeRef.js';
import fs from 'fs/promises';
import path from 'path';

export class WorktreeManager {
  async create(projectPath: string, taskId: string): Promise<WorktreeRef> {
    const git: SimpleGit = simpleGit(projectPath);
    
    // 获取当前 main HEAD
    const baseCommit = await git.revparse(['HEAD']);
    
    // 创建 worktree 引用
    const ref = WorktreeRef.create(projectPath, taskId, baseCommit.trim());
    
    // 确保 .ai-workspaces 目录存在
    const workspacesDir = path.join(projectPath, '.ai-workspaces');
    await fs.mkdir(workspacesDir, { recursive: true });
    
    // 创建新分支并创建 worktree
    await git.checkoutBranch(ref.branch, 'main');
    await git.raw(['worktree', 'add', ref.path, ref.branch]);
    
    // 写入 meta.json
    const meta = {
      taskId,
      createdAt: ref.createdAt.toISOString(),
      baseCommit: ref.baseCommit,
      projectPath,
    };
    await fs.writeFile(
      path.join(ref.path, '.ai-meta.json'),
      JSON.stringify(meta, null, 2)
    );
    
    return ref;
  }

  async destroy(ref: WorktreeRef): Promise<void> {
    const git: SimpleGit = simpleGit(path.dirname(ref.path));
    
    // 删除 worktree
    await git.raw(['worktree', 'remove', ref.path, '--force']);
    
    // 删除分支
    await git.deleteLocalBranch(ref.branch, true);
  }

  async getDiff(ref: WorktreeRef, baseBranch: string = 'main'): Promise<string> {
    const git: SimpleGit = simpleGit(ref.path);
    const diff = await git.diff([`${baseBranch}...${ref.branch}`]);
    return diff;
  }

  async listAll(projectPath: string): Promise<WorktreeRef[]> {
    const git: SimpleGit = simpleGit(projectPath);
    const result = await git.raw(['worktree', 'list', '--porcelain']);
    
    // 解析 worktree list 输出
    const worktrees: WorktreeRef[] = [];
    const lines = result.split('\n');
    let currentPath = '';
    let currentBranch = '';
    
    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        currentPath = line.substring(9);
      } else if (line.startsWith('branch ')) {
        currentBranch = line.substring(7);
        if (currentBranch.startsWith('refs/heads/ai-task/')) {
          // 读取 meta.json 获取完整信息
          try {
            const metaPath = path.join(currentPath, '.ai-meta.json');
            const metaContent = await fs.readFile(metaPath, 'utf-8');
            const meta = JSON.parse(metaContent);
            worktrees.push(new WorktreeRef(
              currentPath,
              currentBranch.replace('refs/heads/', ''),
              meta.baseCommit,
              new Date(meta.createdAt)
            ));
          } catch {
            // meta.json 不存在，跳过
          }
        }
      }
    }
    
    return worktrees;
  }
}
```

**Step 4: 编写单元测试（需要真实 git 仓库）**

```typescript
// backend/src/infrastructure/git/__tests__/WorktreeManager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorktreeManager } from '../WorktreeManager';
import simpleGit from 'simple-git';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('WorktreeManager', () => {
  let testRepoPath: string;
  let manager: WorktreeManager;

  beforeEach(async () => {
    // 创建临时测试仓库
    testRepoPath = path.join(os.tmpdir(), `test-repo-${Date.now()}`);
    await fs.mkdir(testRepoPath, { recursive: true });
    
    const git = simpleGit(testRepoPath);
    await git.init();
    await git.addConfig('user.name', 'Test');
    await git.addConfig('user.email', 'test@test.com');
    
    // 创建初始 commit
    await fs.writeFile(path.join(testRepoPath, 'README.md'), '# Test');
    await git.add('.');
    await git.commit('Initial commit');
    
    manager = new WorktreeManager();
  });

  afterEach(async () => {
    // 清理测试仓库
    await fs.rm(testRepoPath, { recursive: true, force: true });
  });

  it('should create worktree with correct structure', async () => {
    const ref = await manager.create(testRepoPath, 'test-001');
    
    expect(ref.path).toContain('.ai-workspaces/test-001');
    expect(ref.branch).toBe('ai-task/test-001');
    
    // 验证 worktree 目录存在
    const stat = await fs.stat(ref.path);
    expect(stat.isDirectory()).toBe(true);
    
    // 验证 meta.json 存在
    const metaPath = path.join(ref.path, '.ai-meta.json');
    const metaContent = await fs.readFile(metaPath, 'utf-8');
    const meta = JSON.parse(metaContent);
    expect(meta.taskId).toBe('test-001');
  });

  it('should destroy worktree cleanly', async () => {
    const ref = await manager.create(testRepoPath, 'test-002');
    await manager.destroy(ref);
    
    // 验证 worktree 目录已删除
    await expect(fs.stat(ref.path)).rejects.toThrow();
  });

  it('should get git diff between worktree and main', async () => {
    const ref = await manager.create(testRepoPath, 'test-003');
    
    // 在 worktree 里修改文件
    await fs.writeFile(path.join(ref.path, 'test.txt'), 'changed');
    const git = simpleGit(ref.path);
    await git.add('.');
    await git.commit('Test change');
    
    const diff = await manager.getDiff(ref);
    expect(diff).toContain('test.txt');
    expect(diff).toContain('changed');
  });
});
```

**Step 5: 运行测试**

Run: `cd backend && npm test WorktreeManager`
Expected: 3 tests pass

**Step 6: Commit**

```bash
git add backend/src/infrastructure/git backend/src/domain/workflow/value-objects/WorktreeRef.ts
git commit -m "feat(infrastructure): 实现 WorktreeManager

- create(): 创建 git worktree + 新分支 + meta.json
- destroy(): 删除 worktree + 分支
- getDiff(): 获取 worktree 相对 main 的 diff
- listAll(): 列出所有 ai-task worktrees
- 单元测试覆盖（真实 git 操作）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Task 聚合根实现

**Files:**
- Create: `backend/src/domain/workflow/entities/Task.ts`
- Create: `backend/src/domain/workflow/events/TaskDispatched.ts`
- Create: `backend/src/domain/workflow/events/TaskResultRecorded.ts`
- Create: `backend/src/domain/workflow/value-objects/ExecutionResult.ts`

**Step 1: 创建领域事件**

```typescript
// backend/src/domain/workflow/events/TaskDispatched.ts
import { DomainEvent } from '../../_shared/DomainEvent.js';
import { WorktreeRef } from '../value-objects/WorktreeRef.js';

export class TaskDispatched extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly worktree: WorktreeRef,
  ) {
    super(aggregateId);
  }
}
```

```typescript
// backend/src/domain/workflow/events/TaskResultRecorded.ts
import { DomainEvent } from '../../_shared/DomainEvent.js';
import { ExecutionResult } from '../value-objects/ExecutionResult.js';

export class TaskResultRecorded extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly result: ExecutionResult,
  ) {
    super(aggregateId);
  }
}
```

**Step 2: 创建 ExecutionResult 值对象**

```typescript
// backend/src/domain/workflow/value-objects/ExecutionResult.ts
export class ExecutionResult {
  constructor(
    public readonly status: 'done' | 'partial' | 'blocked',
    public readonly changedFiles: string[],
    public readonly notes: string,
    public readonly reviewPoints?: string[],
    public readonly blockedReason?: string,
  ) {
    if (status === 'blocked' && !blockedReason) {
      throw new Error('blockedReason is required when status is blocked');
    }
  }
}
```

**Step 3: 编写 Task 聚合根（精简版）**

```typescript
// backend/src/domain/workflow/entities/Task.ts
import { TaskId } from '../value-objects/TaskId.js';
import { TaskStatus } from '../value-objects/TaskStatus.js';
import { Priority } from '../value-objects/Priority.js';
import { WorktreeRef } from '../value-objects/WorktreeRef.js';
import { ExecutionResult } from '../value-objects/ExecutionResult.js';
import { TaskDispatched } from '../events/TaskDispatched.js';
import { TaskResultRecorded } from '../events/TaskResultRecorded.js';
import { DomainEvent } from '../../_shared/DomainEvent.js';

export class Task {
  private _domainEvents: DomainEvent[] = [];

  constructor(
    public readonly id: TaskId,
    public title: string,
    public description: string,
    public status: TaskStatus,
    public priority: Priority,
    public projects: string[],
    public relatedFiles: string[],
    public acceptanceCriteria: string[],
    public worktree?: WorktreeRef,
    public executionResult?: ExecutionResult,
    public createdAt: Date = new Date(),
    public updatedAt: Date = new Date(),
  ) {}

  get domainEvents(): DomainEvent[] {
    return [...this._domainEvents];
  }

  clearEvents(): void {
    this._domainEvents = [];
  }

  dispatch(worktree: WorktreeRef): void {
    if (this.status !== TaskStatus.TODO) {
      throw new Error('Only TODO tasks can be dispatched');
    }
    this.worktree = worktree;
    this.status = TaskStatus.DISPATCHED;
    this.updatedAt = new Date();
    this._domainEvents.push(new TaskDispatched(this.id.value, worktree));
  }

  recordResult(result: ExecutionResult): void {
    if (this.status !== TaskStatus.DISPATCHED) {
      throw new Error('Only dispatched tasks can record result');
    }
    this.executionResult = result;
    this.status = result.status === 'blocked' ? TaskStatus.BLOCKED : TaskStatus.REVIEW;
    this.updatedAt = new Date();
    this._domainEvents.push(new TaskResultRecorded(this.id.value, result));
  }

  approve(mergeStrategy: 'merge' | 'keep_branch'): void {
    if (this.status !== TaskStatus.REVIEW) {
      throw new Error('Only review tasks can be approved');
    }
    this.status = TaskStatus.DONE;
    this.updatedAt = new Date();
    // TaskApproved event 省略，MVP 阶段简化
  }

  reject(reason: string): void {
    if (this.status !== TaskStatus.REVIEW) {
      throw new Error('Only review tasks can be rejected');
    }
    this.status = TaskStatus.TODO;
    this.worktree = undefined;
    this.executionResult = undefined;
    this.updatedAt = new Date();
    // TaskRejected event 省略
  }

  toJSON() {
    return {
      id: this.id.value,
      title: this.title,
      description: this.description,
      status: this.status,
      priority: this.priority,
      projects: this.projects,
      relatedFiles: this.relatedFiles,
      acceptanceCriteria: this.acceptanceCriteria,
      worktree: this.worktree ? {
        path: this.worktree.path,
        branch: this.worktree.branch,
        baseCommit: this.worktree.baseCommit,
        createdAt: this.worktree.createdAt.toISOString(),
      } : undefined,
      executionResult: this.executionResult,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
```

**Step 4: 编写 Task 单元测试**

```typescript
// backend/src/domain/workflow/entities/__tests__/Task.test.ts
import { describe, it, expect } from 'vitest';
import { Task } from '../Task';
import { TaskId } from '../../value-objects/TaskId';
import { TaskStatus } from '../../value-objects/TaskStatus';
import { Priority } from '../../value-objects/Priority';
import { WorktreeRef } from '../../value-objects/WorktreeRef';
import { ExecutionResult } from '../../value-objects/ExecutionResult';

describe('Task', () => {
  it('should dispatch task and emit event', () => {
    const task = new Task(
      TaskId.create('WS', 1),
      'Test task',
      'Description',
      TaskStatus.TODO,
      Priority.P1,
      ['project-a'],
      [],
      []
    );

    const worktree = WorktreeRef.create('/path/to/project', 'ws-001', 'abc123');
    task.dispatch(worktree);

    expect(task.status).toBe(TaskStatus.DISPATCHED);
    expect(task.worktree).toBe(worktree);
    expect(task.domainEvents).toHaveLength(1);
    expect(task.domainEvents[0].eventType).toBe('TaskDispatched');
  });

  it('should record result and move to review', () => {
    const task = new Task(
      TaskId.create('WS', 2),
      'Test',
      'Desc',
      TaskStatus.DISPATCHED,
      Priority.P0,
      [],
      [],
      []
    );

    const result = new ExecutionResult('done', ['file.ts'], 'Fixed bug');
    task.recordResult(result);

    expect(task.status).toBe(TaskStatus.REVIEW);
    expect(task.executionResult).toBe(result);
  });

  it('should reject invalid state transition', () => {
    const task = new Task(
      TaskId.create('WS', 3),
      'Test',
      'Desc',
      TaskStatus.DONE,
      Priority.P2,
      [],
      [],
      []
    );

    const worktree = WorktreeRef.create('/path', 'ws-003', 'xyz');
    expect(() => task.dispatch(worktree)).toThrow('Only TODO tasks');
  });
});
```

**Step 5: 运行测试**

Run: `cd backend && npm test Task.test`
Expected: 3 tests pass

**Step 6: Commit**

```bash
git add backend/src/domain/workflow/entities backend/src/domain/workflow/events backend/src/domain/workflow/value-objects/ExecutionResult.ts
git commit -m "feat(domain): 实现 Task 聚合根

- dispatch(): TODO → DISPATCHED + 发布 TaskDispatched 事件
- recordResult(): DISPATCHED → REVIEW/BLOCKED + 发布事件
- approve()/reject(): 审查操作
- 领域事件: TaskDispatched / TaskResultRecorded
- ExecutionResult 值对象 (status/changedFiles/notes)
- 单元测试覆盖

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

**实施计划 Phase 1-2 核心已完成。**

由于完整实施计划会非常长（预计 40+ 个 Task），我建议：

**现在先停在这里**，把已完成的前 5 个 Task 作为 Phase 1-2 的核心骨架保存。后续我可以继续追加：
- **Phase 3**: MCP Server 实现（Task 6-15，约 10 个任务）
- **Phase 4**: Repository + EventBus（Task 16-20）
- **Phase 5**: HTTP API + 前端看板（Task 21-35）
- **Phase 6**: E2E 测试与文档（Task 36-40）

你现在可以：
1. **开始实施前 5 个 Task** — 跑通项目初始化 + DDD 骨架 + Worktree + Task 聚合根
2. **让我继续写**Phase 3-6 的详细步骤（我会追加到同一个文档）

你想现在开始实施，还是让我先把完整计划写完？
