#!/bin/bash
set -euo pipefail

# AI Task Flow - 翻译生词本 vocab HTTP API E2E 测试
# 用法: BASE_URL=http://localhost:3001 bash tests/curl/test_vocab_api.sh

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

assert_field() {
  local desc="$1"; local body="$2"; local field="$3"; local expected="$4"
  local actual
  actual=$(echo "$body" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d$field)" 2>/dev/null || echo "__PARSE_ERR__")
  if [ "$actual" = "$expected" ]; then
    echo "  PASS: $desc ($field = $actual)"; PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc - 期望 $expected, 实际 $actual"; FAIL=$((FAIL + 1))
  fi
}

# 从 body 提取 id（vocab id 是 UUID，动态生成）
extract_id() {
  echo "$1" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).id)"
}

echo "=============================="
echo " Vocab API E2E Tests"
echo " BASE_URL: $BASE_URL"
echo "=============================="

# ============ 测试 1: 新增生词（正常）============
echo ""
echo "=== 测试 1: 新增生词 hello -> 你好 ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/vocab" \
  -H "Content-Type: application/json" \
  --data-binary '{"word":"hello","translation":"你好","pos":"int.","definition":"问候语"}')
CODE=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | sed '$d')
assert_status "创建生词返回 201" 201 "$CODE" "$BODY"
assert_field "word 正确" "$BODY" ".word" "hello"
assert_field "translation 正确" "$BODY" ".translation" "你好"
assert_field "默认 targetLang=zh" "$BODY" ".targetLang" "zh"
assert_field "默认 starred=false" "$BODY" ".starred" "false"
HELLO_ID=$(extract_id "$BODY")

# ============ 测试 2: 去重（同 word+targetLang）-> 409 ============
echo ""
echo "=== 测试 2: 去重 hello(zh) 返回 409 ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/vocab" \
  -H "Content-Type: application/json" \
  --data-binary '{"word":"Hello","translation":"你好啊"}')
CODE=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | sed '$d')
assert_status "重复生词返回 409" 409 "$CODE" "$BODY"

# ============ 测试 3: 不同 targetLang 不算重复 -> 201 ============
echo ""
echo "=== 测试 3: hello(de) 不算重复 返回 201 ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/vocab" \
  -H "Content-Type: application/json" \
  --data-binary '{"word":"hello","translation":"hallo","targetLang":"de"}')
CODE=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | sed '$d')
assert_status "不同 targetLang 返回 201" 201 "$CODE" "$BODY"

# ============ 测试 4: 缺字段 -> 400 ============
echo ""
echo "=== 测试 4: 缺 translation 返回 400 ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/vocab" \
  -H "Content-Type: application/json" \
  --data-binary '{"word":"only-word"}')
CODE=$(echo "$RESP" | tail -1)
assert_status "缺必填字段返回 400" 400 "$CODE" ""

# ============ 测试 5: 列表 ============
echo ""
echo "=== 测试 5: 列表 total=2 ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/vocab")
CODE=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | sed '$d')
assert_status "列表返回 200" 200 "$CODE" "$BODY"
assert_field "总数为 2" "$BODY" ".total" "2"

# ============ 测试 6: 关键词搜索 ============
echo ""
echo "=== 测试 6: 关键词搜索 hello -> total=2(zh+de) ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/vocab?kw=hello")
CODE=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | sed '$d')
assert_status "搜索返回 200" 200 "$CODE" "$BODY"
assert_field "hello 命中 2 条" "$BODY" ".total" "2"

# ============ 测试 7: 单个查询 ============
echo ""
echo "=== 测试 7: 按 id 查询 ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/vocab/$HELLO_ID")
CODE=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | sed '$d')
assert_status "按 id 查询返回 200" 200 "$CODE" "$BODY"
assert_field "word 正确" "$BODY" ".word" "hello"

# ============ 测试 8: 不存在 -> 404 ============
echo ""
echo "=== 测试 8: 不存在 id 返回 404 ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/vocab/nonexistent-id")
CODE=$(echo "$RESP" | tail -1)
assert_status "不存在返回 404" 404 "$CODE" ""

# ============ 测试 9: PATCH 标记掌握/收藏 ============
echo ""
echo "=== 测试 9: PATCH 标记 mastered+starred ==="
RESP=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE_URL/api/vocab/$HELLO_ID" \
  -H "Content-Type: application/json" \
  --data-binary '{"mastered":true,"starred":true}')
CODE=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | sed '$d')
assert_status "PATCH 返回 200" 200 "$CODE" "$BODY"
assert_field "mastered=true" "$BODY" ".mastered" "true"
assert_field "starred=true" "$BODY" ".starred" "true"
assert_field "reviewCount=1" "$BODY" ".reviewCount" "1"

# ============ 测试 10: mastered 过滤 ============
echo ""
echo "=== 测试 10: mastered 过滤 total=1 ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/vocab?mastered=true")
CODE=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | sed '$d')
assert_status "mastered 过滤返回 200" 200 "$CODE" "$BODY"
assert_field "已掌握 1 条" "$BODY" ".total" "1"

# ============ 测试 11: 删除 -> 204 + 删后 404 ============
echo ""
echo "=== 测试 11: 删除 ==="
RESP=$(curl -s -w "\n%{http_code}" -X DELETE "$BASE_URL/api/vocab/$HELLO_ID")
CODE=$(echo "$RESP" | tail -1)
assert_status "删除返回 204" 204 "$CODE" ""
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/vocab/$HELLO_ID")
CODE=$(echo "$RESP" | tail -1)
assert_status "删除后查询返回 404" 404 "$CODE" ""

# ============ 汇总 ============
echo ""
echo "=============================="
echo " 结果: $PASS passed, $FAIL failed"
echo "=============================="

[ "$FAIL" -eq 0 ] || exit 1
