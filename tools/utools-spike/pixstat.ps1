# uTools spike: 截图像素统计(唯一色数/白屏比),客观对比 Chromium 108 下原版 vs 降级版渲染
Add-Type -AssemblyName System.Drawing
foreach ($f in @('shot-orig.png', 'shot-lc108.png')) {
  $p = Join-Path $PSScriptroot $f
  $bmp = New-Object System.Drawing.Bitmap($p)
  $colors = @{}
  $step = 15
  for ($x = 0; $x -lt $bmp.Width; $x += $step) {
    for ($y = 0; $y -lt $bmp.Height; $y += $step) {
      $c = $bmp.GetPixel($x, $y)
      $key = "$($c.R),$($c.G),$($c.B)"
      if ($colors.ContainsKey($key)) { $colors[$key]++ } else { $colors[$key] = 1 }
    }
  }
  $total = ($colors.Values | Measure-Object -Sum).Sum
  $white = 0
  if ($colors.ContainsKey('255,255,255')) { $white = $colors['255,255,255'] }
  $top = $colors.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 6 | ForEach-Object { "$($_.Key):$($_.Value)" }
  Write-Output "$f => $($bmp.Width)x$($bmp.Height) sampled=$total uniqueColors=$($colors.Count) whitePct=$([math]::Round($white * 100 / $total, 1))%"
  Write-Output ("  top: " + ($top -join ' | '))
  $bmp.Dispose()
}
