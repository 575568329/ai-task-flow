#!/usr/bin/env bash
# scripts/publish.sh
# 一键按依赖顺序发布 @ai-task-flow/{shared,backend,cli} 到 npm
# 用法:
#   bash scripts/publish.sh           # 正式发布
#   bash scripts/publish.sh --dry-run # 预演,不真发(仅打包到 .tgz 看产物)

set -euo pipefail

DRY_RUN=""
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN="--dry-run"
  echo "★ DRY RUN 模式: 不会真的发布,仅检查包内容"
  echo ""
fi

# 进入仓库根目录
cd "$(dirname "$0")/.."

# 0. 检查登录状态
if [ -z "$DRY_RUN" ]; then
  echo "▶ 检查 npm 登录状态..."
  if ! npm whoami >/dev/null 2>&1; then
    echo "✗ 未登录 npm,请先运行: npm login"
    exit 1
  fi
  echo "  当前用户: $(npm whoami)"
  echo ""
fi

# 1. 一次性 build
echo "▶ 构建 shared / backend / frontend..."
npm run build
echo ""

# 2. 验证关键产物存在
echo "▶ 验证产物..."
test -f shared/dist/index.js          || { echo "✗ shared/dist/index.js 缺失"; exit 1; }
test -f backend/dist/http-server.js   || { echo "✗ backend/dist/http-server.js 缺失"; exit 1; }
test -f backend/public/index.html     || { echo "✗ backend/public/index.html 缺失(前端未打包?)"; exit 1; }
test -f cli/bin/ai-task-flow.js       || { echo "✗ cli/bin/ai-task-flow.js 缺失"; exit 1; }
echo "  ✓ 全部就位"
echo ""

# 3. 按依赖顺序发布: shared → backend → cli
publish_pkg() {
  local pkg_dir="$1"
  local pkg_name="$2"
  echo "▶ 发布 $pkg_name..."
  pushd "$pkg_dir" >/dev/null
  npm publish $DRY_RUN
  popd >/dev/null
  echo "  ✓ $pkg_name 完成"
  echo ""
}

publish_pkg "shared"  "@ai-task-flow/shared"
publish_pkg "backend" "@ai-task-flow/backend"
publish_pkg "cli"     "@ai-task-flow/cli"

if [ -z "$DRY_RUN" ]; then
  echo "==================================="
  echo " 🎉 全部发布成功"
  echo "==================================="
  echo ""
  echo "用户现在可以执行:"
  echo "  npm install -g @ai-task-flow/cli"
  echo "  ai-task-flow"
else
  echo "==================================="
  echo " ✓ DRY RUN 通过,产物可发布"
  echo "==================================="
fi
