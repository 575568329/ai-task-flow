import { describe, it, expect } from 'vitest';
// isSafeRepoPath 是 system.ts 的 export 纯函数:校验 repoPath 合法且无 shell 元字符,
// 防 TerminalLauncher 的 `start cmd /k "cd /d "${repoPath}"...` 命令注入。
import { isSafeRepoPath } from '../system.js';

describe('isSafeRepoPath', () => {
  it.each([
    'D:\\foo\\bar',
    'D:/foo/bar',
    'C:\\Users\\test\\repo',
    '/home/user/repo',
    '/Users/name/project',
  ])('应接受合法仓库绝对路径: %s', (p) => {
    expect(isSafeRepoPath(p)).toBe(true);
  });

  it.each([
    ['双引号注入', 'D:\\evil" & whoami'],
    ['分号', 'D:\\foo;rm -rf /'],
    ['管道', 'D:\\foo|cat /etc/passwd'],
    ['与号', 'D:\\foo&whoami'],
    ['反引号', 'D:\\foo`whoami`'],
    ['命令替换 $()', 'D:\\foo$(whoami)'],
    ['换行注入', 'D:\\foo\nwhoami'],
    ['回车注入', 'D:\\foo\rcmd'],
    ['重定向 >', 'D:\\foo>out'],
    ['重定向 <', 'D:\\foo<in'],
    ['脱字 ^', 'D:\\foo^cmd'],
    ['圆括号', 'D:\\foo(whoami)'],
  ])('应拒绝含 shell 元字符的路径(%s): %s', (_label, p) => {
    expect(isSafeRepoPath(p)).toBe(false);
  });

  it.each([
    ['相对路径', 'foo/bar'],
    ['纯文本', 'not a path'],
    ['空串', ''],
  ])('应拒绝非绝对路径(%s): %s', (_label, p) => {
    expect(isSafeRepoPath(p)).toBe(false);
  });
});
