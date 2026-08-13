// backend/src/application/research/__tests__/ChatService.test.ts
// ChatService 纯函数单测(报告 P2-17:238 行主编排零测试)。聚焦可静态测的纯函数:
// validateCitations(剥除越界 [n] 引用)+ buildWriterPrompt(构造 RAG system prompt)。
// handleChat 编排(async generator + 流式 + 3 依赖 mock)需深 mock,留后续。
import { describe, it, expect } from 'vitest';
import { ChatService } from '../ChatService.js';
import type { Source } from '@ai-task-flow/shared';

const src = (index: number, over: Partial<Source> = {}): Source => ({
  index,
  title: over.title ?? `T${index}`,
  snippet: over.snippet ?? `S${index}`,
  url: over.url ?? `http://${index}`,
  // Source 可能含其他可选字段,这里只填测试所需
} as Source);

describe('ChatService 纯函数', () => {
  describe('validateCitations(剥除越界引用 [n])', () => {
    it('合法 [n](1..sources.length)原样保留', () => {
      const sources = [src(1), src(2)];
      expect(ChatService.validateCitations('参见[1]和[2]', sources)).toBe('参见[1]和[2]');
    });

    it('越界 [0] 与 [超长] 删除,合法保留', () => {
      const sources = [src(1)];
      // [0] 越界删、[1] 合法留、[9] 越界删
      expect(ChatService.validateCitations('[0]头 [1]中 [9]尾', sources)).toBe('头 [1]中 尾');
    });

    it('无 sources:所有 [n] 删除(模型幻觉引用清空)', () => {
      expect(ChatService.validateCitations('见[1]与[2]', [])).toBe('见与');
    });

    it('无引用文本原样返回', () => {
      expect(ChatService.validateCitations('纯文本无引用', [src(1)])).toBe('纯文本无引用');
    });

    it('多合法引用 [1][2] 连续保留', () => {
      const sources = [src(1), src(2)];
      expect(ChatService.validateCitations('合并[1][2]', sources)).toBe('合并[1][2]');
    });
  });

  describe('buildWriterPrompt(RAG system prompt)', () => {
    it('无 sources → 含 "No external sources" 提示(让模型声明局限)', () => {
      const p = ChatService.buildWriterPrompt([]);
      expect(p).toContain('No external sources');
      expect(p).not.toContain('<context>');
    });

    it('有 sources → 含 <context> 块 + 各 source 的 title/url', () => {
      const p = ChatService.buildWriterPrompt([src(1, { title: 'React 文档', url: 'https://react.dev' })]);
      expect(p).toContain('<context>');
      expect(p).toContain('React 文档');
      expect(p).toContain('https://react.dev');
      expect(p).toContain('[1]'); // 引用编号格式
    });

    it('customPrompt → 嵌入 "User\'s Custom Requirements" 段(每轮生效)', () => {
      const p = ChatService.buildWriterPrompt([], '用中文回答,简洁');
      expect(p).toContain("User's Custom Requirements");
      expect(p).toContain('用中文回答,简洁');
    });

    it('无 customPrompt → 不含 Custom Requirements 段', () => {
      expect(ChatService.buildWriterPrompt([])).not.toContain("User's Custom Requirements");
    });

    it('citation 格式要求始终存在(引导模型用 [n])', () => {
      const p = ChatService.buildWriterPrompt([src(1)]);
      expect(p).toContain('[number]');
    });
  });
});
