# scripts/cleanup.ps1
# 精确清理本项目启动的进程,不影响其他 node 项目

$LOGS_DIR = ".logs"
$PID_FILE = "$LOGS_DIR/.pids"

if (Test-Path $PID_FILE) {
    Write-Host "Cleaning up processes from $PID_FILE..." -ForegroundColor Yellow
    $pids = Get-Content $PID_FILE | Where-Object { $_ -match '^\d+$' }
    $killedAny = $false
    foreach ($targetPid in $pids) {
        try {
            $proc = Get-Process -Id $targetPid -ErrorAction Stop
            Write-Host "  Killing PID $targetPid ($($proc.ProcessName)) and its children..." -ForegroundColor Yellow
            taskkill /T /F /PID $targetPid 2>$null | Out-Null
            $killedAny = $true
        } catch {
            # 进程已不存在
        }
    }
    Remove-Item $PID_FILE -Force -ErrorAction SilentlyContinue

    if ($killedAny) {
        Write-Host "Done." -ForegroundColor Green
    } else {
        Write-Host "No running processes from previous run." -ForegroundColor Green
    }
} else {
    Write-Host "No .pids file found - nothing to clean." -ForegroundColor Green
    Write-Host ""
    Write-Host "Tip: If you have orphan node processes from a crashed run," -ForegroundColor Yellow
    Write-Host "     check with: Get-Process node | Format-Table Id, StartTime" -ForegroundColor Yellow
    Write-Host "     and kill manually: Stop-Process -Id <PID> -Force" -ForegroundColor Yellow
}
