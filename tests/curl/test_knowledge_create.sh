#!/bin/bash
set -euo pipefail

# AI Task Flow - 知识库写入(createDoc)HTTP API E2E 测试
# 用法: BASE_URL=http://localhost:3001 bash tests/curl/test_knowledge_create.sh

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
echo " Knowledge Create API E2E Tests"
echo " BASE_URL: $BASE_URL"
echo "=============================="

CREATED_PATH=""
TAGGED_PATH=""

# ============ 测试 1: 正常创建 → 201 + 命名规则 ============
echo ""
echo "=== 测试 1: 创建文档 返回 201 + path 命名规则 ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/knowledge/doc" \
  -H "Content-Type: application/json" \
  --data-binary '{"title":"curl测试文档","content":"# 测试\n正文内容"}')
CODE=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | sed '$d')
assert_status "创建返回 201" 201 "$CODE" "$BODY"
CREATED_PATH=$(extract_field "$BODY" ".path")
echo "  path = $CREATED_PATH"
if echo "$CREATED_PATH" | grep -qE '^[0-9]{14}_curl测试文档\.md$'; then
  echo "  PASS: 文件名符合 <timestamp>_<title>.md 规则"; PASS=$((PASS + 1))
else
  echo "  FAIL: 文件名不符合命名规则: $CREATED_PATH"; FAIL=$((FAIL + 1))
fi

# ============ 测试 2: 带 tags 创建 → 201 + frontmatter ============
echo ""
echo "=== 测试 2: 带 tags 创建 返回 201 + 读回含 frontmatter ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/knowledge/doc" \
  -H "Content-Type: application/json" \
  --data-binary '{"title":"带标签文档","content":"标签正文","tags":["e2e","test"]}')
CODE=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | sed '$d')
assert_status "带 tags 创建返回 201" 201 "$CODE" "$BODY"
TAGGED_PATH=$(extract_field "$BODY" ".path")
# 读回验证 content 以 frontmatter 开头
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/knowledge/doc?path=$TAGGED_PATH")
BODY=$(echo "$RESP" | sed '$d')
CONTENT=$(extract_field "$BODY" ".content")
if echo "$CONTENT" | head -1 | grep -q '^---'; then
  echo "  PASS: 读回 content 以 frontmatter 开头"; PASS=$((PASS + 1))
else
  echo "  FAIL: 读回内容未含 frontmatter, content=$CONTENT"; FAIL=$((FAIL + 1))
fi

# ============ 测试 3: 空 title → 400 ============
echo ""
echo "=== 测试 3: 空 title 返回 400 ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/knowledge/doc" \
  -H "Content-Type: application/json" \
  --data-binary '{"title":"","content":"x"}')
CODE=$(echo "$RESP" | tail -1)
assert_status "空 title 返回 400" 400 "$CODE" ""

# ============ 测试 4: dir 越界 → 403 ============
echo ""
echo "=== 测试 4: dir 越界返回 403 ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/knowledge/doc" \
  -H "Content-Type: application/json" \
  --data-binary '{"title":"越界","content":"x","dir":"../../etc"}')
CODE=$(echo "$RESP" | tail -1)
assert_status "dir 越界返回 403" 403 "$CODE" ""

# ============ 清理:删除测试创建的文档 ============
echo ""
echo "=== 清理测试数据 ==="
for p in "$CREATED_PATH" "$TAGGED_PATH"; do
  [ -n "$p" ] && curl -s -o /dev/null -X DELETE "$BASE_URL/api/knowledge/doc?path=$p"
done
echo "  cleaned"

# ============ 汇总 ============
echo ""
echo "=============================="
echo " 结果: $PASS passed, $FAIL failed"
echo "=============================="

[ "$FAIL" -eq 0 ] || exit 1
