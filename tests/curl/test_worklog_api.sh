#!/bin/bash
# tests/curl/test_worklog_api.sh
# worklog API 冒烟:record → query → 更新 partial 语义 → 删除断言备份。
# 覆盖正常 + 异常场景(AGENTS.md 5.2 curl 测试约定)。
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:47821}"
TS="$(date +%s)"

echo "=== 测试:worklog record 正常场景 ==="
PAYLOAD=$(printf '{"project":"curl-smoke","version":"v9.9.9","title":"smoke %s","detail":"curl e2e entry %s","tags":["test"]}' "$TS" "$TS")
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
ENTRY_ID=$(echo "$BODY" | grep -o '"entryId":"[^"]*"' | cut -d'"' -f4)
if [ -z "$ENTRY_ID" ]; then
  echo "FAIL: 未取到 entryId"
  exit 1
fi
echo "PASS (entryId=$ENTRY_ID)"

echo "=== 测试:record 参数缺失 → 400 ==="
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/worklog/entries" \
  -H "Content-Type: application/json" \
  --data-binary '{"project":"curl-smoke","version":"v9.9.9"}')
if [ "$HTTP_CODE" -ne 400 ]; then
  echo "FAIL: 期望 400,实际 $HTTP_CODE"
  exit 1
fi
echo "PASS"

echo "=== 测试:partial 更新——只传 title 时 diff/其他字段不丢 ==="
UPDATE_PAYLOAD=$(printf '{"title":"smoke updated %s"}' "$TS")
curl -s -o /dev/null -X PUT "$BASE_URL/api/worklog/entries/$ENTRY_ID" \
  -H "Content-Type: application/json" \
  --data-binary "$UPDATE_PAYLOAD"
DETAIL=$(curl -s "$BASE_URL/api/worklog" | grep -o "\"detail\":\"curl e2e entry $TS\"")
if [ -z "$DETAIL" ]; then
  echo "FAIL: partial 更新后原 detail 丢失"
  exit 1
fi
echo "PASS"

echo "=== 测试:删除条目 → 200 且产生备份文件 ==="
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE_URL/api/worklog/entries/$ENTRY_ID")
if [ "$HTTP_CODE" -ne 200 ]; then
  echo "FAIL: 期望 200,实际 $HTTP_CODE"
  exit 1
fi
# 备份断言:worklog-backups 目录有以 backup- 开头的 json(由后端数据根生成,本地默认 ~/.ai-task-flow)
BACKUP_COUNT=$(ls "$HOME/.ai-task-flow/worklog-backups"/backup-*.json 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -lt 1 ]; then
  echo "FAIL: 删除后未发现快照备份"
  exit 1
fi
echo "PASS (backups=$BACKUP_COUNT)"

echo "=== 测试:rename 重名冲突 → 409 ==="
printf '{"project":"curl-smoke","version":"vA","title":"a","detail":"d"}' > /tmp/wl-a.json
printf '{"project":"curl-smoke","version":"vB","title":"b","detail":"d"}' > /tmp/wl-b.json
curl -s -o /dev/null -X POST "$BASE_URL/api/worklog/entries" -H "Content-Type: application/json" --data-binary @/tmp/wl-a.json
curl -s -o /dev/null -X POST "$BASE_URL/api/worklog/entries" -H "Content-Type: application/json" --data-binary @/tmp/wl-b.json
printf '{"project":"curl-smoke","version":"vA","newName":"vB"}' > /tmp/wl-rn.json
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/worklog/versions/rename" \
  -H "Content-Type: application/json" --data-binary @/tmp/wl-rn.json)
rm -f /tmp/wl-a.json /tmp/wl-b.json /tmp/wl-rn.json
if [ "$HTTP_CODE" -ne 409 ]; then
  echo "FAIL: 期望 409,实际 $HTTP_CODE"
  exit 1
fi
echo "PASS"

echo "=== 清理冒烟数据 ==="
curl -s -o /dev/null -X DELETE "$BASE_URL/api/worklog/projects/curl-smoke"
echo "=== 全部通过 ==="
