// backend/scripts/import-knowledge.ts
// 一次性导入脚本:从 D:/Study/KnowledgeBase/docs 拷贝到 knowledge-base/
import fs from 'node:fs/promises';
import path from 'node:path';

const SOURCE = 'D:/Study/KnowledgeBase/docs';
const TARGET = path.resolve(process.cwd(), 'knowledge-base');

const SUPPORTED_EXTS = new Set([
  '.md', '.markdown',
  '.pdf',
  '.docx', '.doc',
  '.html', '.htm',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico',
]);

async function copyRecursive(src: string, dest: string) {
  const stat = await fs.stat(src);

  if (stat.isDirectory()) {
    // 创建目标目录
    await fs.mkdir(dest, { recursive: true });

    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const ent of entries) {
      // 跳过隐藏文件/目录
      if (ent.name.startsWith('.')) continue;

      const srcPath = path.join(src, ent.name);
      const destPath = path.join(dest, ent.name);

      if (ent.isDirectory()) {
        await copyRecursive(srcPath, destPath);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (SUPPORTED_EXTS.has(ext)) {
          await fs.copyFile(srcPath, destPath);
          console.log(`✓ ${path.relative(TARGET, destPath)}`);
        }
      }
    }
  } else if (stat.isFile()) {
    await fs.copyFile(src, dest);
  }
}

async function main() {
  console.log('开始导入知识库文档...');
  console.log(`源目录: ${SOURCE}`);
  console.log(`目标目录: ${TARGET}\n`);

  try {
    // 检查源目录
    await fs.access(SOURCE);
  } catch {
    console.error(`✗ 源目录不存在: ${SOURCE}`);
    process.exit(1);
  }

  // 清空目标目录(可选,根据需要调整)
  try {
    await fs.rm(TARGET, { recursive: true, force: true });
    console.log('✓ 已清空目标目录\n');
  } catch {}

  await copyRecursive(SOURCE, TARGET);

  console.log('\n✅ 导入完成!');
  console.log(`\n运行以下命令验证:`);
  console.log(`  cd backend && npm run dev`);
  console.log(`  curl http://localhost:3000/api/knowledge/manifest | jq '.flatDocs | length'`);
}

main().catch(err => {
  console.error('✗ 导入失败:', err);
  process.exit(1);
});
