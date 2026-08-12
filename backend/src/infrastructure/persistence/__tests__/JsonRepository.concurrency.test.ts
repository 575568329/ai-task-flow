// backend/src/infrastructure/persistence/__tests__/JsonRepository.concurrency.test.ts
// 验证 JsonRepository 基类(withWriteLock 串行化 + tmp+rename 原子写)在并发下的数据安全。
// 选两个代表子类:JsonClaudeProfileRepository(明文 token,最敏感)+ JsonTaskRepository(核心数据)。
// 覆盖三个场景:N 个并发新增不丢失不重复 / 并发更新同一记录不损坏 / 原子写保证主文件始终合法。
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  JsonClaudeProfileRepository,
  type StoredClaudeProfile,
} from '../JsonClaudeProfileRepository.js';
import type { ClaudeSettings } from '../../../domain/claude-profile/settingsCodec.js';
import { JsonTaskRepository } from '../JsonTaskRepository.js';
import { Task } from '../../../domain/workflow/entities/Task.js';
import { TaskId } from '../../../domain/workflow/value-objects/TaskId.js';
import { TaskStatus } from '../../../domain/workflow/value-objects/TaskStatus.js';
import { Priority } from '../../../domain/workflow/value-objects/Priority.js';

/** 构造测试用 profile:settings 仅占位(并发测试不关心 settings 结构正确性)。 */
function makeProfile(id: string, name = id): StoredClaudeProfile {
  return {
    id,
    name,
    settings: {} as unknown as ClaudeSettings,
    apiPresets: [],
    updatedAt: new Date().toISOString(),
  };
}

describe('JsonRepository 并发安全(基类 withWriteLock + 原子写)', () => {
  describe('JsonClaudeProfileRepository(明文 token 仓储)', () => {
    let repo: JsonClaudeProfileRepository;
    let filePath: string;
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-conc-'));
      filePath = path.join(tmpDir, 'profiles.json');
      repo = new JsonClaudeProfileRepository(filePath);
    });
    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    });

    it('20 个并发 save 全部落盘,无丢失无重复', async () => {
      const profiles = Array.from({ length: 20 }, (_, i) => makeProfile(`p${i}`));
      await Promise.all(profiles.map((p) => repo.save(p)));
      const all = await repo.findAll();
      expect(all).toHaveLength(20);
      expect(new Set(all.map((p) => p.id)).size).toBe(20);
    });

    it('15 个并发更新同一 profile,最终仍是 1 条完整态(不重复不损坏)', async () => {
      await repo.save(makeProfile('shared', 'v0'));
      await Promise.all(
        Array.from({ length: 15 }, (_, i) => repo.save(makeProfile('shared', `v${i + 1}`))),
      );
      const all = await repo.findAll();
      expect(all).toHaveLength(1);
      // 最终是 v1..v15 中某个完整值(并发执行顺序不固定),但绝不是损坏/截断态
      expect(all[0].name).toMatch(/^v\d+$/);
    });

    it('原子写:并发写完成后主文件始终是合法 JSON(无半截损坏)', async () => {
      await Promise.all(
        Array.from({ length: 10 }, (_, i) => repo.save(makeProfile(`p${i}`))),
      );
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw); // 不抛 = 主文件完整,无写一半的截断
      expect(parsed.profiles).toHaveLength(10);
    });
  });

  describe('JsonTaskRepository(核心任务数据)', () => {
    let repo: JsonTaskRepository;
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'task-conc-'));
      repo = new JsonTaskRepository(path.join(tmpDir, 'tasks.json'));
    });
    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    });

    it('12 个并发 save 不同 task 全部落盘不丢失', async () => {
      const tasks = Array.from({ length: 12 }, (_, i) =>
        new Task(
          TaskId.create('CONC', i + 1),
          `Task ${i}`,
          'desc',
          TaskStatus.TODO,
          Priority.P1,
          undefined,
          undefined,
          [],
          [],
        ),
      );
      await Promise.all(tasks.map((t) => repo.save(t)));
      const all = await repo.findAll();
      expect(all).toHaveLength(12);
    });
  });
});
