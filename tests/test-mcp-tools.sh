#!/bin/bash
# 测试 AI Task Flow MCP 工具
# 运行方式: bash tests/test-mcp-tools.sh

set -euo pipefail

echo "=============================="
echo " AI Task Flow MCP 工具测试"
echo "=============================="
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 测试计数
PASSED=0
FAILED=0

# 辅助函数
pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
    ((PASSED++))
}

fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    ((FAILED++))
}

info() {
    echo -e "${YELLOW}ℹ INFO${NC}: $1"
}

# 检查先决条件
echo "检查先决条件..."
if [ ! -f "backend/dist/interfaces/mcp/server.js" ]; then
    fail "MCP Server 未构建，请先运行: npm run build"
    exit 1
fi
pass "MCP Server 已构建"

if [ ! -f "$HOME/.ai-task-flow/tasks.json" ]; then
    fail "任务文件不存在: ~/.ai-task-flow/tasks.json"
    exit 1
fi
pass "任务文件存在"

echo ""
echo "=============================="
echo " 测试 1: 项目构建"
echo "=============================="

cd backend

# 测试 TypeScript 编译
info "运行 TypeScript 编译..."
if npm run build > /dev/null 2>&1; then
    pass "TypeScript 编译成功"
else
    fail "TypeScript 编译失败"
fi

echo ""
echo "=============================="
echo " 测试 2: 单元测试"
echo "=============================="

info "运行单元测试..."
if npm test -- --run > /dev/null 2>&1; then
    pass "所有单元测试通过"
else
    fail "单元测试失败"
fi

echo ""
echo "=============================="
echo " 测试 3: MCP Server 启动"
echo "=============================="

info "测试 MCP Server 是否可以启动..."
# 启动 MCP Server 并在 2 秒后杀死
timeout 2 node dist/interfaces/mcp/server.js > /dev/null 2>&1 || true

if [ $? -eq 124 ]; then
    # timeout 返回 124 表示超时（正常，因为我们让它超时）
    pass "MCP Server 可以正常启动"
else
    fail "MCP Server 启动失败"
fi

echo ""
echo "=============================="
echo " 测试 4: HTTP Server 启动"
echo "=============================="

info "测试 HTTP Server 是否可以启动..."
cd ..
timeout 2 node backend/dist/http-server.js > /dev/null 2>&1 || true

if [ $? -eq 124 ]; then
    pass "HTTP Server 可以正常启动"
else
    fail "HTTP Server 启动失败"
fi

echo ""
echo "=============================="
echo " 测试 5: 任务数据验证"
echo "=============================="

info "验证任务数据格式..."
TASK_COUNT=$(cat ~/.ai-task-flow/tasks.json | grep -o '"id"' | wc -l)
if [ "$TASK_COUNT" -ge 1 ]; then
    pass "任务数据有效（共 $TASK_COUNT 个任务）"
else
    fail "任务数据无效"
fi

echo ""
echo "=============================="
echo " 测试总结"
echo "=============================="
echo ""
echo "通过: $PASSED"
echo "失败: $FAILED"
echo ""

if [ "$FAILED" -eq 0 ]; then
    echo -e "${GREEN}所有测试通过！✓${NC}"
    echo ""
    echo "下一步："
    echo "1. 启动 HTTP Server: cd backend && npm run http"
    echo "2. 启动前端: cd frontend && npm run dev"
    echo "3. 配置 Claude Code MCP Server（见 docs/MCP_TOOLS_GUIDE.md）"
    exit 0
else
    echo -e "${RED}有 $FAILED 个测试失败 ✗${NC}"
    exit 1
fi
