// backend/src/application/agent/__tests__/cleanSettings.test.ts
// cleanSettings 单测:CLEAN_SDK_SETTINGS 结构(hooks/permissions 清空)+ withCleanSettings 浅合并。
import { describe, it, expect } from 'vitest';
import { CLEAN_SDK_SETTINGS, withCleanSettings } from '../cleanSettings.js';

describe('cleanSettings', () => {
  it('should_clear_hooks_and_permissions', () => {
    expect(CLEAN_SDK_SETTINGS.hooks).toEqual({});
    expect(CLEAN_SDK_SETTINGS.permissions).toEqual({ allow: [], deny: [], ask: [] });
  });

  it('should_be_frozen_to_prevent_shared_mutation', () => {
    expect(Object.isFrozen(CLEAN_SDK_SETTINGS)).toBe(true);
  });

  it('should_return_clean_when_no_extra', () => {
    expect(withCleanSettings(undefined)).toEqual({
      hooks: {},
      permissions: { allow: [], deny: [], ask: [] },
    });
    expect(withCleanSettings({})).toEqual({
      hooks: {},
      permissions: { allow: [], deny: [], ask: [] },
    });
  });

  it('should_keep_clean_hooks_when_extra_only_has_other_keys', () => {
    // 调用方只传 mcpServers 等其他字段:hooks 仍清空(隔离不丢)
    const merged = withCleanSettings({ mcpServers: {} } as Partial<typeof CLEAN_SDK_SETTINGS>);
    expect(merged.hooks).toEqual({});
    expect(merged.permissions).toEqual({ allow: [], deny: [], ask: [] });
  });

  it('should_override_permissions_when_extra_provides_it', () => {
    // 调用方显式传 permissions:整体覆盖(调用方负责,与 applyFlagSettings 同语义)
    const merged = withCleanSettings({ permissions: { allow: ['Read'] } });
    expect(merged.permissions).toEqual({ allow: ['Read'] });
    // hooks 仍来自 clean(未被 extra 触及)
    expect(merged.hooks).toEqual({});
  });
});
