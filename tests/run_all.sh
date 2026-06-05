#!/bin/bash
set -euo pipefail

# AI Task Flow - 测试编排脚本
# 用法：
#   1. 先启动后端：cd backend && PORT=3001 npm run http
#   2. 运行测试：BASE_URL=http://localhost:3001 bash tests/run_all.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_URL="${BASE_URL:-http://localhost:3001}"
PASSED=0
FAILED=0

echo "=============================="
echo " Running All E2E Tests"
echo " BASE_URL: $BASE_URL"
echo "=============================="

# 预检查：后端是否可达
if ! curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/health" | grep -q "200"; then
  echo "ERROR: 后端不可达 ($BASE_URL/health)"
  echo "请先启动后端：cd backend && PORT=3001 npm run http"
  exit 1
fi

for test_file in "$SCRIPT_DIR"/curl/test_*.sh; do
  echo ""
  echo "▶ Running: $(basename "$test_file")"
  if BASE_URL="$BASE_URL" bash "$test_file"; then
    PASSED=$((PASSED + 1))
  else
    FAILED=$((FAILED + 1))
    echo "✗ FAILED: $(basename "$test_file")"
  fi
done

echo ""
echo "=============================="
echo " Results: $PASSED suites passed, $FAILED failed"
echo "=============================="

[ "$FAILED" -eq 0 ] || exit 1
