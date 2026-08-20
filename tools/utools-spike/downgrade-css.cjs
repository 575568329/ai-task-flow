/**
 * uTools 兼容性 spike:按 Chromium 108(uTools 7.8 = Electron 22.3.27)降级前端 CSS 产物。
 *
 * 用法: node downgrade-css.cjs <in.css> <out.css>
 *
 * 实测结论(2026-08-20):
 * - oklch(): 123 处全部转 rgb() ✅
 * - color-mix(): 183 处全部保留 ❌(带 var() 操作数无法静态求值,108 下这些声明无效)
 */
const lightningcss = require('lightningcss');
const fs = require('fs');

const [src, dst] = process.argv.slice(2);
if (!src || !dst) {
  console.error('用法: node downgrade-css.cjs <in.css> <out.css>');
  process.exit(1);
}

const res = lightningcss.transform({
  filename: src,
  code: fs.readFileSync(src),
  targets: lightningcss.browserslistToTargets(['chrome 108']),
});
fs.writeFileSync(dst, res.code);
console.log(`OK: ${src} -> ${dst} (${res.code.length} bytes)`);
