# scripts/dev.ps1
# PowerShell 版本的开发环境启动脚本

$ErrorActionPreference = "Stop"

$LOGS_DIR = ".logs"
if (!(Test-Path $LOGS_DIR)) {
    New-Item -ItemType Directory -Path $LOGS_DIR | Out-Null
}

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "🚀 Starting AI Task Flow Dev Environment" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "📝 Logs saved to:" -ForegroundColor Yellow
Write-Host "  - $LOGS_DIR/shared.log"
Write-Host "  - $LOGS_DIR/backend.log"
Write-Host "  - $LOGS_DIR/frontend.log"
Write-Host ""

# 清理旧日志
"" | Out-File "$LOGS_DIR/shared.log"
"" | Out-File "$LOGS_DIR/backend.log"
"" | Out-File "$LOGS_DIR/frontend.log"

# 启动 shared (后台)
$sharedJob = Start-Job -ScriptBlock {
    Set-Location $using:PWD/shared
    npm run build:watch 2>&1 | Out-File "../$using:LOGS_DIR/shared.log" -Append
}

# 启动 backend (后台,日志到文件+控制台)
$backendJob = Start-Job -ScriptBlock {
    Set-Location $using:PWD/backend
    npm run dev 2>&1 | Tee-Object -FilePath "../$using:LOGS_DIR/backend.log"
}

Start-Sleep -Seconds 2

# 启动 frontend (后台,日志到文件+控制台)
$frontendJob = Start-Job -ScriptBlock {
    Set-Location $using:PWD/frontend
    npm run dev 2>&1 | Tee-Object -FilePath "../$using:LOGS_DIR/frontend.log"
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host "✅ All services started" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
Write-Host "  Shared:   Job $($sharedJob.Id)"
Write-Host "  Backend:  Job $($backendJob.Id)  → http://localhost:3000" -ForegroundColor Cyan
Write-Host "  Frontend: Job $($frontendJob.Id) → http://localhost:5173" -ForegroundColor Magenta
Write-Host ""
Write-Host "Press Ctrl+C to stop all services" -ForegroundColor Yellow
Write-Host "=========================================" -ForegroundColor Green

# 捕获 Ctrl+C
$exitHandler = {
    Write-Host ""
    Write-Host "Stopping all services..." -ForegroundColor Yellow
    Stop-Job $sharedJob, $backendJob, $frontendJob -ErrorAction SilentlyContinue
    Remove-Job $sharedJob, $backendJob, $frontendJob -Force -ErrorAction SilentlyContinue
    exit 0
}

Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action $exitHandler | Out-Null

# 实时输出 backend 和 frontend 日志
try {
    while ($true) {
        Receive-Job $backendJob -ErrorAction SilentlyContinue
        Receive-Job $frontendJob -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 100
    }
} finally {
    & $exitHandler
}
