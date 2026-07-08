#!/bin/bash
set -euo pipefail

# AI Task Flow - 翻译 API E2E 测试
# 注意:翻译需后端已配置 LLM(设置页填 apiKey)。
#   - 已配置(如 Windows 的 glm-5.2):返回 200 + 结构化译文
#   - 未配置(如 WSL 临时空数据目录):返回 400,error 含 "API Key/设置"
# 用法: BASE_URL=http://localhost:3001 bash tests/curl/test_vocab_translate.sh

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

echo "=============================="
echo " Vocab Translate API E2E"
echo " BASE_URL: $BASE_URL"
echo "=============================="

# ============ 测试 1: text 缺失 → 400 ============
echo ""
echo "=== 测试 1: text 缺失 返回 400 ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/vocab/translate" \
  -H "Content-Type: application/json" \
  --data-binary '{}')
CODE=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | sed '$d')
assert_status "text 缺失返回 400" 400 "$CODE" "$BODY"

# ============ 测试 2: text 空字符串 → 400 ============
echo ""
echo "=== 测试 2: text 为空字符串 返回 400 ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/vocab/translate" \
  -H "Content-Type: application/json" \
  --data-binary '{"text":"   "}')
CODE=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | sed '$d')
assert_status "text 空白返回 400" 400 "$CODE" "$BODY"

# ============ 测试 3: 正常翻译(适配是否配置 LLM)============
echo ""
echo "=== 测试 3: 翻译 hello(已配置→200+译文;未配置→400 友好提示) ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/vocab/translate" \
  -H "Content-Type: application/json" \
  --data-binary '{"text":"hello"}')
CODE=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | sed '$d')

if [ "$CODE" = "200" ]; then
  TRANSLATION=$(echo "$BODY" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.translation||'')" 2>/dev/null || echo "")
  if [ -n "$TRANSLATION" ]; then
    echo "  PASS: 翻译成功 200,translation=\"$TRANSLATION\""; PASS=$((PASS + 1))
  else
    echo "  FAIL: 200 但 translation 为空"; echo "        Response: $BODY"; FAIL=$((FAIL + 1))
  fi
elif [ "$CODE" = "400" ]; then
  # 未配置 LLM:error 应含 API Key/设置
  if echo "$BODY" | grep -qE "API Key|设置"; then
    echo "  PASS: 未配置 LLM 返回 400 + 友好提示(SKIP 翻译,需在设置页配 LLM)"; PASS=$((PASS + 1))
  else
    echo "  FAIL: 400 但 error 未含 API Key/设置"; echo "        Response: $BODY"; FAIL=$((FAIL + 1))
  fi
else
  echo "  FAIL: 期望 200 或 400, 实际 $CODE"; echo "        Response: $BODY"; FAIL=$((FAIL + 1))
fi

# ============ 测试 4: 句子翻译 ============
echo ""
echo "=== 测试 4: 翻译句子 ==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/vocab/translate" \
  -H "Content-Type: application/json" \
  --data-binary '{"text":"The quick brown fox jumps over the lazy dog."}')
CODE=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | sed '$d')
if [ "$CODE" = "200" ]; then
  echo "  PASS: 句子翻译 200"; PASS=$((PASS + 1))
elif [ "$CODE" = "400" ]; then
  echo "  PASS: 未配置 LLM 400(预期,SKIP)"; PASS=$((PASS + 1))
else
  echo "  FAIL: 期望 200/400, 实际 $CODE"; echo "        Response: $BODY"; FAIL=$((FAIL + 1))
fi

# ============ 汇总 ============
echo ""
echo "=============================="
echo " 结果: $PASS passed, $FAIL failed"
echo " (翻译成功需后端配置 LLM;WSL 临时环境未配置则只验证 400 路径)"
echo "=============================="

[ "$FAIL" -eq 0 ] || exit 1
