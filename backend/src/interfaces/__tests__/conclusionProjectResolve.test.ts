// backend/src/interfaces/__tests__/conclusionProjectResolve.test.ts
// 结论卡项目解析:只需 {id,name} 引用(不触发路径探测),名称 → id 与树投影结果一致。
import { describe, it, expect } from 'vitest';
import { resolveConclusionProjects, type ConclusionProjectRef } from '../conclusionProjectResolve.js';

const refs: ConclusionProjectRef[] = [
  { id: 'p_a', name: 'A' },
  { id: 'p_b', name: 'B' },
];

describe('resolveConclusionProjects', () => {
  it('should map main and related names to stable ids', () => {
    const resolved = resolveConclusionProjects(refs, {
      project: 'A',
      relatedProjects: ['B', '拼错的项目', 'B'],
    });
    expect(resolved.projectId).toBe('p_a');
    expect(resolved.relatedProjects).toEqual(['B']);
    expect(resolved.relatedProjectIds).toEqual(['p_b']);
    expect(resolved.ignored).toEqual(['拼错的项目']);
    expect(resolved.projectMissing).toBe(false);
  });

  it('should keep the name snapshot semantics when the main project is unknown', () => {
    const resolved = resolveConclusionProjects(refs, { project: '不存在' });
    expect(resolved.projectId).toBe('');
    expect(resolved.projectMissing).toBe(true);
  });

  it('should omit projectId when project is not provided', () => {
    const resolved = resolveConclusionProjects(refs, { relatedProjects: ['A'] });
    expect(resolved).not.toHaveProperty('projectId');
    expect(resolved.relatedProjectIds).toEqual(['p_a']);
  });
});
