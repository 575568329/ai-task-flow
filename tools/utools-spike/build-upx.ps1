# uTools 插件打包脚本:产出 ai-task-flow.upx(本质 zip,uTools 可直接安装)
# 链路:backend build → frontend build(--mode utools 注入 API base) → 产物入 plugin/
#       → CSS 按 Chromium 108 降级覆盖 → Compress-Archive 为 .upx
# 用法: powershell -File tools/utools-spike/build-upx.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent   # ai-task-flow(utools-spike 的上上级)
$plugin = Join-Path $PSScriptRoot 'plugin'

Write-Host '=== 1/5 backend build(tsc → dist) ==='
Push-Location (Join-Path $root 'backend')
npm run build
if ($LASTEXITCODE -ne 0) { throw 'backend build failed' }
Pop-Location

Write-Host '=== 2/5 frontend build(--mode utools,注入 VITE_API_BASE) ==='
Push-Location (Join-Path $root 'frontend')
npm run build -- --mode utools
if ($LASTEXITCODE -ne 0) { throw 'frontend build failed' }
Pop-Location

Write-Host '=== 3/5 产物拷入 plugin/ ==='
$public = Join-Path $root 'backend\public'
# 清掉上次的产物(保留 plugin.json/logo.png/preload.js)
Get-ChildItem $plugin -Exclude 'plugin.json','logo.png','preload.js' | Remove-Item -Recurse -Force
Copy-Item (Join-Path $public 'index.html') $plugin
Copy-Item (Join-Path $public 'assets') $plugin -Recurse

Write-Host '=== 4/5 CSS 按 Chromium 108 降级(uTools 7.8 = Electron 22.3.27) ==='
Get-ChildItem (Join-Path $plugin 'assets') -Filter '*.css' | ForEach-Object {
  node (Join-Path $PSScriptRoot 'downgrade-css.cjs') $_.FullName $_.FullName
}

Write-Host '=== 5/5 压缩为 .upx ==='
$upx = Join-Path $PSScriptRoot 'ai-task-flow.upx'
if (Test-Path $upx) { Remove-Item $upx }
# 系统 bsdtar(C:\Windows\System32\tar.exe)显式 zip 格式:标准正斜杠路径。
# (Compress-Archive 用反斜杠分隔符的非标准 zip;-a 按后缀推断对 .upx 无效会退化成 tar)
Push-Location $plugin
& 'C:\Windows\System32\tar.exe' --format zip -c -f $upx plugin.json logo.png preload.js index.html assets
if ($LASTEXITCODE -ne 0) { throw 'tar failed' }
Pop-Location
Write-Host "完成: $upx ($([math]::Round((Get-Item $upx).Length / 1MB, 2)) MB)"
