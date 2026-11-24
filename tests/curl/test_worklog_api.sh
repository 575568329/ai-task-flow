#!/bin/bash
# tests/curl/test_worklog_api.sh
# worklog API 冒烟(新模型 主题 → 版本 → 条目):
#   建项目 → 建主题 → 建版本 → 记录条目 → 查询 → partial 更新 → 删除(断言备份)
#   → 版本/主题 CRUD → 清理(版本 → 主题 → 项目)。
# 覆盖正常 + 异常场景(AGENTS.md 5.2 curl 测试约定);只依赖 BASE_URL,不写死端口。
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:47821}"
DATA_DIR="${AI_TASK_FLOW_DATA_DIR:-$HOME/.ai-task-flow}"
TS="$(date +%s)"
PROJECT="curl-smoke-$TS"
PROGRAM="g-curl-$TS"
VERSION="v-curl-$TS"
VERSION_2="v-curl2-$TS"

# 从 `{"id":"v_xxx"}` / `{"entryId":"e_xxx"}` 里提取标识
extract_field() {
  echo "$1" | grep -o "\"$2\":\"[^\"]*\"" | head -1 | cut -d'"' -f4
}

echo "=== 测试:建项目 正常场景 ==="
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/worklog/projects" \
  -H "Content-Type: application/json" \
  --data-binary "{\"name\":\"$PROJECT\"}")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')
if [ "$HTTP_CODE" -ne 201 ]; then
  echo "FAIL: 期望 201,实际 $HTTP_CODE"
  echo "Response: $BODY"
  exit 1
fi
PROJECT_ID=$(extract_field "$BODY" "id")
if [ -z "$PROJECT_ID" ]; then
  echo "FAIL: 未取到项目 id"
  exit 1
fi
echo "PASS (projectId=$PROJECT_ID)"

echo "=== 测试:项目重名 → 409 ==="
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/worklog/projects" \
  -H "Content-Type: application/json" \
  --data-binary "{\"name\":\"$PROJECT\"}")
if [ "$HTTP_CODE" -ne 409 ]; then
  echo "FAIL: 期望 409,实际 $HTTP_CODE"
  exit 1
fi
echo "PASS"

echo "=== 测试:建主题 正常场景 ==="
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/worklog/programs" \
  -H "Content-Type: application/json" \
  --data-binary "{\"name\":\"$PROGRAM\"}")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')
if [ "$HTTP_CODE" -ne 201 ]; then
  echo "FAIL: 期望 201,实际 $HTTP_CODE"
  echo "Response: $BODY"
  exit 1
fi
PROGRAM_ID=$(extract_field "$BODY" "id")
if [ -z "$PROGRAM_ID" ]; then
  echo "FAIL: 未取到主题 id"
  exit 1
fi
case "$PROGRAM_ID" in
  g_*) ;;
  *)
    echo "FAIL: 主题 id 应以 g_ 开头,实际 $PROGRAM_ID"
    exit 1
    ;;
esac
echo "PASS (programId=$PROGRAM_ID)"

echo "=== 测试:建版本缺 programId → 400 ==="
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/worklog/versions" \
  -H "Content-Type: application/json" \
  --data-binary "{\"name\":\"v-nopid-$TS\"}")
if [ "$HTTP_CODE" -ne 400 ]; then
  echo "FAIL: 缺 programId 期望 400,实际 $HTTP_CODE"
  exit 1
fi
echo "PASS"

echo "=== 测试:建版本未知 programId → 404 ==="
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/worklog/versions" \
  -H "Content-Type: application/json" \
  --data-binary "{\"name\":\"v-badpid-$TS\",\"programId\":\"g_nope\"}")
if [ "$HTTP_CODE" -ne 404 ]; then
  echo "FAIL: 未知 programId 期望 404,实际 $HTTP_CODE"
  exit 1
fi
echo "PASS"

echo "=== 测试:非法字段类型 → 400(不得 500) ==="
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/worklog/versions" \
  -H "Content-Type: application/json" \
  --data-binary '{"name":123}')
if [ "$HTTP_CODE" -ne 400 ]; then
  echo "FAIL: versions name 非字符串期望 400,实际 $HTTP_CODE"
  exit 1
fi
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/worklog/entries" \
  -H "Content-Type: application/json" \
  --data-binary '{"versionId":"v_x","title":123,"detail":"d"}')
if [ "$HTTP_CODE" -ne 400 ]; then
  echo "FAIL: entries title 非字符串期望 400,实际 $HTTP_CODE"
  exit 1
fi
echo "PASS"

echo "=== 测试:建版本 正常场景 ==="
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/worklog/versions" \
  -H "Content-Type: application/json" \
  --data-binary "{\"name\":\"$VERSION\",\"programId\":\"$PROGRAM_ID\"}")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')
if [ "$HTTP_CODE" -ne 201 ]; then
  echo "FAIL: 期望 201,实际 $HTTP_CODE"
  echo "Response: $BODY"
  exit 1
fi
VERSION_ID=$(extract_field "$BODY" "id")
if [ -z "$VERSION_ID" ]; then
  echo "FAIL: 未取到版本 id"
  exit 1
fi
echo "PASS (versionId=$VERSION_ID)"

echo "=== 测试:record 正常场景(版本直挂条目,无需求层) ==="
PAYLOAD=$(printf '{"versionId":"%s","title":"smoke %s","detail":"curl e2e entry %s","tags":["test"],"stage":"dev","project":"%s"}' \
  "$VERSION_ID" "$TS" "$TS" "$PROJECT")
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/worklog/entries" \
  -H "Content-Type: application/json" \
  --data-binary "$PAYLOAD")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')
if [ "$HTTP_CODE" -ne 201 ]; then
  echo "FAIL: 期望 201,实际 $HTTP_CODE"
  echo "Response: $BODY"
  exit 1
fi
ENTRY_ID=$(extract_field "$BODY" "entryId")
if [ -z "$ENTRY_ID" ]; then
  echo "FAIL: 未取到 entryId"
  exit 1
fi
echo "PASS (entryId=$ENTRY_ID)"

echo "=== 测试:record 参数缺失 → 400 ==="
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/worklog/entries" \
  -H "Content-Type: application/json" \
  --data-binary "{\"versionId\":\"$VERSION_ID\"}")
if [ "$HTTP_CODE" -ne 400 ]; then
  echo "FAIL: 期望 400,实际 $HTTP_CODE"
  exit 1
fi
echo "PASS"

echo "=== 测试:record 未知版本 id → 404(不自动建层) ==="
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/worklog/entries" \
  -H "Content-Type: application/json" \
  --data-binary "{\"versionId\":\"v_nope\",\"title\":\"t\",\"detail\":\"d\"}")
if [ "$HTTP_CODE" -ne 404 ]; then
  echo "FAIL: 期望 404,实际 $HTTP_CODE"
  exit 1
fi
echo "PASS"

echo "=== 测试:partial 更新——只传 title 时 detail 不丢 ==="
curl -s -o /dev/null -X PUT "$BASE_URL/api/worklog/entries/$ENTRY_ID" \
  -H "Content-Type: application/json" \
  --data-binary "$(printf '{"title":"smoke updated %s"}' "$TS")"
DETAIL=$(curl -s "$BASE_URL/api/worklog" | grep -o "\"detail\":\"curl e2e entry $TS\"")
if [ -z "$DETAIL" ]; then
  echo "FAIL: partial 更新后原 detail 丢失"
  exit 1
fi
echo "PASS"

echo "=== 测试:版本 rename 重名冲突 → 409,按 id 改名 → 200 ==="
VERSION_2_BODY=$(curl -s -X POST "$BASE_URL/api/worklog/versions" \
  -H "Content-Type: application/json" \
  --data-binary "{\"name\":\"$VERSION_2\",\"programId\":\"$PROGRAM_ID\"}")
VERSION_2_ID=$(extract_field "$VERSION_2_BODY" "id")
if [ -z "$VERSION_2_ID" ]; then
  echo "FAIL: 未取到第二版本 id"
  exit 1
fi
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/worklog/versions/$VERSION_ID/rename" \
  -H "Content-Type: application/json" \
  --data-binary "{\"newName\":\"$VERSION_2\"}")
if [ "$HTTP_CODE" -ne 409 ]; then
  echo "FAIL: 期望 409,实际 $HTTP_CODE"
  exit 1
fi
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/worklog/versions/$VERSION_ID/rename" \
  -H "Content-Type: application/json" \
  --data-binary "{\"newName\":\"$VERSION-updated\"}")
if [ "$HTTP_CODE" -ne 200 ]; then
  echo "FAIL: 改名期望 200,实际 $HTTP_CODE"
  exit 1
fi
echo "PASS"

echo "=== 测试:删除条目 → 200 且产生备份文件 ==="
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE_URL/api/worklog/entries/$ENTRY_ID")
if [ "$HTTP_CODE" -ne 200 ]; then
  echo "FAIL: 期望 200,实际 $HTTP_CODE"
  exit 1
fi
BACKUP_COUNT=$(find "$DATA_DIR/worklog-backups" -name 'backup-*.json' 2>/dev/null | wc -l || true)
if [ "$BACKUP_COUNT" -lt 1 ]; then
  echo "FAIL: 删除后未发现快照备份(数据目录 $DATA_DIR)"
  exit 1
fi
echo "PASS (backups=$BACKUP_COUNT)"

echo "=== 测试:删除版本/主题/项目(清理) ==="
for path in \
  "versions/$VERSION_ID" \
  "versions/$VERSION_2_ID" \
  "programs/$PROGRAM_ID" \
  "projects/$PROJECT"; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE_URL/api/worklog/$path")
  if [ "$HTTP_CODE" -ne 200 ]; then
    echo "FAIL: DELETE $path 期望 200,实际 $HTTP_CODE"
    exit 1
  fi
done
echo "PASS"
echo "=== 全部通过 ==="
