import { describe, it, expect } from 'vitest';
import { conversationDisplay, shortConversationId } from '../conversationSource';
import { plainTextExcerpt, stripSectionHeading } from '../contentFormat';

describe('shortConversationId', () => {
  it('should keep tool:pid for process fingerprints', () => {
    expect(shortConversationId('zcode:52568:1795001084373')).toBe('zcode:52568');
  });

  it('should shorten UUIDs', () => {
    expect(shortConversationId('614608ad-5990-4757-a1f6-2cdb84e83f84')).toBe('614608ad…');
  });

  it('should not add an ellipsis to already-short ids', () => {
    expect(shortConversationId('sess-1')).toBe('sess-1');
  });
});

describe('stripSectionHeading', () => {
  it('should remove a leading duplicated section heading', () => {
    expect(stripSectionHeading('## 结论/决策\n1. 内容')).toBe('1. 内容');
    expect(stripSectionHeading('### 关键数据\n- 数据')).toBe('- 数据');
  });

  it('should keep content without a leading section heading', () => {
    expect(stripSectionHeading('1. 内容')).toBe('1. 内容');
  });
});

describe('plainTextExcerpt', () => {
  it('should strip markdown markers for the collapsed preview', () => {
    expect(plainTextExcerpt('**目标**：\n1. 第一点\n2. 第二点')).toBe('目标： 第一点 第二点');
    expect(plainTextExcerpt('使用 `code` 验证')).toBe('使用 code 验证');
  });

  it('should truncate long excerpts', () => {
    expect(plainTextExcerpt('一二三四五', 3)).toBe('一二三…');
  });
});

describe('conversationDisplay', () => {
  it('should use the name when present', () => {
    expect(conversationDisplay({
      tool: 'claude-code',
      conversationId: 'sess-1',
      conversationName: '  话题A  ',
    })).toEqual({ label: '话题A', shortId: 'sess-1' });
  });

  it('should treat a blank name as absent', () => {
    expect(conversationDisplay({
      tool: 'claude-code',
      conversationId: 'sess-1',
      conversationName: '   ',
    })).toEqual({ label: '未命名对话', shortId: 'sess-1' });
  });

  it('should mark manual cards without an id', () => {
    expect(conversationDisplay({ tool: 'manual' })).toEqual({ label: '手工创建' });
  });
});
