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
  it('WSL 挂载路径转换为 Windows 盘符(双向互认)', () => {
    expect(normalizePath('/mnt/d/xunfei/a')).toBe('d:/xunfei/a');
    expect(normalizePath('/mnt/d')).toBe('d:/');
    expect(normalizePath('/mnt/c/Users/me/')).toBe('c:/users/me');
    // Windows 写法保持不变(只做既有的大小写/斜杠归一)
    expect(normalizePath('D:\\xunfei\\a')).toBe('d:/xunfei/a');
  });
  it('多字母挂载目录不被误转换', () => {
    expect(normalizePath('/mnt/data/x')).toBe('/mnt/data/x');
    expect(normalizePath('/mnt/wsl/distro')).toBe('/mnt/wsl/distro');
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
  it('WSL 与 Windows 表示互认', () => {
    expect(isPathWithin('D:\\xunfei\\a', '/mnt/d/xunfei/a/b')).toBe(true);
    expect(isPathWithin('/mnt/d/xunfei/a', 'D:\\xunfei\\a\\b')).toBe(true);
    // 前缀边界仍然生效
    expect(isPathWithin('D:\\xunfei\\a', '/mnt/d/xunfei/ab')).toBe(false);
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
  it('WSL cwd 命中 Windows 绑定的项目(双向)', () => {
    expect(findOwningProject(refs, '/mnt/d/xunfei/资源加工平台/前端/rpp-web')).toBe('p_parent');
    expect(findOwningProject(refs, '/mnt/d/xunfei/资源加工平台/搜题平台/前端')).toBe('p_child');
    expect(findOwningProject(
      [{ projectId: 'p_wsl', path: '/mnt/d/xunfei/题库' }],
      'D:\\xunfei\\题库\\web',
    )).toBe('p_wsl');
  });
});
