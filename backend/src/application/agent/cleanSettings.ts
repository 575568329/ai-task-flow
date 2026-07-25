// backend/src/application/agent/cleanSettings.ts
// 隔离 superpowers 的干净 settings(SDK flag 层):清空 hooks 阻断 SessionStart 注入
// (AgentRunner --settings clean.json 实测 input 35k→2.5k),清空 permissions 防用户级权限规则注入。
//
// 作 SDK Options.settings 注入:settingSources 默认全读(保留 CLAUDE.md),inline settings 作 flag 层
// 覆盖 user/project/local 的 hooks/permissions。**不用 settingSources:[]**(SDK isolation mode)——
// 那会丢 CLAUDE.md(sdk.d.ts:1908 "Must include 'project' to load CLAUDE.md files")。
//
// 与 AgentRunner.CLEAN_SETTINGS(--settings clean.json)等价;SDK 模式改用 inline Settings 对象。
import type { Settings } from '@anthropic-ai/claude-agent-sdk';

/** 干净 settings:hooks/permissions 清空,作 flag 层覆盖用户级 superpowers 注入。冻结防共享篡改 */
export const CLEAN_SDK_SETTINGS: Settings = Object.freeze({
  hooks: {},
  permissions: { allow: [], deny: [], ask: [] },
}) as Settings;

/**
 * 在 clean 基础上合并调用方额外 settings(浅合并 top-level keys,与 Query.applyFlagSettings 同语义)。
 * clean 保证 hooks/permissions 清空(隔离不丢);调用方字段覆盖,如 mcpServers(#5 路由层经此注入)。
 */
export function withCleanSettings(extra?: Partial<Settings>): Settings {
  return { ...CLEAN_SDK_SETTINGS, ...extra };
}
