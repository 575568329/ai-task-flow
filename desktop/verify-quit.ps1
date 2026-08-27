# Desktop graceful-quit verification
$ErrorActionPreference = 'Continue'
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Id -eq 16356 } | Stop-Process -Force
Get-Process | Where-Object { $_.Path -like '*win-unpacked*' } | Stop-Process -Force
Start-Sleep 2
Remove-Item "$env:USERPROFILE\.ai-task-flow\logs\desktop.log" -ErrorAction SilentlyContinue

Start-Process 'D:\study\ai-task-flow\desktop\release-new\win-unpacked\AI Task Flow.exe'
Start-Sleep 12
Write-Output '=== startup log ==='
Get-Content "$env:USERPROFILE\.ai-task-flow\logs\desktop.log" -ErrorAction SilentlyContinue | Select-Object -First 3

Write-Output '=== close main window ==='
$main = Get-Process | Where-Object { $_.Path -like '*win-unpacked*' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($main) { $null = $main.CloseMainWindow(); Write-Output "closed PID $($main.Id)" } else { Write-Output 'no main window found' }
Start-Sleep 6

$left = Get-Process | Where-Object { $_.Path -like '*win-unpacked*' }
Write-Output ('=== leftover: ' + $(if ($left) { ($left.Id -join ',') } else { 'none, all exited' }) + ' ===')
Write-Output '=== final log ==='
Get-Content "$env:USERPROFILE\.ai-task-flow\logs\desktop.log" -ErrorAction SilentlyContinue | Select-Object -Last 3
