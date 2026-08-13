// backend/src/application/vocab/YoudaoBinParser.ts

export interface YoudaoWord {
  word: string;
  phonetic?: string;
  translation?: string;
  sourceLang?: string;
  targetLang?: string;
}

export interface YoudaoParseResult {
  words: YoudaoWord[];
  skipped: number;
  skipReasons: string[];
}

/** 单字段最大字符数（防把二进制块误判为超长串） */
const MAX_STR_LEN = 500;

/** 判断解码出的字符串是否「像样」：无控制字符（换行/制表等）。 */
function isPlausibleString(s: string): boolean {
  if (s.length === 0) return false;
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    // 拒绝 C0/C1 控制字符（含 NUL 之外的），允许 0x20 起的可见字符与扩展
    if (code < 0x20) return false;
  }
  return true;
}

/** 语言代码形态：en / en-US / zh-CHS / fr / ja ... */
const LANG_RE = /^[a-z]{2}(-[A-Za-z]{2,4})?$/;

/**
 * 扫描 buffer 中所有「[4字节小端长度 N][N 个 UTF-16LE 字符][0x0000 终止符]」的串。
 * 遇到不符合该模式的字节（二进制元数据）则逐字节跳过，从而稳健地抽出全部字符串。
 */
/** @internal 供 dump 脚本/测试观察抽取出的原始字符串序列 */
export function readStringsExport(buf: Buffer): string[] {
  return readStrings(buf);
}

function readStrings(buf: Buffer): string[] {
  const strings: string[] = [];
  let i = 0;
  while (i + 6 <= buf.length) {
    const len = buf.readUInt32LE(i);
    if (len > 0 && len <= MAX_STR_LEN && i + 4 + len * 2 + 2 <= buf.length) {
      const start = i + 4;
      const term = buf.readUInt16LE(start + len * 2);
      if (term === 0) {
        const s = buf.subarray(start, start + len * 2).toString('utf16le');
        if (isPlausibleString(s)) {
          strings.push(s);
          i = start + len * 2 + 2;
          continue;
        }
      }
    }
    i += 1;
  }
  return strings;
}

/** 音标：以 [ 开头 ] 结尾 */
const PHONETIC_RE = /^\[.*\]$/;
/** 词性前缀释义：n. / v. / adj. / phr. 等 */
const POS_RE = /^(n|v|adj|adv|prep|conj|pron|art|num|abbr|phr|vt|vi|aux|det|int|modal)\b\.?/i;

function hasCJK(s: string): boolean {
  return /[一-鿿＀-￯]/.test(s);
}

/**
 * 将抽出的字符串序列按「语言对锚点」分组为词条。
 *
 * 结构规律（实测）：每条 = [源语言, 目标语言, word, (音标)?, (释义)?, 分组名]，
 * 紧跟二进制元数据后进入下一条。分组名（如「未分组单词」）恒为锚点前最后一个串，
 * 不是释义——必须剔除，否则无释义的词会把分组名误当释义。
 */
function groupEntries(strings: string[]): YoudaoParseResult {
  const words: YoudaoWord[] = [];
  let skipped = 0;
  const skipReasons: string[] = [];

  let i = 0;
  while (i < strings.length) {
    const a = strings[i];
    const b = strings[i + 1];
    // 锚点：连续两个语言代码串
    if (LANG_RE.test(a) && b !== undefined && LANG_RE.test(b)) {
      const sourceLang = a;
      const targetLang = b;
      // 扫到下一个锚点（或串尾），确定本条字段窗口
      let j = i + 2;
      while (j < strings.length) {
        if (LANG_RE.test(strings[j]) && strings[j + 1] !== undefined && LANG_RE.test(strings[j + 1])) break;
        j += 1;
      }
      // 窗口 = (i+2 .. j-1)；去掉最后一个（分组名），剩余按特征归入 word/音标/释义
      const span = strings.slice(i + 2, j);
      const fields = span.length > 0 ? span.slice(0, -1) : [];
      let word: string | undefined;
      let phonetic: string | undefined;
      let translation: string | undefined;
      for (const cur of fields) {
        if (!phonetic && PHONETIC_RE.test(cur)) phonetic = cur;
        else if (!translation && (POS_RE.test(cur) || hasCJK(cur))) translation = cur;
        else if (!word) word = cur;
      }
      if (word && word.trim()) {
        words.push({
          word: word.trim(),
          phonetic: phonetic?.trim() || undefined,
          translation: translation?.trim() || undefined,
          sourceLang,
          targetLang,
        });
      } else {
        skipped += 1;
        skipReasons.push(`无法识别词条字段（${sourceLang}/${targetLang}）`);
      }
      i = j;
    } else {
      i += 1;
    }
  }
  return { words, skipped, skipReasons };
}

/**
 * 解析有道导出的 .bin 生词本。
 * 格式：自定义二进制，内含若干「[4字节长度][UTF-16LE 串][终止符]」段，
 * 以 en/zh-CHS 等语言对作为词条分隔。
 *
 * 容错：单条识别失败跳过并计数，不中断整体解析。
 */
export function parseYoudaoBin(buffer: Buffer): YoudaoParseResult {
  const strings = readStrings(buffer);
  return groupEntries(strings);
}
