// backend/src/interfaces/mcp/__tests__/server.test.ts
import { describe, it, expect } from 'vitest';

describe('MCP Server', () => {
  it('should export server class', async () => {
    // 简单的模块加载测试
    const module = await import('../server.js');
    expect(module).toBeDefined();
  });
});
