#!/bin/bash
set -euo pipefail

# AI Task Flow - Claude 会话接口 E2E 测试(会话化改造 Phase 1)
# 用法: BASE_URL=http://localhost:3001 bash tests/curl/test_claude_sessions.sh
#
# 覆盖:
#   - GET  /api/system/claude-sessions         扫描历史会话
#   - POST /api/system/claude-sessions/open    打开终端启动 claude
#
# 注: open 的成功场景会真实弹出终端窗口,不适合自动化;本脚本只覆盖
#     参数校验分支(400)。成功路径(open 返回 200 + claudeCommand、恢复会话回写
#     sessionLink)请在后端运行时手动验证。

BASE_URL="${BASE_URL:-http://localhost:3001}"
TEST_REPO_PATH="${TEST_REPO_PATH:-$HOME}"
PASS=0
FAIL=0

assert_status() {
  local desc="$1"; local expected="$2"; local actual="$3"; local body="$4"
  if [ "$actual" -eq "$expected" ]; then
    echo "  PASS: $desc (HTTP $actual)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc - 期望 $expected, 实际 $actual"
    echo "        Response: $body"
    FAIL=$((FAIL + 1))
  fi
}

# 断言 body.sessions 是数组(node 校验 Array.isArray)
assert_sessions_array() {
  local desc="$1"; local body="$2"; local actual
  actual=$(echo "$body" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(Array.isArray(d.sessions))" 2>/dev/null || echo "false")
  if [ "$actual" = "true" ]; then
    echo "  PASS: $desc (sessions 为数组)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc - sessions 不是数组"
    echo "        Response: $body"
    FAIL=$((FAIL + 1))
  fi
}

echo "=============================="
echo " Claude Sessions API Tests"
echo " BASE_URL: $BASE_URL"
echo "=============================="

# ============ 测试 1: 扫描会话缺 repoPath → 400 ============
echo ""
echo "=== 测试 1: 扫描会话缺 repoPath(异常)==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/system/claude-sessions")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status "缺 repoPath 返回 400" 400 "$CODE" "$BODY"

# ============ 测试 2: 扫描会话合法 repoPath → 200 + sessions 数组 ============
echo ""
echo "=== 测试 2: 扫描会话合法 repoPath(正常)==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/system/claude-sessions?repoPath=$(printf '%s' "$TEST_REPO_PATH" | sed 's/ /%20/g')")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status "合法 repoPath 返回 200" 200 "$CODE" "$BODY"
assert_sessions_array "响应含 sessions 数组" "$BODY"

# ============ 测试 3: 打开会话缺 env → 400 ============
echo ""
echo "=== 测试 3: 打开会话缺 env(异常)==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/system/claude-sessions/open" \
  -H "Content-Type: application/json" \
  --data-binary '{"repoPath":"x"}')
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status "缺 env 返回 400" 400 "$CODE" "$BODY"

# ============ 测试 4: 打开会话缺 repoPath → 400 ============
echo ""
echo "=== 测试 4: 打开会话缺 repoPath(异常)==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/system/claude-sessions/open" \
  -H "Content-Type: application/json" \
  --data-binary '{"env":"cmd"}')
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status "缺 repoPath 返回 400" 400 "$CODE" "$BODY"

# ============ 汇总 ============
echo ""
echo "=============================="
echo " 结果: $PASS passed, $FAIL failed"
echo "=============================="

[ "$FAIL" -eq 0 ] || exit 1
