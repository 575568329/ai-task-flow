// extension/src/sidepanel/api/__tests__/backend.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { captureToDrafts, createTaskFromDraft } from '../backend.js';

beforeEach(() => {
  global.fetch = vi.fn() as unknown as typeof fetch;
});

describe('backend api', () => {
  it('captureToDrafts posts ClipRequest and returns drafts', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ drafts: [{ title: 'T', description: 'D', steps: [] }], sourceUrl: 'u' }),
    });
    const resp = await captureToDrafts({
      sourceUrl: 'u',
      title: 't',
      text: '正文',
      images: [{ name: 'img-1', base64: 'data:x' }],
    });
    expect(resp.drafts).toHaveLength(1);
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('http://localhost:3000/api/tasks/clip');
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.sourceUrl).toBe('u');
    expect(body.content.text).toBe('正文');
    expect(body.images[0].name).toBe('img-1');
  });

  it('createTaskFromDraft posts web task with sourceUrl and prefix', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'WEB-1' }),
    });
    await createTaskFromDraft({ title: 'T', description: 'D', steps: [] }, 'https://x.com/p', 'WEB');
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('http://localhost:3000/api/tasks');
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.source).toBe('web');
    expect(body.sourceUrl).toBe('https://x.com/p');
    expect(body.prefix).toBe('WEB');
  });

  it('throws on non-ok response with backend error', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: '尚未配置 API Key' }),
    });
    await expect(
      createTaskFromDraft({ title: 'T', description: 'D', steps: [] }, 'u', 'WEB'),
    ).rejects.toThrow(/API Key/);
  });
});
