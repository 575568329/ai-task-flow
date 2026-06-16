// extension/src/sidepanel/__tests__/permissions.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ensureHostPermission } from '../permissions.js';

type ChromePermissionsMock = {
  contains: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
};

/** 注入 mock 的 chrome.permissions，并返回 spy 以便断言 */
function mockChrome(containsResult: boolean, requestResult: boolean): ChromePermissionsMock {
  const contains = vi.fn().mockResolvedValue(containsResult);
  const request = vi.fn().mockResolvedValue(requestResult);
  (globalThis as unknown as { chrome: { permissions: ChromePermissionsMock } }).chrome = {
    permissions: { contains, request },
  };
  return { contains, request };
}

beforeEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
});

describe('ensureHostPermission', () => {
  it('已授权则不重新请求权限', async () => {
    const { request } = mockChrome(true, true);
    await ensureHostPermission('https://example.com/a/b?x=1');
    expect(request).not.toHaveBeenCalled();
  });

  it('未授权则按源点请求权限并放行', async () => {
    const { request } = mockChrome(false, true);
    await ensureHostPermission('https://blog.example.com/post/123');
    expect(request).toHaveBeenCalledWith({ origins: ['https://blog.example.com/*'] });
  });

  it('用户拒绝授权则抛错', async () => {
    mockChrome(false, false);
    await expect(ensureHostPermission('https://example.com')).rejects.toThrow(/已取消/);
  });

  it('非 http(s) 页面拒绝抓取', async () => {
    mockChrome(true, true);
    // file://、ftp:// 可被 URL 解析(非 http/https)→ 走 protocol 校验抛"不支持"
    await expect(ensureHostPermission('file:///etc/hosts')).rejects.toThrow(/不支持/);
    await expect(ensureHostPermission('ftp://example.com/file')).rejects.toThrow(/不支持/);
  });

  it('无效地址或空地址抛错', async () => {
    mockChrome(true, true);
    await expect(ensureHostPermission('not-a-valid-url')).rejects.toThrow(/无效/);
    await expect(ensureHostPermission(undefined)).rejects.toThrow(/无法读取/);
  });
});
