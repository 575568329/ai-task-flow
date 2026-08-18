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

# 失败时打印 backend.log 末尾,即时反馈,不甩文件路径给用户去翻。
function Print-BackendLogTail {
    if (Test-Path "$LOGS_DIR/backend.log") {
        Write-Host "---- backend.log 末尾 ----" -ForegroundColor DarkGray
        Get-Content "$LOGS_DIR/backend.log" -Tail 30 | ForEach-Object { Write-Host "  $_" }
    } else {
        Write-Host "  (backend.log 不存在,后端进程可能根本没拉起)" -ForegroundColor DarkGray
    }
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
# 启动瞬间 47821 端口空窗 → vite 代理 ECONNREFUSED(每次 dev 必现)。
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

# 等 backend 真正就绪再起 frontend。
# 就绪判定不能用「端口文件是否存在」:文件存在 ≠ 后端此刻可连。
# tsx watch 被 shared/dist 变化触发重启时,端口文件可能是上一实例写的旧端口,
# 或写在了重启间隙 → vite 代理落到错误端口、前端 API 全 404。
# 正确做法:读端口 → HTTP 实际探测可连,以「HTTP 可达」作为唯一就绪真相。
# 失败时打印 backend.log 末尾(即时反馈)+ exit 1,绝不静默用错误端口起前端。
$portFile = "$LOGS_DIR/backend-port.txt"
Remove-Item $portFile -Force -ErrorAction SilentlyContinue

# 阶段 1:等端口文件出现(拿到 backend 实际端口,可能因 47821 被占而顺延)
$maxWaitPort = 30
$waitedPort = 0
while ($waitedPort -lt $maxWaitPort) {
    if (Test-Path $portFile) { break }
    Start-Sleep -Seconds 1
    $waitedPort++
}
if (!(Test-Path $portFile)) {
    Write-Host "✗ 后端 ${maxWaitPort}s 内未写出端口文件,启动失败" -ForegroundColor Red
    Print-BackendLogTail
    exit 1
}
$backendPort = (Get-Content $portFile).Trim()

# 阶段 2:HTTP 实际探测后端可连(消除「端口文件在但后端正 tsx watch 重启」的竞态)
$healthOk = $false
for ($i = 0; $i -lt 15; $i++) {
    try {
        $r = Invoke-WebRequest "http://127.0.0.1:$backendPort/api/tasks" -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) { $healthOk = $true; break }
    } catch { Start-Sleep -Seconds 1 }
}
if (-not $healthOk) {
    Write-Host "✗ 后端端口 $backendPort 探测不可达,启动失败" -ForegroundColor Red
    Print-BackendLogTail
    exit 1
}
Write-Host "Backend listening on :$backendPort (waited ${waitedPort}s)." -ForegroundColor DarkGray

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
Write-Host "  Backend:  PID $($backendProc.Id)  -> http://localhost:$backendPort (/api 经 vite 代理到此)" -ForegroundColor Cyan
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
