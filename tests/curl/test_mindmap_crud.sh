#!/bin/bash
# tests/curl/test_mindmap_crud.sh
# 思维导图/自由画布模块 HTTP 接口集成测试（curl 驱动）。
# 覆盖：新建 / 获取 / 更新(乐观锁) / 图校验 / 自由画布字段 round-trip / 列表 / 复制 / 删除 + 异常状态码。
#
# 用法：
#   AI_TASK_FLOW_DATA_DIR=/tmp/mm-test PORT=3999 npm run dev:backend &
#   sleep 3 && BASE_URL=http://localhost:3999 bash tests/curl/test_mindmap_crud.sh
#
# 说明：JSON body 一律经临时文件传递（req 辅助函数）。Windows Git Bash 下 curl.exe
# 对命令行多字节参数的 Content-Length 计算有误（中文 400），文件体不受影响。
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3999}"
API="$BASE_URL/api/mindmaps"
PASS=0
FAIL=0
BODY_FILE=$(mktemp)
trap 'rm -f "$BODY_FILE"' EXIT

ok() { echo "✓ $1"; PASS=$((PASS + 1)); }
die() { echo "✗ $1"; FAIL=$((FAIL + 1)); echo "  响应: $2"; exit 1; }

# req <METHOD> <URL> [JSON_BODY]：body 写临时文件再 -d @file，返回 "body\ncode"
req() {
  local method=$1 url=$2 body=${3:-}
  if [ -n "$body" ]; then
    printf '%s' "$body" > "$BODY_FILE"
    curl -s -w '\n%{http_code}' -X "$method" "$url" -H 'Content-Type: application/json' -d @"$BODY_FILE"
  else
    curl -s -w '\n%{http_code}' -X "$method" "$url"
  fi
}

echo "=== 新建思维导图 ==="
CREATE=$(req POST "$API" '{"title":"测试导图"}')
CODE=$(echo "$CREATE" | tail -1); BODY=$(echo "$CREATE" | sed '$d')
[ "$CODE" = '201' ] || die "新建期望 201 实际 $CODE" "$BODY"
ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$ID" ] || die "未拿到 id" "$BODY"
ok "新建 201, id=$ID"

echo "=== 获取 ==="
GET=$(curl -s -w '\n%{http_code}' "$API/$ID")
CODE=$(echo "$GET" | tail -1)
[ "$CODE" = '200' ] || die "获取期望 200 实际 $CODE" ""
ok "获取 200"

echo "=== 更新标题（乐观锁匹配）==="
UPD=$(req PATCH "$API/$ID" '{"title":"改过的","expectedVersion":0}')
CODE=$(echo "$UPD" | tail -1); BODY=$(echo "$UPD" | sed '$d')
[ "$CODE" = '200' ] || die "更新期望 200 实际 $CODE" "$BODY"
NEWVER=$(echo "$BODY" | grep -o '"version":[0-9]*' | cut -d':' -f2)
[ "$NEWVER" = '1' ] || die "version 未自增到 1" "$BODY"
ok "更新 200, version=1"

echo "=== 乐观锁冲突（409）==="
CONFLICT=$(req PATCH "$API/$ID" '{"title":"冲突","expectedVersion":999}')
CODE=$(echo "$CONFLICT" | tail -1)
[ "$CODE" = '409' ] || die "乐观锁冲突期望 409 实际 $CODE" ""
ok "乐观锁冲突 409"

echo "=== 图校验失败-重复 id（400）==="
BAD=$(req PATCH "$API/$ID" '{"nodes":[{"id":"dup","position":{"x":0,"y":0},"data":{"label":"a"}},{"id":"dup","position":{"x":0,"y":0},"data":{"label":"b"}}]}')
CODE=$(echo "$BAD" | tail -1)
[ "$CODE" = '400' ] || die "图校验期望 400 实际 $CODE" ""
ok "图校验失败 400"

echo "=== 合法图更新 ==="
GOOD=$(req PATCH "$API/$ID" '{"nodes":[{"id":"r","position":{"x":0,"y":0},"data":{"label":"根","level":0}},{"id":"c1","position":{"x":200,"y":0},"data":{"label":"子","level":1}}],"edges":[{"id":"e1","source":"r","target":"c1"}]}')
CODE=$(echo "$GOOD" | tail -1); BODY=$(echo "$GOOD" | sed '$d')
[ "$CODE" = '200' ] || die "合法图更新期望 200 实际 $CODE" "$BODY"
NC=$(echo "$BODY" | grep -o '"nodeCount":[0-9]*' | cut -d':' -f2)
[ "$NC" = '2' ] || die "nodeCount 期望 2" "$BODY"
ok "合法图更新 200, nodeCount=2"

echo "=== 自由画布字段 round-trip（image/link 节点 + style + 连线标签）==="
VER=$(curl -s "$API/$ID" | grep -o '"version":[0-9]*' | head -1 | cut -d':' -f2)
CANVAS=$(req PATCH "$API/$ID" '{"nodes":[
  {"id":"t1","type":"mindmap","position":{"x":0,"y":0},"data":{"label":"文字","style":{"fill":"chart-1"}}},
  {"id":"i1","type":"image","position":{"x":240,"y":0},"data":{"label":"截图","imageUrl":"/api/uploads/abc.png","width":320,"height":200}},
  {"id":"l1","type":"link","position":{"x":480,"y":0},"data":{"label":"文档","href":"https://example.com"}}
],"edges":[
  {"id":"ce1","source":"t1","target":"i1","data":{"label":"看图"}},
  {"id":"ce2","source":"i1","target":"l1"}
],"expectedVersion":'"$VER"'}')
CODE=$(echo "$CANVAS" | tail -1); BODY=$(echo "$CANVAS" | sed '$d')
[ "$CODE" = '200' ] || die "画布更新期望 200 实际 $CODE" "$BODY"
echo "$BODY" | grep -q '"type":"image"' || die "image 节点未持久化" "$BODY"
echo "$BODY" | grep -q '"imageUrl":"/api/uploads/abc.png"' || die "imageUrl 未持久化" "$BODY"
echo "$BODY" | grep -q '"type":"link"' || die "link 节点未持久化" "$BODY"
echo "$BODY" | grep -q '"href":"https://example.com"' || die "href 未持久化" "$BODY"
echo "$BODY" | grep -q '"fill":"chart-1"' || die "style.fill 未持久化" "$BODY"
echo "$BODY" | grep -q '"label":"看图"' || die "连线标签未持久化" "$BODY"
ok "自由画布字段 round-trip 200"

echo "=== 重新读取验证字段不丢 ==="
REGET=$(curl -s "$API/$ID")
echo "$REGET" | grep -q '"imageUrl":"/api/uploads/abc.png"' || die "重读 imageUrl 丢失" "$REGET"
echo "$REGET" | grep -q '"fill":"chart-1"' || die "重读 style 丢失" "$REGET"
ok "重读字段完整"

echo "=== schemaVersion 已写入存储 ==="
MINDMAP_FILE="${AI_TASK_FLOW_DATA_DIR:-/tmp/mm-test}/mindmaps.json"
if [ -f "$MINDMAP_FILE" ]; then
  grep -q '"schemaVersion": *[0-9]' "$MINDMAP_FILE" || die "schemaVersion 未写入 $MINDMAP_FILE" "$(head -c 200 "$MINDMAP_FILE")"
  ok "schemaVersion 已写入"
else
  die "数据文件不存在：$MINDMAP_FILE（用 AI_TASK_FLOW_DATA_DIR 指向服务端数据目录运行）" ""
fi

echo "=== 列表 ==="
LIST=$(curl -s -w '\n%{http_code}' "$API")
CODE=$(echo "$LIST" | tail -1); BODY=$(echo "$LIST" | sed '$d')
[ "$CODE" = '200' ] || die "列表期望 200 实际 $CODE" ""
TOTAL=$(echo "$BODY" | grep -o '"total":[0-9]*' | cut -d':' -f2)
[ "$TOTAL" -ge '1' ] || die "total 期望 >=1" "$BODY"
ok "列表 200, total=$TOTAL"

echo "=== 复制 ==="
DUP=$(curl -s -w '\n%{http_code}' -X POST "$API/$ID/duplicate")
CODE=$(echo "$DUP" | tail -1); BODY=$(echo "$DUP" | sed '$d')
[ "$CODE" = '201' ] || die "复制期望 201 实际 $CODE" "$BODY"
DUPID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
[ "$DUPID" != "$ID" ] || die "复制 id 未变" "$BODY"
ok "复制 201, 新 id"

echo "=== 删除 ==="
DEL=$(curl -s -w '\n%{http_code}' -X DELETE "$API/$ID")
CODE=$(echo "$DEL" | tail -1)
[ "$CODE" = '204' ] || die "删除期望 204 实际 $CODE" ""
ok "删除 204"

echo "=== 删除后获取（404）==="
AFTER=$(curl -s -w '\n%{http_code}' "$API/$ID")
CODE=$(echo "$AFTER" | tail -1)
[ "$CODE" = '404' ] || die "删除后期望 404 实际 $CODE" ""
ok "删除后 404"

echo ""
echo "=============================="
echo " 结果: $PASS passed, $FAIL failed"
echo "=============================="
[ "$FAIL" -eq 0 ] || exit 1
