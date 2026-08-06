// backend/src/domain/claude-profile/__tests__/settingsCodec.test.ts
// settingsCodec 纯函数单测:重点覆盖 settingsIdentity(生效判定的 API 身份签名)。
import { describe, it, expect } from 'vitest';
import { settingsIdentity, stableStringify } from '../settingsCodec.js';

describe('settingsIdentity', () => {
  it('baseURL 与 token 均空时返回 null(无 API 身份,不参与匹配)', () => {
    expect(settingsIdentity({})).toBeNull();
    expect(settingsIdentity({ env: {} })).toBeNull();
    expect(settingsIdentity({ env: { ANTHROPIC_MODEL: 'glm' } })).toBeNull();
    // model 顶层字段已不计入身份,仅有 model 时也算无身份
    expect(settingsIdentity({ model: 'sonnet' })).toBeNull();
    // 无关字段再多也不构成身份
    expect(settingsIdentity({ hooks: { x: 1 }, permissions: { allow: [] } })).toBeNull();
  });

  it('身份只取 ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN 两项', () => {
    const id = settingsIdentity({
      env: { ANTHROPIC_BASE_URL: 'https://x', ANTHROPIC_AUTH_TOKEN: 'sk-1' },
    });
    expect(id).not.toBeNull();
  });

  it('baseURL / token 任一不同则签名不同', () => {
    const base = { env: { ANTHROPIC_BASE_URL: 'u', ANTHROPIC_AUTH_TOKEN: 't' } };
    const id = settingsIdentity(base);
    expect(id).not.toBe(
      settingsIdentity({ env: { ANTHROPIC_BASE_URL: 'u2', ANTHROPIC_AUTH_TOKEN: 't' } }),
    );
    expect(id).not.toBe(
      settingsIdentity({ env: { ANTHROPIC_BASE_URL: 'u', ANTHROPIC_AUTH_TOKEN: 't2' } }),
    );
  });

  it('model 不参与身份(核心:容忍 Claude Code 把 model 在别名/具体名间改写)', () => {
    // 这是本签名的关键约束:profile 快照里 model 常是具体名(GLM-5.2),
    // 而 Claude Code 在 /model 切换后会把它改写成别名(sonnet/opus/haiku)。
    // model 抖动不应让「用的是哪套 API」的判定失效。
    const id = settingsIdentity({
      model: 'GLM-5.2',
      env: { ANTHROPIC_BASE_URL: 'u', ANTHROPIC_AUTH_TOKEN: 't' },
    });
    expect(id).toBe(
      settingsIdentity({
        model: 'sonnet',
        env: { ANTHROPIC_BASE_URL: 'u', ANTHROPIC_AUTH_TOKEN: 't' },
      }),
    );
    // model 缺失也不影响
    expect(id).toBe(settingsIdentity({ env: { ANTHROPIC_BASE_URL: 'u', ANTHROPIC_AUTH_TOKEN: 't' } }));
  });

  it('无视 hooks/权限等无关字段差异时签名一致(容忍 Claude Code 重写无关字段)', () => {
    const a = settingsIdentity({ env: { ANTHROPIC_BASE_URL: 'u', ANTHROPIC_AUTH_TOKEN: 't' } });
    const b = settingsIdentity({
      env: { ANTHROPIC_BASE_URL: 'u', ANTHROPIC_AUTH_TOKEN: 't' },
      // Claude Code 自行写入的无关字段,不应影响身份判定
      model: 'opus',
      hooks: { Stop: [{ command: 'node x' }] },
      permissions: { allow: ['Bash(*)'] },
      cleanupPeriodDays: 30,
    });
    expect(a).toBe(b);
  });

  it('与 stableStringify 同为稳定序列化(键序无关)', () => {
    // 同内容不同键序应产出相同签名
    const a = settingsIdentity({ env: { ANTHROPIC_AUTH_TOKEN: 't', ANTHROPIC_BASE_URL: 'u' } });
    const b = settingsIdentity({ env: { ANTHROPIC_BASE_URL: 'u', ANTHROPIC_AUTH_TOKEN: 't' } });
    expect(a).toBe(b);
    expect(typeof a).toBe('string');
    expect(stableStringify({ baseURL: 'u', token: 't' })).toBe(a);
  });
});
