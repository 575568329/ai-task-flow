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

# 启动 backend (后台,日志到文件+终端)
(cd backend && npm run dev 2>&1 | tee "../$LOGS_DIR/backend.log") &
BACKEND_PID=$!

# 等待 backend 启动
sleep 2

# 启动 frontend (后台,日志到文件+终端)
(cd frontend && npm run dev 2>&1 | tee "../$LOGS_DIR/frontend.log") &
FRONTEND_PID=$!

echo ""
echo "========================================="
echo "✅ All services started"
echo "========================================="
echo "  Shared:   PID $SHARED_PID"
echo "  Backend:  PID $BACKEND_PID  → http://localhost:3000"
echo "  Frontend: PID $FRONTEND_PID → http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop all services"
echo "========================================="

# 捕获 Ctrl+C,杀掉所有子进程
trap "echo ''; echo 'Stopping...'; kill $SHARED_PID $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT

# 等待(保持前台运行)
wait
