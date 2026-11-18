import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { JsonConclusionRepository } from '../JsonConclusionRepository.js';
import { ConclusionStorageError } from '../../../domain/conclusion/errors.js';

describe('JsonConclusionRepository', () => {
  let tmpDir: string;
  let filePath: string;
  let backupsDir: string;
  let repo: JsonConclusionRepository;

  beforeEach(async () => {
    const { nanoid } = await import('nanoid');
    tmpDir = path.join(os.tmpdir(), `conclusion-repo-${nanoid()}`);
    filePath = path.join(tmpDir, 'conclusions.json');
    backupsDir = path.join(tmpDir, 'conclusion-backups');
    repo = new JsonConclusionRepository(filePath, backupsDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should return empty data when file does not exist', async () => {
    await expect(repo.load()).resolves.toEqual({ schemaVersion: 1, conclusions: [] });
  });

  it('should persist mutations and read them back', async () => {
    await repo.mutate((data) => {
      data.conclusions.push({
        id: 'c_1', scope: 'project', project: 'p', title: 't',
        revisions: [{
          rev: 1, decision: 'd', source: { tool: 'manual' },
          date: '2026-11-18', createdAt: 1,
        }],
        createdAt: 1, updatedAt: 1,
      });
    });
    const loaded = await repo.load();
    expect(loaded.conclusions).toHaveLength(1);
    expect(loaded.conclusions[0].id).toBe('c_1');
  });

  it('should create a snapshot when backup option is true', async () => {
    await repo.mutate(() => undefined, { backup: true });
    const names = await fs.readdir(backupsDir);
    expect(names.filter((n) => n.startsWith('backup-'))).toHaveLength(1);
  });

  it('should keep only 10 backups', async () => {
    for (let i = 0; i < 12; i++) {
      await repo.mutate(() => undefined, { backup: true });
    }
    const names = await fs.readdir(backupsDir);
    expect(names.filter((n) => n.startsWith('backup-'))).toHaveLength(10);
  });

  it('should throw ConclusionStorageError on corrupt JSON and not overwrite it', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(filePath, '{ broken', 'utf-8');
    await expect(repo.load()).rejects.toBeInstanceOf(ConclusionStorageError);
    await expect(fs.readFile(filePath, 'utf-8')).resolves.toBe('{ broken');
  });
});
