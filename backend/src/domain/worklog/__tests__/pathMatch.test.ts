import { describe, it, expect } from 'vitest';
import { normalizePath, isPathWithin, findOwningProject } from '../pathMatch.js';

describe('normalizePath', () => {
  it('统一分隔符、去尾分隔符、Windows 转小写', () => {
    expect(normalizePath('D:\\Study\\ai-task-flow\\')).toBe('d:/study/ai-task-flow');
    expect(normalizePath('D:/Study\\ai-task-flow')).toBe('d:/study/ai-task-flow');
  });
  it('保留盘符根', () => {
    expect(normalizePath('D:\\')).toBe('d:/');
  });
});

describe('isPathWithin', () => {
  it('命中子路径', () => {
    expect(isPathWithin('D:\\a', 'D:\\a\\b')).toBe(true);
  });
  it('不得误匹配同前缀兄弟目录', () => {
    expect(isPathWithin('D:\\a', 'D:\\ab')).toBe(false);
  });
  it('尾分隔符不影响', () => {
    expect(isPathWithin('D:\\a\\', 'D:\\a')).toBe(true);
  });
  it('大小写与斜杠不敏感', () => {
    expect(isPathWithin('d:/A', 'D:\\a\\x')).toBe(true);
  });
  it('空父路径不匹配任何路径', () => {
    expect(isPathWithin('', '/home/x')).toBe(false);
  });
  it('纯空白父路径不匹配任何路径', () => {
    expect(isPathWithin('   ', '/mnt/d/x')).toBe(false);
  });
});

describe('findOwningProject', () => {
  const refs = [
    { projectId: 'p_parent', path: 'D:\\xunfei\\资源加工平台' },
    { projectId: 'p_child', path: 'D:\\xunfei\\资源加工平台\\搜题平台' },
    { projectId: 'p_other', path: 'D:\\xunfei\\题库' },
  ];

  it('最长前缀优先', () => {
    expect(findOwningProject(refs, 'D:\\xunfei\\资源加工平台\\搜题平台\\前端\\x'))
      .toBe('p_child');
    expect(findOwningProject(refs, 'D:\\xunfei\\资源加工平台\\前端\\rpp-web'))
      .toBe('p_parent');
  });
  it('未命中返回 undefined', () => {
    expect(findOwningProject(refs, 'D:\\Study\\ai-task-flow')).toBeUndefined();
  });
  it('空路径的项目不吞掉任何候选路径', () => {
    expect(findOwningProject([{ projectId: 'p', path: '' }], '/home/x')).toBeUndefined();
  });
});
