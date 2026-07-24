#!/bin/bash
set -euo pipefail

# AI Task Flow - 知识库覆盖更新(saveDoc)HTTP API E2E 测试
# 用法: BASE_URL=http://localhost:3001 bash tests/curl/test_knowledge_save.sh

BASE_URL="${BASE_URL:-http://localhost:3001}"
PASS=0
FAIL=0

assert_status() {
  local desc="$1"; local expected="$2"; local actual="$3"; local body="$4"
  if [ "$actual" -eq "$expected" ]; then
    echo "  PASS: $desc (HTTP $actual)"; PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc - 期望 $expected, 实际 $actual"; echo "        Response: $body"; FAIL=$((FAIL + 1))
  fi
}

extract_field() {
  echo "$1" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8'))$2)"
}

echo "=============================="
echo " Knowledge Save API E2E Tests"
echo " BASE_URL: $BASE_URL"
echo "=============================="

# 前置:创建一篇待覆盖文档
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/knowledge/doc" \
  -H "Content-Type: application/json" \
  --data-binary '{"title":"save测试原文档","content":"old content"}')
BODY=$(echo "$RESP" | sed '$d')
DOC_PATH=$(extract_field "$BODY" ".path")
echo "  前置创建文档: $DOC_PATH"

# ============ 测试 1: PUT 覆盖 → 200 + ok ============
echo ""
echo "=== 测试 1: PUT 覆盖返回 200 + ok=true ==="
RESP=$(curl -s -w "\n%{http_code}" -X PUT "$BASE_URL/api/knowledge/doc?path=$DOC_PATH" \
  -H "Content-Type: application/json" \
  --data-binary '{"content":"new content from save"}')
CODE=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | sed '$d')
assert_status "覆盖返回 200" 200 "$CODE" "$BODY"
OK_VAL=$(extract_field "$BODY" ".ok")
if [ "$OK_VAL" = "true" ]; then
  echo "  PASS: 返回 ok=true"; PASS=$((PASS + 1))
else
  echo "  FAIL: ok 字段不是 true: $OK_VAL"; FAIL=$((FAIL + 1))
fi

# ============ 测试 2: 读回验证内容已更新 ============
echo ""
echo "=== 测试 2: 读回验证内容已更新 ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/knowledge/doc?path=$DOC_PATH")
BODY=$(echo "$RESP" | sed '$d')
CONTENT=$(extract_field "$BODY" ".content")
if [ "$CONTENT" = "new content from save" ]; then
  echo "  PASS: 内容已更新为新值"; PASS=$((PASS + 1))
else
  echo "  FAIL: 内容未更新, 实际: $CONTENT"; FAIL=$((FAIL + 1))
fi

# ============ 测试 3: PUT 不存在 path → 404 ============
echo ""
echo "=== 测试 3: PUT 不存在路径返回 404 ==="
RESP=$(curl -s -w "\n%{http_code}" -X PUT "$BASE_URL/api/knowledge/doc?path=99999999_nonexistent.md" \
  -H "Content-Type: application/json" \
  --data-binary '{"content":"x"}')
CODE=$(echo "$RESP" | tail -1)
assert_status "不存在返回 404" 404 "$CODE" ""

# ============ 测试 4: PUT 越界 → 403 ============
echo ""
echo "=== 测试 4: PUT 越界返回 403 ==="
RESP=$(curl -s -w "\n%{http_code}" -X PUT "$BASE_URL/api/knowledge/doc?path=../../etc/passwd" \
  -H "Content-Type: application/json" \
  --data-binary '{"content":"x"}')
CODE=$(echo "$RESP" | tail -1)
assert_status "越界返回 403" 403 "$CODE" ""

# ============ 清理 ============
echo ""
echo "=== 清理测试数据 ==="
curl -s -o /dev/null -X DELETE "$BASE_URL/api/knowledge/doc?path=$DOC_PATH"
echo "  cleaned"

# ============ 汇总 ============
echo ""
echo "=============================="
echo " 结果: $PASS passed, $FAIL failed"
echo "=============================="

[ "$FAIL" -eq 0 ] || exit 1
