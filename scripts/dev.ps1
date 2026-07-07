# scripts/dev.ps1
# PowerShell 版本的开发环境启动脚本
# 精确追踪和清理子进程,不影响其他 node 项目

$ErrorActionPreference = "Stop"

# 统一输出为 UTF-8,避免 Write-Host 的中文在 GBK 终端里乱码
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$LOGS_DIR = ".logs"
$PID_FILE = "$LOGS_DIR/.pids"

if (!(Test-Path $LOGS_DIR)) {
    New-Item -ItemType Directory -Path $LOGS_DIR | Out-Null
}

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Starting AI Task Flow Dev Environment" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# 清理旧日志
Remove-Item "$LOGS_DIR/*.log" -Force -ErrorAction SilentlyContinue
Remove-Item $PID_FILE -Force -ErrorAction SilentlyContinue

# 用 Start-Process 启动每个服务,记录 PID
Write-Host "Starting shared..." -ForegroundColor Blue
$sharedProc = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", "cd shared && npm run build:watch > ../$LOGS_DIR/shared.log 2>&1" `
    -PassThru -WindowStyle Hidden

# 等 shared 首次编译稳定(连续 2 秒 shared/dist 无新增/mtime 变化)再起 backend。
# 否则 backend 的 tsx watch 会因 shared/dist 产物陆续生成而反复重启,
# 启动瞬间 3000 端口空窗 → vite 代理 ECONNREFUSED(每次 dev 必现)。
Write-Host "Waiting for shared first build to stabilize..." -ForegroundColor DarkGray
$sharedDist = "shared/dist"
$maxWaitShared = 60
$waitedShared = 0
$prevSnapshot = $null
$stableTicks = 0
while ($waitedShared -lt $maxWaitShared) {
    Start-Sleep -Seconds 1
    $waitedShared++
    if (Test-Path $sharedDist) {
        $snapshot = (Get-ChildItem -Path $sharedDist -Recurse -File -ErrorAction SilentlyContinue |
            Sort-Object FullName |
            ForEach-Object { "$($_.FullName)|$($_.LastWriteTime.Ticks)|$($_.Length)" }) -join "`n"
        if ($snapshot -and $snapshot -eq $prevSnapshot) {
            $stableTicks++
            if ($stableTicks -ge 2) { break }
        } else {
            $stableTicks = 0
        }
        $prevSnapshot = $snapshot
    }
}
if ($stableTicks -ge 2) {
    Write-Host "Shared build stable (waited ${waitedShared}s)." -ForegroundColor DarkGray
} else {
    Write-Host "Shared build still changing after ${maxWaitShared}s, continue anyway." -ForegroundColor Yellow
}

Write-Host "Starting backend..." -ForegroundColor Green
$backendProc = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", "cd backend && npm run dev > ../$LOGS_DIR/backend.log 2>&1" `
    -PassThru -WindowStyle Hidden

# 等 backend 监听就绪再起 frontend:端口文件由 backend 在 listen 成功后写出,
# 出现即代表 3000 已在监听。先删旧文件,避免上一次 dev 的残留立即满足条件而误判。
$portFile = "$LOGS_DIR/backend-port.txt"
Remove-Item $portFile -Force -ErrorAction SilentlyContinue
$maxWaitBackend = 30
$waitedBackend = 0
while ($waitedBackend -lt $maxWaitBackend) {
    if (Test-Path $portFile) { break }
    Start-Sleep -Seconds 1
    $waitedBackend++
}
Write-Host "Backend listening (waited ${waitedBackend}s)." -ForegroundColor DarkGray

Write-Host "Starting frontend..." -ForegroundColor Magenta
$frontendProc = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", "cd frontend && npm run dev > ../$LOGS_DIR/frontend.log 2>&1" `
    -PassThru -WindowStyle Hidden

# 记录所有 PID
"$($sharedProc.Id)`n$($backendProc.Id)`n$($frontendProc.Id)" | Out-File $PID_FILE -Encoding ASCII

Start-Sleep -Seconds 3

Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host "All services started" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
Write-Host "  Shared:   PID $($sharedProc.Id)"
Write-Host "  Backend:  PID $($backendProc.Id)  -> 端口见下方 [backend] 日志(默认 3000,被占自动顺延)" -ForegroundColor Cyan
Write-Host "  Frontend: PID $($frontendProc.Id) -> http://localhost:5678 (访问这个; /api 自动代理到 backend 实际端口)" -ForegroundColor Magenta
Write-Host ""
Write-Host "Logs: tail -f .logs/backend.log  or  .logs/frontend.log"
Write-Host "Press Ctrl+C to stop all services" -ForegroundColor Yellow
Write-Host "=========================================" -ForegroundColor Green
Write-Host ""

# 显示日志(从启动后的位置开始追加)
$backendLogPos = 0
$frontendLogPos = 0

try {
    while ($true) {
        # 读 backend 新增日志
        if (Test-Path "$LOGS_DIR/backend.log") {
            $size = (Get-Item "$LOGS_DIR/backend.log").Length
            if ($size -gt $backendLogPos) {
                $stream = [System.IO.File]::Open("$LOGS_DIR/backend.log", "Open", "Read", "ReadWrite")
                $stream.Position = $backendLogPos
                $reader = New-Object System.IO.StreamReader($stream)
                $newContent = $reader.ReadToEnd()
                $reader.Close()
                $stream.Close()
                if ($newContent) {
                    $newContent.TrimEnd() -split "`n" | ForEach-Object {
                        Write-Host "[backend] $_" -ForegroundColor Cyan
                    }
                }
                $backendLogPos = $size
            }
        }

        # 读 frontend 新增日志
        if (Test-Path "$LOGS_DIR/frontend.log") {
            $size = (Get-Item "$LOGS_DIR/frontend.log").Length
            if ($size -gt $frontendLogPos) {
                $stream = [System.IO.File]::Open("$LOGS_DIR/frontend.log", "Open", "Read", "ReadWrite")
                $stream.Position = $frontendLogPos
                $reader = New-Object System.IO.StreamReader($stream)
                $newContent = $reader.ReadToEnd()
                $reader.Close()
                $stream.Close()
                if ($newContent) {
                    $newContent.TrimEnd() -split "`n" | ForEach-Object {
                        Write-Host "[frontend] $_" -ForegroundColor Magenta
                    }
                }
                $frontendLogPos = $size
            }
        }

        Start-Sleep -Milliseconds 500
    }
} finally {
    Write-Host ""
    Write-Host "Stopping all services..." -ForegroundColor Yellow

    # 杀掉每个进程及其子进程树(用 PID 精确杀,不影响其他项目)
    foreach ($proc in @($sharedProc, $backendProc, $frontendProc)) {
        if ($proc -and !$proc.HasExited) {
            Write-Host "Killing process tree for PID $($proc.Id)..." -ForegroundColor Yellow
            # /T = 杀进程树(包括所有子进程),/F = 强制
            taskkill /T /F /PID $proc.Id 2>$null | Out-Null
        }
    }

    Remove-Item $PID_FILE -Force -ErrorAction SilentlyContinue
    Write-Host "Done." -ForegroundColor Green
}
