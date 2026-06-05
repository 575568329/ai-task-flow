#!/bin/bash
set -euo pipefail

# AI Task Flow - HTTP API E2E 测试
# 用法: BASE_URL=http://localhost:3001 bash tests/curl/test_task_api.sh

BASE_URL="${BASE_URL:-http://localhost:3001}"
PASS=0
FAIL=0

# 工具函数：断言 HTTP 状态码
assert_status() {
  local desc="$1"
  local expected="$2"
  local actual="$3"
  local body="$4"

  if [ "$actual" -eq "$expected" ]; then
    echo "  PASS: $desc (HTTP $actual)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc - 期望 $expected, 实际 $actual"
    echo "        Response: $body"
    FAIL=$((FAIL + 1))
  fi
}

# 工具函数：断言 JSON 字段
assert_field() {
  local desc="$1"
  local body="$2"
  local field="$3"
  local expected="$4"
  local actual
  actual=$(echo "$body" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d$field)")

  if [ "$actual" = "$expected" ]; then
    echo "  PASS: $desc ($field = $actual)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc - 期望 $expected, 实际 $actual"
    FAIL=$((FAIL + 1))
  fi
}

echo "=============================="
echo " AI Task Flow E2E API Tests"
echo " BASE_URL: $BASE_URL"
echo "=============================="

# ============ 测试 1: 健康检查 ============
echo ""
echo "=== 测试 1: 健康检查 ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/health")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status "健康检查返回 200" 200 "$CODE" "$BODY"
assert_field "状态为 ok" "$BODY" ".status" "ok"

# ============ 测试 2: 创建任务 ============
echo ""
echo "=== 测试 2: 创建任务（正常场景）==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/tasks" \
  -H "Content-Type: application/json" \
  --data-binary '{"prefix":"E2E","title":"E2E test task","description":"verify full flow","priority":"P0","projects":["test-project"],"acceptanceCriteria":["api works","status correct"]}')
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status "创建任务返回 201" 201 "$CODE" "$BODY"
assert_field "任务 ID 为 E2E-001" "$BODY" ".id" "E2E-001"
assert_field "标题正确" "$BODY" ".title" "E2E test task"
assert_field "状态为 todo" "$BODY" ".status" "todo"
assert_field "优先级为 P0" "$BODY" ".priority" "P0"

# ============ 测试 3: 创建第二个任务（序号递增）============
echo ""
echo "=== 测试 3: 创建第二个任务（验证序号递增）==="
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/tasks" \
  -H "Content-Type: application/json" \
  --data-binary '{"prefix":"E2E","title":"Second task","description":"check sequence"}')
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status "创建任务返回 201" 201 "$CODE" "$BODY"
assert_field "任务 ID 递增为 E2E-002" "$BODY" ".id" "E2E-002"

# ============ 测试 4: 获取所有任务 ============
echo ""
echo "=== 测试 4: 获取所有任务 ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/tasks")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status "获取所有任务返回 200" 200 "$CODE" "$BODY"
assert_field "任务数量为 2" "$BODY" ".length" "2"

# ============ 测试 5: 根据 ID 获取任务 ============
echo ""
echo "=== 测试 5: 根据 ID 获取任务 ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/tasks/E2E-001")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status "获取任务返回 200" 200 "$CODE" "$BODY"
assert_field "任务 ID 正确" "$BODY" ".id" "E2E-001"

# ============ 测试 6: 获取不存在的任务（异常场景）============
echo ""
echo "=== 测试 6: 获取不存在的任务（异常场景）==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/tasks/E2E-999")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status "不存在的任务返回 404" 404 "$CODE" "$BODY"

# ============ 测试 7: 更新任务状态 ============
echo ""
echo "=== 测试 7: 更新任务状态 ==="
RESP=$(curl -s -w "\n%{http_code}" -X PATCH "$BASE_URL/api/tasks/E2E-001" \
  -H "Content-Type: application/json" \
  --data-binary '{"status":"dispatched","title":"Updated title"}')
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status "更新任务返回 200" 200 "$CODE" "$BODY"
assert_field "状态更新为 dispatched" "$BODY" ".status" "dispatched"
assert_field "标题更新" "$BODY" ".title" "Updated title"

# ============ 测试 8: 按状态查询 ============
echo ""
echo "=== 测试 8: 按状态查询任务 ==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/tasks/status/dispatched")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status "按状态查询返回 200" 200 "$CODE" "$BODY"
assert_field "dispatched 状态任务数为 1" "$BODY" ".length" "1"

# ============ 测试 9: 无效状态查询（异常场景）============
echo ""
echo "=== 测试 9: 无效状态查询（异常场景）==="
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/tasks/status/invalid_status")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
assert_status "无效状态返回 400" 400 "$CODE" "$BODY"

# ============ 测试 10: 删除任务 ============
echo ""
echo "=== 测试 10: 删除任务 ==="
RESP=$(curl -s -w "\n%{http_code}" -X DELETE "$BASE_URL/api/tasks/E2E-002")
CODE=$(echo "$RESP" | tail -1)
assert_status "删除任务返回 204" 204 "$CODE" ""

# 验证删除后 404
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/tasks/E2E-002")
CODE=$(echo "$RESP" | tail -1)
assert_status "删除后查询返回 404" 404 "$CODE" ""

# ============ 汇总 ============
echo ""
echo "=============================="
echo " 结果: $PASS passed, $FAIL failed"
echo "=============================="

[ "$FAIL" -eq 0 ] || exit 1
