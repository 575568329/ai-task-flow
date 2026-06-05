// backend/src/infrastructure/persistence/JsonTaskRepository.ts
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { Task } from '../../domain/workflow/entities/Task.js';
import { TaskId } from '../../domain/workflow/value-objects/TaskId.js';
import { TaskStatus } from '../../domain/workflow/value-objects/TaskStatus.js';
import { Priority } from '../../domain/workflow/value-objects/Priority.js';
import { WorktreeRef } from '../../domain/workflow/value-objects/WorktreeRef.js';
import { ExecutionResult } from '../../domain/workflow/value-objects/ExecutionResult.js';
import { TaskRepository } from '../../domain/workflow/repositories/TaskRepository.js';

interface TaskDTO {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  projects: string[];
  relatedFiles: string[];
  acceptanceCriteria: string[];
  worktree?: {
    path: string;
    branch: string;
    baseCommit: string;
    createdAt: string;
  };
  executionResult?: {
    status: 'done' | 'partial' | 'blocked';
    changedFiles: string[];
    notes: string;
    reviewPoints?: string[];
    blockedReason?: string;
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * JSON 文件存储的 Task 仓储实现
 * 存储位置：~/.ai-task-flow/tasks.json
 */
export class JsonTaskRepository implements TaskRepository {
  private readonly filePath: string;

  constructor(customPath?: string) {
    if (customPath) {
      this.filePath = customPath;
    } else {
      const homeDir = os.homedir();
      const dataDir = path.join(homeDir, '.ai-task-flow');
      this.filePath = path.join(dataDir, 'tasks.json');
    }
  }

  async save(task: Task): Promise<void> {
    const tasks = await this.loadAll();
    const index = tasks.findIndex(t => t.id.equals(task.id));

    if (index >= 0) {
      tasks[index] = task;
    } else {
      tasks.push(task);
    }

    await this.saveAll(tasks);
  }

  async findById(id: TaskId): Promise<Task | null> {
    const tasks = await this.loadAll();
    return tasks.find(t => t.id.equals(id)) || null;
  }

  async findByStatus(status: TaskStatus): Promise<Task[]> {
    const tasks = await this.loadAll();
    return tasks.filter(t => t.status === status);
  }

  async findAll(): Promise<Task[]> {
    return this.loadAll();
  }

  async delete(id: TaskId): Promise<void> {
    const tasks = await this.loadAll();
    const filtered = tasks.filter(t => !t.id.equals(id));
    await this.saveAll(filtered);
  }

  private async loadAll(): Promise<Task[]> {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const content = await fs.readFile(this.filePath, 'utf-8');
      const dtos: TaskDTO[] = JSON.parse(content);
      return dtos.map(dto => this.dtoToEntity(dto));
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private async saveAll(tasks: Task[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const dtos = tasks.map(t => t.toJSON());
    await fs.writeFile(this.filePath, JSON.stringify(dtos, null, 2));
  }

  private dtoToEntity(dto: TaskDTO): Task {
    let worktree: WorktreeRef | undefined;
    if (dto.worktree) {
      worktree = new WorktreeRef(
        dto.worktree.path,
        dto.worktree.branch,
        dto.worktree.baseCommit,
        new Date(dto.worktree.createdAt)
      );
    }

    let executionResult: ExecutionResult | undefined;
    if (dto.executionResult) {
      executionResult = new ExecutionResult(
        dto.executionResult.status,
        dto.executionResult.changedFiles,
        dto.executionResult.notes,
        dto.executionResult.reviewPoints,
        dto.executionResult.blockedReason
      );
    }

    return new Task(
      TaskId.fromString(dto.id),
      dto.title,
      dto.description,
      dto.status,
      dto.priority,
      dto.projects,
      dto.relatedFiles,
      dto.acceptanceCriteria,
      worktree,
      executionResult,
      new Date(dto.createdAt),
      new Date(dto.updatedAt)
    );
  }
}
