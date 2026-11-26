#!/bin/bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:47821}"

fail() {
  echo "FAIL: $1"
  exit 1
}

# 断言成功必须依赖 JSON 字段解析。jq 不是 Windows/Git Bash 自带命令,
# 故统一用 node(项目本身就是 Node 工程,CI 与本机都有)解析:表达式里的 data 即响应体。
json_get() {
  local expr="$1"
  node -e "
    let raw = '';
    process.stdin.on('data', (chunk) => { raw += chunk; });
    process.stdin.on('end', () => {
      try {
        const data = JSON.parse(raw);
        const value = ${expr};
        process.stdout.write(value === undefined || value === null ? '' : String(value));
      } catch {
        process.stdout.write('');
      }
    });
  "
}

# 请求体一律先落临时文件再用 --data-binary @file 发送：
# Git Bash 的 MSYS curl 会把命令行参数里的中文按系统 ANSI 码页编码，
# Content-Length 与 UTF-8 字节数对不上，后端会直接回 400。
TMP_DIR="$(mktemp -d)"
CONFLICT_BODY="/tmp/conclusion-conflict.json"
BAD_BODY="/tmp/conclusion-bad.json"
ID=""

cleanup() {
  # 中途失败也要删掉本轮创建的卡，避免在数据目录里留下孤儿 e2e-conclusion
  if [ -n "$ID" ]; then
    curl -s -X DELETE "$BASE_URL/api/conclusions/$ID" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
  rm -f "$CONFLICT_BODY" "$BAD_BODY"
}
trap cleanup EXIT

echo "=== 结论卡 E2E ==="

STATUS=$(curl -s "$BASE_URL/health" | json_get 'data.status')
[ "$STATUS" = "ok" ] || fail "后端不可达 ($BASE_URL/health)"

echo "--- 1. 创建 ---"
cat > "$TMP_DIR/create.json" <<'JSON'
{"scope":"project","project":"e2e-conclusion","title":"E2E 结论","decision":"旧结论：前端过滤","data":"旧数据"}
JSON
CREATE=$(curl -s -X POST "$BASE_URL/api/conclusions" \
  -H "Content-Type: application/json" \
  --data-binary "@$TMP_DIR/create.json")
ID=$(echo "$CREATE" | json_get 'data.id')
[ -n "$ID" ] || fail "创建失败: $CREATE"
echo "PASS: id=$ID"

echo "--- 2. 读取当前进度 ---"
DETAIL=$(curl -s "$BASE_URL/api/conclusions/$ID")
[ "$(echo "$DETAIL" | json_get 'data.revisions?.[0]?.decision')" = "旧结论：前端过滤" ] || fail "详情读取错误: $DETAIL"
echo "PASS"

echo "--- 3. 部分字段追加（decision 沿用，data 更新） ---"
cat > "$TMP_DIR/append.json" <<'JSON'
{"expectedRev":1,"data":"新数据","changeNote":"补充数据"}
JSON
APPEND=$(curl -s -X POST "$BASE_URL/api/conclusions/$ID/revisions" \
  -H "Content-Type: application/json" \
  --data-binary "@$TMP_DIR/append.json")
[ "$(echo "$APPEND" | json_get 'data.rev')" = "2" ] || fail "追加失败: $APPEND"
DETAIL=$(curl -s "$BASE_URL/api/conclusions/$ID")
[ "$(echo "$DETAIL" | json_get 'data.revisions?.[1]?.decision')" = "旧结论：前端过滤" ] || fail "decision 未沿用"
[ "$(echo "$DETAIL" | json_get 'data.revisions?.[1]?.data')" = "新数据" ] || fail "data 未更新"
echo "PASS"

echo "--- 4. 搜索命中历史版本 ---"
# keyword=旧数据（只存在于 rev 1；rev 2 的 data 已是「新数据」，而 decision 按设计沿用，
# 用「前端过滤」会连最新版一起命中，matchedRev 就不会出现）。
# URL 必须是百分号编码：请求行里的裸 UTF-8 会被 Node 直接拒绝为 400。
# 带 project 过滤：数据目录里若已有其他卡片（本脚本中途失败留下的孤儿等），
# 不加限定会让 .conclusions[0] 不再是本轮的卡。
SEARCH=$(curl -s "$BASE_URL/api/conclusions?keyword=%E6%97%A7%E6%95%B0%E6%8D%AE&project=e2e-conclusion")
[ "$(echo "$SEARCH" | json_get 'data.conclusions?.[0]?.matchedRev')" = "1" ] || fail "历史命中错误: $SEARCH"
echo "PASS"

echo "--- 5. expectedRev 冲突 ---"
cat > "$TMP_DIR/stale.json" <<'JSON'
{"expectedRev":1,"data":"stale","changeNote":"stale"}
JSON
CODE=$(curl -s -o "$CONFLICT_BODY" -w "%{http_code}" -X POST "$BASE_URL/api/conclusions/$ID/revisions" \
  -H "Content-Type: application/json" \
  --data-binary "@$TMP_DIR/stale.json")
[ "$CODE" = "409" ] || fail "期望 409，实际 $CODE: $(cat "$CONFLICT_BODY")"
echo "PASS"

echo "--- 6. 缺 changeNote 拒绝 ---"
cat > "$TMP_DIR/no-note.json" <<'JSON'
{"data":"x"}
JSON
CODE=$(curl -s -o "$BAD_BODY" -w "%{http_code}" -X POST "$BASE_URL/api/conclusions/$ID/revisions" \
  -H "Content-Type: application/json" \
  --data-binary "@$TMP_DIR/no-note.json")
[ "$CODE" = "400" ] || fail "期望 400，实际 $CODE: $(cat "$BAD_BODY")"
echo "PASS"

echo "--- 7. 改元信息 ---"
cat > "$TMP_DIR/patch.json" <<'JSON'
{"title":"E2E 结论（改名）"}
JSON
PATCH=$(curl -s -X PATCH "$BASE_URL/api/conclusions/$ID" \
  -H "Content-Type: application/json" \
  --data-binary "@$TMP_DIR/patch.json")
[ "$(echo "$PATCH" | json_get 'data.title')" = "E2E 结论（改名）" ] || fail "PATCH 失败: $PATCH"
echo "PASS"

echo "--- 8. 删除并保留历史可查（备份在数据目录） ---"
DEL=$(curl -s -X DELETE "$BASE_URL/api/conclusions/$ID")
[ "$(echo "$DEL" | json_get 'data.deleted')" = "true" ] || fail "删除失败: $DEL"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/conclusions/$ID")
[ "$CODE" = "404" ] || fail "删除后应 404，实际 $CODE"
ID=""
echo "PASS"

echo "=== 全部通过 ==="
