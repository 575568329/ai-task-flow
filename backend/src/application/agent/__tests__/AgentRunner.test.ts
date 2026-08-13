// backend/src/application/agent/__tests__/AgentRunner.test.ts
// resolveWslClaudePath 单测:mock spawn wsl.exe,验证三分支(成功 / home 空 / 非0退出 / spawn error)
// + 模块级 cache(并发首调共享 in-flight Promise,不重复 spawn)。
// cache 是模块级状态,每个用例 vi.resetModules 重载模块拿到干净实例。
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

let spawnMock: Mock<unknown[], ChildProcess>;
let resolveWslClaudePath: () => Promise<string>;

/** 构造 mock child:有 stdout/stderr EventEmitters(模拟 Node spawn 返回的流) */
const makeChild = (): ChildProcess => {
  const child = new EventEmitter() as ChildProcess;
  (child as unknown as { stdout: EventEmitter }).stdout = new EventEmitter();
  (child as unknown as { stderr: EventEmitter }).stderr = new EventEmitter();
  (child as unknown as { pid: number }).pid = 12345;
  return child;
};

/** 取 spawn 最近一次返回的 mock child,测试里 emit 事件驱动 Promise resolve */
const lastChild = (): ChildProcess => {
  const results = spawnMock.mock.results;
  return results[results.length - 1].value as ChildProcess;
};

const stdout = (child: ChildProcess): EventEmitter =>
  (child as unknown as { stdout: EventEmitter }).stdout;

beforeEach(async () => {
  vi.resetModules();
  spawnMock = vi.fn((..._args: unknown[]) => makeChild());
  vi.doMock('node:child_process', () => ({ spawn: spawnMock }));
  const mod = await import('../AgentRunner.js');
  resolveWslClaudePath = mod.resolveWslClaudePath;
});

describe('resolveWslClaudePath', () => {
  it('should_resolve_absolute_path_when_wsl_printenv_home_succeeds', async () => {
    const p = resolveWslClaudePath();
    stdout(lastChild()).emit('data', Buffer.from('/home/user\n'));
    lastChild().emit('close', 0);
    await expect(p).resolves.toBe('/home/user/.local/bin/claude');
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('should_fallback_to_bare_claude_when_home_empty_even_on_exit_zero', async () => {
    // close 0 但 stdout 无输出(home 为空)→ 回退裸 claude
    const p = resolveWslClaudePath();
    lastChild().emit('close', 0);
    await expect(p).resolves.toBe('claude');
  });

  it('should_fallback_to_bare_claude_when_exit_code_nonzero', async () => {
    const p = resolveWslClaudePath();
    stdout(lastChild()).emit('data', Buffer.from('/home/u'));
    lastChild().emit('close', 1);
    await expect(p).resolves.toBe('claude');
  });

  it('should_fallback_to_bare_claude_when_spawn_emits_error', async () => {
    // WSL 未装:wsl.exe 不在 PATH,spawn 发 'error'(ENOENT)
    const p = resolveWslClaudePath();
    lastChild().emit('error', new Error('spawn wsl.exe ENOENT'));
    await expect(p).resolves.toBe('claude');
  });

  it('should_cache_resolved_path_and_not_respawn_on_second_call', async () => {
    // 模块级 cache:首次解析后,第二次调用复用 in-flight Promise,不重复 spawn(WSL 冷启 4-10s)
    const p1 = resolveWslClaudePath();
    stdout(lastChild()).emit('data', Buffer.from('/home/u'));
    lastChild().emit('close', 0);
    await expect(p1).resolves.toBe('/home/u/.local/bin/claude');
    expect(spawnMock).toHaveBeenCalledTimes(1);

    // 第二次命中 cache:不再 spawn,仍返回首次解析的路径
    await expect(resolveWslClaudePath()).resolves.toBe('/home/u/.local/bin/claude');
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});
