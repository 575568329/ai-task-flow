// backend/src/infrastructure/knowledge/__tests__/KnowledgeScanner.test.ts
import matter from 'gray-matter';
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { scanKnowledge } from '../KnowledgeScanner.js';

// ---------------------------------------------------------------------------
// sanitizeFrontmatterWikiLinks 是内部函数，通过 matter() 行为间接验证
// ---------------------------------------------------------------------------

describe('KnowledgeScanner', () => {
  // ---------------------------------------------------------------
  // sanitizeFrontmatterWikiLinks 间接测试（通过 matter 解析）
  // ---------------------------------------------------------------
  describe('frontmatter wiki-link 兼容', () => {
    it('should parse frontmatter with [[wiki-links]] without throwing', () => {
      const raw = [
        '---',
        'tags: [test, wiki]',
        'created: 2026-07-09',
        'related: [[other-doc]], [[another-doc]]',
        '---',
        '',
        '# Hello',
      ].join('\n');

      // 直接用 matter() 会抛 YAMLException（双中括号非法 YAML）
      expect(() => matter(raw)).toThrow();

      // sanitize: 将 [[...]] 行转为 YAML list
      const sanitize = (s: string) =>
        s.replace(
          /^---\r?\n([\s\S]*?)\r?\n---/,
          (_match, fm: string) => {
            const cleaned = fm.replace(
              /^(?<key>\S+):\s*(?<values>.*\[\[[^\]]+\]\].*)$/gm,
              (_line: string, key: string, values: string) => {
                const links = [...values.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]);
                if (links.length === 0) return _line;
                return `${key}:\n${links.map(l => `  - "[[${l}]]"`).join('\n')}`;
              },
            );
            return '---\n' + cleaned + '\n---';
          },
        );

      const sanitized = sanitize(raw);
      expect(() => matter(sanitized)).not.toThrow();

      const parsed = matter(sanitized);
      expect(parsed.data.tags).toEqual(['test', 'wiki']);
      // related 被转为 YAML list
      expect(parsed.data.related).toEqual(['[[other-doc]]', '[[another-doc]]']);
    });

    it('should not affect frontmatter without wiki-links', () => {
      const raw = [
        '---',
        'tags: [a, b]',
        'created: 2026-01-01',
        '---',
        '',
        'Content here.',
      ].join('\n');

      // sanitize 不改动无 [[...]] 的行
      const sanitized = raw.replace(
        /^---\r?\n([\s\S]*?)\r?\n---/,
        (_match, fm: string) => {
          const cleaned = fm.replace(
            /^(?<key>\S+):\s*(?<values>.*\[\[[^\]]+\]\].*)$/gm,
            (_line: string) => _line,
          );
          return '---\n' + cleaned + '\n---';
        },
      );
      const parsed = matter(sanitized);
      expect(parsed.data.tags).toEqual(['a', 'b']);
    });

    it('should only sanitize frontmatter, not body wiki-links', () => {
      const raw = [
        '---',
        'title: Test',
        '---',
        '',
        'See [[some-link]] for details.',
        'Also [[other|display text]].',
      ].join('\n');

      // sanitize 只处理 frontmatter 区域（正则限定在 --- 之间）
      const sanitized = raw.replace(
        /^---\r?\n([\s\S]*?)\r?\n---/,
        (_match, fm: string) => {
          const cleaned = fm.replace(
            /^(?<key>\S+):\s*(?<values>.*\[\[[^\]]+\]\].*)$/gm,
            (_line: string) => _line,
          );
          return '---\n' + cleaned + '\n---';
        },
      );

      // 正文中的 [[...]] 不应被修改
      expect(sanitized).toContain('See [[some-link]] for details.');
      expect(sanitized).toContain('Also [[other|display text]].');
    });
  });

  // ---------------------------------------------------------------
  // scanKnowledge 集成测试（临时目录）
  // ---------------------------------------------------------------
  describe('scanKnowledge', () => {
    let tmpDir: string;

    async function createTmpDir(): Promise<string> {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-test-'));
      return tmpDir;
    }

    async function writeFile(
      rel: string,
      content: string,
    ): Promise<void> {
      const abs = path.join(tmpDir, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, 'utf-8');
    }

    it('should handle wiki-links in frontmatter without skipping files', async () => {
      const dir = await createTmpDir();
      // 创建被引用的目标文件，使 backlink resolve 能成功
      await writeFile('架构设计/other-doc.md', [
        '---',
        'tags: [other]',
        '---',
        '',
        '# Other Doc',
      ].join('\n'));
      await writeFile('架构设计/another-doc.md', [
        '---',
        'tags: [another]',
        '---',
        '',
        '# Another Doc',
      ].join('\n'));

      await writeFile('架构设计/test-wiki.md', [
        '---',
        'tags: [wiki, test]',
        'created: 2026-07-09',
        'related: [[other-doc]], [[another-doc]]',
        '---',
        '',
        '# Test Wiki Doc',
        '',
        'See [[other-doc]] in body.',
      ].join('\n'));

      const manifest = await scanKnowledge(dir);
      const doc = manifest.flatDocs.find(d => d.name === 'test-wiki.md');
      expect(doc).toBeDefined();
      // 关键验证：之前 frontmatter 解析失败会跳过整个文件，现在 tags 正常解析
      expect(doc?.tags).toEqual(['wiki', 'test']);
      expect(doc?.contentPreview).toContain('Test Wiki Doc');
      // wiki-links 从 raw 提取（frontmatter 2个 + body 1个 = 3 个，其中 other-doc 重复）
      expect(doc?.links).toHaveLength(3);
      const otherDoc = manifest.flatDocs.find(d => d.name === 'other-doc.md');
      expect(doc?.links).toContain(otherDoc?.path);
    });

    it('should resolve backlinks from wiki-links', async () => {
      const dir = await createTmpDir();
      await writeFile('a.md', [
        '---',
        'tags: [a]',
        '---',
        '',
        '# Doc A',
        '',
        'Links to [[b]] and [[c]].',
      ].join('\n'));
      await writeFile('b.md', [
        '---',
        'tags: [b]',
        '---',
        '',
        '# Doc B',
      ].join('\n'));

      const manifest = await scanKnowledge(dir);
      const docA = manifest.flatDocs.find(d => d.name === 'a.md');
      const docB = manifest.flatDocs.find(d => d.name === 'b.md');

      // a 链接到 b
      expect(docA?.links).toContain(docB?.path);
      // b 的反向链接包含 a
      expect(manifest.backlinks[docB!.path]).toContain(docA?.path);
    });

    it('should return empty manifest for empty directory', async () => {
      const dir = await createTmpDir();
      const manifest = await scanKnowledge(dir);
      expect(manifest.flatDocs).toEqual([]);
      expect(manifest.tags).toEqual([]);
    });

    it('should skip unsupported file extensions', async () => {
      const dir = await createTmpDir();
      await writeFile('readme.txt', 'just text');
      await writeFile('note.md', [
        '---',
        'tags: [note]',
        '---',
        '',
        '# Note',
      ].join('\n'));

      const manifest = await scanKnowledge(dir);
      expect(manifest.flatDocs).toHaveLength(1);
      expect(manifest.flatDocs[0].name).toBe('note.md');
    });
  });
});
