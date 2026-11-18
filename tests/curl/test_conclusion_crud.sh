#!/bin/bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:47821}"

fail() {
  echo "FAIL: $1"
  exit 1
}

echo "=== 结论卡 E2E ==="

STATUS=$(curl -s "$BASE_URL/health" | jq -r '.status // empty')
[ "$STATUS" = "ok" ] || fail "后端不可达 ($BASE_URL/health)"

echo "--- 1. 创建 ---"
CREATE=$(curl -s -X POST "$BASE_URL/api/conclusions" \
  -H "Content-Type: application/json" \
  -d '{"scope":"project","project":"e2e-conclusion","title":"E2E 结论","decision":"旧结论：前端过滤","data":"旧数据"}')
ID=$(echo "$CREATE" | jq -r '.id // empty')
[ -n "$ID" ] || fail "创建失败: $CREATE"
echo "PASS: id=$ID"

echo "--- 2. 读取当前进度 ---"
DETAIL=$(curl -s "$BASE_URL/api/conclusions/$ID")
[ "$(echo "$DETAIL" | jq -r '.revisions[0].decision')" = "旧结论：前端过滤" ] || fail "详情读取错误: $DETAIL"
echo "PASS"

echo "--- 3. 部分字段追加（decision 沿用，data 更新） ---"
APPEND=$(curl -s -X POST "$BASE_URL/api/conclusions/$ID/revisions" \
  -H "Content-Type: application/json" \
  -d '{"expectedRev":1,"data":"新数据","changeNote":"补充数据"}')
[ "$(echo "$APPEND" | jq -r '.rev')" = "2" ] || fail "追加失败: $APPEND"
DETAIL=$(curl -s "$BASE_URL/api/conclusions/$ID")
[ "$(echo "$DETAIL" | jq -r '.revisions[1].decision')" = "旧结论：前端过滤" ] || fail "decision 未沿用"
[ "$(echo "$DETAIL" | jq -r '.revisions[1].data')" = "新数据" ] || fail "data 未更新"
echo "PASS"

echo "--- 4. 搜索命中历史版本 ---"
# keyword=旧数据（只存在于 rev 1；rev 2 的 data 已是「新数据」，而 decision 按设计沿用，
# 用「前端过滤」会连最新版一起命中，matchedRev 就不会出现）。
# URL 必须是百分号编码：请求行里的裸 UTF-8 会被 Node 直接拒绝为 400。
SEARCH=$(curl -s "$BASE_URL/api/conclusions?keyword=%E6%97%A7%E6%95%B0%E6%8D%AE")
[ "$(echo "$SEARCH" | jq -r '.conclusions[0].matchedRev')" = "1" ] || fail "历史命中错误: $SEARCH"
echo "PASS"

echo "--- 5. expectedRev 冲突 ---"
CODE=$(curl -s -o /tmp/conclusion-conflict.json -w "%{http_code}" -X POST "$BASE_URL/api/conclusions/$ID/revisions" \
  -H "Content-Type: application/json" \
  -d '{"expectedRev":1,"data":"stale","changeNote":"stale"}')
[ "$CODE" = "409" ] || fail "期望 409，实际 $CODE: $(cat /tmp/conclusion-conflict.json)"
echo "PASS"

echo "--- 6. 缺 changeNote 拒绝 ---"
CODE=$(curl -s -o /tmp/conclusion-bad.json -w "%{http_code}" -X POST "$BASE_URL/api/conclusions/$ID/revisions" \
  -H "Content-Type: application/json" \
  -d '{"data":"x"}')
[ "$CODE" = "400" ] || fail "期望 400，实际 $CODE"
echo "PASS"

echo "--- 7. 改元信息 ---"
PATCH=$(curl -s -X PATCH "$BASE_URL/api/conclusions/$ID" \
  -H "Content-Type: application/json" \
  -d '{"title":"E2E 结论（改名）"}')
[ "$(echo "$PATCH" | jq -r '.title')" = "E2E 结论（改名）" ] || fail "PATCH 失败: $PATCH"
echo "PASS"

echo "--- 8. 删除并保留历史可查（备份在数据目录） ---"
DEL=$(curl -s -X DELETE "$BASE_URL/api/conclusions/$ID")
[ "$(echo "$DEL" | jq -r '.deleted')" = "true" ] || fail "删除失败: $DEL"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/conclusions/$ID")
[ "$CODE" = "404" ] || fail "删除后应 404，实际 $CODE"
echo "PASS"

echo "=== 全部通过 ==="
