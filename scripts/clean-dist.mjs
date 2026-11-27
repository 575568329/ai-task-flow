#!/usr/bin/env node
// 构建前清空产物目录:tsc 不会删除源文件已移除后遗留的 .js,
// 旧产物会被一起打进 uTools/桌面包(评审会看到已删除的旧工具/开发机路径)。
// 用法: node scripts/clean-dist.mjs <dir> [dir...]
import fs from 'node:fs';
import path from 'node:path';

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('用法: node scripts/clean-dist.mjs <dir> [dir...]');
  process.exit(1);
}
for (const target of targets) {
  fs.rmSync(path.resolve(target), { recursive: true, force: true });
}
