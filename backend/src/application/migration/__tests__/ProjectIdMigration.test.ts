// backend/src/application/migration/__tests__/ProjectIdMigration.test.ts
// 项目 id 一次性迁移:补 id / 结论卡按名称绑定 / 幂等 / 重名只报告。
// 全部使用 os.tmpdir() 下的临时目录,禁止触碰真实 ~/.ai-task-flow。
import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { JsonWorklogRepository } from '../../../infrastructure/persistence/JsonWorklogRepository.js';
import { JsonConclusionRepository } from '../../../infrastructure/persistence/JsonConclusionRepository.js';
import { runProjectIdMigration } from '../ProjectIdMigration.js';

describe('runProjectIdMigration', () => {
  let worklogRepo: JsonWorklogRepository;
  let conclusionRepo: JsonConclusionRepository;
  let dir: string;

  beforeEach(async () => {
    dir = path.join(os.tmpdir(), `mig-${nanoid()}`);
    await fs.mkdir(dir, { recursive: true });
    worklogRepo = new JsonWorklogRepository(path.join(dir, 'worklog.json'), path.join(dir, 'wb'));
    conclusionRepo = new JsonConclusionRepository(path.join(dir, 'conclusions.json'), path.join(dir, 'cb'));
    // 旧数据:项目缺 id;结论卡只有项目名
    await worklogRepo.mutate((d) => {
      d.projects.push(
        { name: '资源加工平台', createdAt: 1, versions: [] } as never,
        { name: '题库', createdAt: 2, versions: [] } as never,
      );
    });
    await conclusionRepo.mutate((d) => {
      d.conclusions.push(
        { id: 'c1', scope: 'project', project: '题库', title: 't', tags: [], revisions: [] } as never,
        { id: 'c2', scope: 'project', project: '不存在', title: 't2', tags: [], revisions: [] } as never,
        // 已绑定过的卡片不能被覆盖
        { id: 'c3', scope: 'project', project: '题库', projectId: 'p_existing', title: 't3', tags: [], revisions: [] } as never,
        // 个人域卡片:即使误填了能匹配的项目名,也不绑定 projectId
        { id: 'c4', scope: 'personal', project: '题库', title: 't4', tags: [], revisions: [] } as never,
      );
    });
  });

  it('补 id 并按名称绑定结论卡,重复执行幂等', async () => {
    const r1 = await runProjectIdMigration({ dataDir: dir, worklogRepo, conclusionRepo });
    expect(r1.skipped).toBe(false);
    expect(r1.assignedIds).toBe(2);
    expect(r1.boundConclusions).toBe(1);
    expect(r1.skippedAmbiguous).toBe(0);
    // 路径建议只给"真实存在"的目录,且仅作为建议(worklog 里不自动绑定)
    for (const candidate of Object.values(r1.suggestedPaths)) {
      await expect(fs.access(candidate)).resolves.toBeUndefined();
    }

    const tree = await worklogRepo.load();
    const ids = tree.projects.map((p) => p.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => id.startsWith('p_'))).toBe(true);
    expect(tree.projects.every((p) => !p.paths?.length)).toBe(true);

    const cards = await conclusionRepo.load();
    const c1 = cards.conclusions.find((c) => c.id === 'c1')!;
    const c2 = cards.conclusions.find((c) => c.id === 'c2')!;
    const c3 = cards.conclusions.find((c) => c.id === 'c3')!;
    const c4 = cards.conclusions.find((c) => c.id === 'c4')!;
    expect(c1.projectId).toBe(tree.projects.find((p) => p.name === '题库')!.id);
    expect(c2.projectId).toBeUndefined();
    expect(c3.projectId).toBe('p_existing');
    // 个人域卡片不绑定稳定项目引用
    expect(c4.projectId).toBeUndefined();

    // 破坏性写入必须留快照
    expect((await fs.readdir(path.join(dir, 'wb'))).length).toBeGreaterThan(0);
    expect((await fs.readdir(path.join(dir, 'cb'))).length).toBeGreaterThan(0);

    // 第二次执行:标记文件已到版本 1,直接跳过且不再改动数据
    const r2 = await runProjectIdMigration({ dataDir: dir, worklogRepo, conclusionRepo });
    expect(r2.skipped).toBe(true);
    expect(r2.assignedIds).toBe(0);
    expect(r2.boundConclusions).toBe(0);
  });

  it('重名项目各自分配 id,只报告不自动合并', async () => {
    await worklogRepo.mutate((d) => {
      d.projects.push({ name: '题库', createdAt: 3, versions: [] } as never);
    });
    const r = await runProjectIdMigration({ dataDir: dir, worklogRepo, conclusionRepo });
    expect(r.duplicateNames).toContain('题库');
    // 两个同名项目仍然各有独立 id(不合并)
    const tree = await worklogRepo.load();
    const sameName = tree.projects.filter((p) => p.name === '题库');
    expect(sameName).toHaveLength(2);
    expect(new Set(sameName.map((p) => p.id)).size).toBe(2);

    // 重名歧义下不猜测归属:c1(project=题库)保持未绑定并计数
    const cards = await conclusionRepo.load();
    expect(cards.conclusions.find((c) => c.id === 'c1')!.projectId).toBeUndefined();
    expect(r.boundConclusions).toBe(0);
    expect(r.skippedAmbiguous).toBe(1);
  });
});
