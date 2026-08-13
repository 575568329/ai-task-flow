// backend/src/application/vocab/__tests__/YoudaoBinParser.test.ts
import { describe, it, expect } from 'vitest';
import { parseYoudaoBin, readStringsExport } from '../YoudaoBinParser.js';

/**
 * 构造一个仿有道 .bin 的 buffer：
 * 每个 segment = [4字节小端长度 N][N×UTF-16LE 字符][0x0000 终止符]
 * segment 之间可插入任意二进制「元数据」字节，解析器应逐字节跳过。
 */
function buildBin(parts: Array<Uint8Array | string>): Buffer {
  const chunks: Buffer[] = [];
  for (const p of parts) {
    if (typeof p === 'string') {
      // 长度前缀 + UTF-16LE 内容 + 终止符
      const encoded = Buffer.from(p, 'utf16le');
      const lenBuf = Buffer.allocUnsafe(4);
      lenBuf.writeUInt32LE(p.length, 0);
      chunks.push(lenBuf, encoded, Buffer.from([0x00, 0x00]));
    } else {
      chunks.push(Buffer.from(p));
    }
  }
  return Buffer.concat(chunks);
}

// 一段二进制元数据：全高位字节，保证任何 4 字节窗口读出的「长度」都远超上限，
// 从而被解析器逐字节跳过（模拟真实 .bin 中词条间的二进制元数据段）
const META = Buffer.from([0x7e, 0x7e, 0x7e, 0x7e, 0x7e, 0x7e, 0x7e, 0x7e]);

describe('YoudaoBinParser', () => {
  it('readStrings: 抽出长度前缀 UTF-16LE 串，跳过二进制元数据', () => {
    const bin = buildBin(['en', 'zh-CHS', 'rollback', META, 'next']);
    expect(readStringsExport(bin)).toEqual(['en', 'zh-CHS', 'rollback', 'next']);
  });

  it('完整解析一条带音标/释义的词条', () => {
    const bin = buildBin([
      'en', 'zh-CHS', 'rollback', '[ˈrəʊlbæk]', 'n. 卷回；反转;', '未分组单词', META,
    ]);
    const { words, skipped } = parseYoudaoBin(bin);
    expect(skipped).toBe(0);
    expect(words).toHaveLength(1);
    expect(words[0]).toMatchObject({
      word: 'rollback',
      phonetic: '[ˈrəʊlbæk]',
      translation: 'n. 卷回；反转;',
      sourceLang: 'en',
      targetLang: 'zh-CHS',
    });
  });

  it('分组名不被误当作释义（无释义词条）', () => {
    const bin = buildBin(['en', 'zh-CHS', 'handler', '[ˈhændlə(r)]', '未分组单词', META]);
    const { words } = parseYoudaoBin(bin);
    expect(words).toHaveLength(1);
    expect(words[0].word).toBe('handler');
    expect(words[0].phonetic).toBe('[ˈhændlə(r)]');
    expect(words[0].translation).toBeUndefined(); // 关键：不是「未分组单词」
  });

  it('多词条连续解析，各自字段正确', () => {
    const bin = buildBin([
      'en', 'zh-CHS', 'rollback', '[ˈrəʊlbæk]', 'n. 卷回;', '未分组单词', META,
      'en', 'zh-CHS', 'handler', '[ˈhændlə(r)]', '未分组单词', META,
      'en', 'zh-CHS', 'summarize', '[ˈsʌməraɪz]', 'v. 总结;', '未分组单词', META,
    ]);
    const { words } = parseYoudaoBin(bin);
    expect(words.map(w => w.word)).toEqual(['rollback', 'handler', 'summarize']);
    expect(words[1].translation).toBeUndefined();
    expect(words[2].translation).toBe('v. 总结;');
  });

  it('短语词（含空格、无音标）正确解析', () => {
    const bin = buildBin(['en', 'zh-CHS', 'after returning', '回来后：指返回之后。', '未分组单词', META]);
    const { words } = parseYoudaoBin(bin);
    expect(words[0].word).toBe('after returning');
    expect(words[0].phonetic).toBeUndefined();
    expect(words[0].translation).toBe('回来后：指返回之后。');
  });

  it('空 buffer / 无锚点内容返回空结果不抛错', () => {
    expect(parseYoudaoBin(Buffer.alloc(0)).words).toEqual([]);
    expect(parseYoudaoBin(buildBin(['ThreadLocal', '线程局部变量;', '未分组单词'])).words).toEqual([]);
  });

  it('非 UTF-16LE / 纯乱码二进制不抛错，返回空', () => {
    const garbage = Buffer.from([0xff, 0xfe, 0xfd, 0x10, 0xab, 0xcd, 0x01, 0x02, 0x03]);
    const result = parseYoudaoBin(garbage);
    expect(result.words).toEqual([]);
  });

  it('大小写不同的同形词（Around/around）各自保留，不做合并', () => {
    const bin = buildBin([
      'en', 'zh-CHS', 'Around', '[əˈraʊnd]', 'adv. 围绕;', '未分组单词', META,
      'en', 'zh-CHS', 'around', '[əˈraʊnd]', '未分组单词', META,
    ]);
    const { words } = parseYoudaoBin(bin);
    expect(words.map(w => w.word)).toEqual(['Around', 'around']);
  });
});
