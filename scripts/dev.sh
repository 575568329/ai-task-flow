#!/bin/bash
# 启动开发环境,日志同时写到文件和终端

set -e

LOGS_DIR=".logs"
mkdir -p "$LOGS_DIR"

echo "========================================="
echo "🚀 Starting AI Task Flow Dev Environment"
echo "========================================="
echo ""
echo "📝 Logs saved to:"
echo "  - $LOGS_DIR/shared.log"
echo "  - $LOGS_DIR/backend.log"
echo "  - $LOGS_DIR/frontend.log"
echo ""

# 清理旧日志
> "$LOGS_DIR/shared.log"
> "$LOGS_DIR/backend.log"
> "$LOGS_DIR/frontend.log"

# 启动 shared (后台,日志到文件)
(cd shared && npm run build:watch >> "../$LOGS_DIR/shared.log" 2>&1) &
SHARED_PID=$!

# 等 shared 首次编译稳定(连续 2 秒 shared/dist 无变化),避免 backend tsx watch 因 shared
# 产物陆续生成而反复重启,启动瞬间 3000 端口空窗 → vite 代理 ECONNREFUSED。
echo "Waiting for shared first build to stabilize..."
shared_dist="shared/dist"
prev_snapshot=""
stable_ticks=0
waited=0
max_wait=60
while [ "$waited" -lt "$max_wait" ]; do
  sleep 1
  waited=$((waited + 1))
  if [ -d "$shared_dist" ]; then
    snapshot=$(find "$shared_dist" -type f -printf '%p|%T@|%s\n' 2>/dev/null | sort)
    if [ -n "$snapshot" ] && [ "$snapshot" = "$prev_snapshot" ]; then
      stable_ticks=$((stable_ticks + 1))
      if [ "$stable_ticks" -ge 2 ]; then break; fi
    else
      stable_ticks=0
    fi
    prev_snapshot="$snapshot"
  fi
done
if [ "$stable_ticks" -ge 2 ]; then
  echo "Shared build stable (waited ${waited}s)."
else
  echo "Shared build still changing after ${max_wait}s, continue anyway."
fi

# 启动 backend (后台,日志到文件+终端)
(cd backend && npm run dev 2>&1 | tee "../$LOGS_DIR/backend.log") &
BACKEND_PID=$!

# 等 backend 监听就绪再起 frontend:端口文件由 backend 在 listen 成功后写出。
port_file="$LOGS_DIR/backend-port.txt"
rm -f "$port_file"
waited_b=0
max_wait_b=30
while [ "$waited_b" -lt "$max_wait_b" ]; do
  if [ -f "$port_file" ]; then break; fi
  sleep 1
  waited_b=$((waited_b + 1))
done
echo "Backend listening (waited ${waited_b}s)."

# 启动 frontend (后台,日志到文件+终端)
(cd frontend && npm run dev 2>&1 | tee "../$LOGS_DIR/frontend.log") &
FRONTEND_PID=$!

echo ""
echo "========================================="
echo "✅ All services started"
echo "========================================="
echo "  Shared:   PID $SHARED_PID"
echo "  Backend:  PID $BACKEND_PID  → http://localhost:3000"
echo "  Frontend: PID $FRONTEND_PID → http://localhost:5678"
echo ""
echo "Press Ctrl+C to stop all services"
echo "========================================="

# 捕获 Ctrl+C,杀掉所有子进程
trap "echo ''; echo 'Stopping...'; kill $SHARED_PID $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT

# 等待(保持前台运行)
wait
