# 枚举本机 uTools 进程的所有顶层窗口及尺寸(可见+隐藏),用于确认主窗口/插件窗口实际大小
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinEnum {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$targetPid = (Get-Process uTools | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1).Id
$all = Get-Process uTools | Select-Object -ExpandProperty Id
$results = New-Object System.Collections.ArrayList
$cb = [WinEnum+EnumProc]{ param($h, $l)
  $wpid = 0
  [WinEnum]::GetWindowThreadProcessId($h, [ref]$wpid) | Out-Null
  if ($all -contains [int]$wpid) {
    $sb = New-Object System.Text.StringBuilder 256
    [WinEnum]::GetWindowTextW($h, $sb, 256) | Out-Null
    $r = New-Object WinEnum+RECT
    [WinEnum]::GetWindowRect($h, [ref]$r) | Out-Null
    $vis = [WinEnum]::IsWindowVisible($h)
    [void]$results.Add([pscustomobject]@{
      Handle = $h; Pid = $wpid; Visible = $vis
      Title = $sb.ToString()
      W = $r.Right - $r.Left; H = $r.Bottom - $r.Top
      Rect = "$($r.Left),$($r.Top) -> $($r.Right),$($r.Bottom)"
    })
  }
  return $true
}
[WinEnum]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
$results | Where-Object { $_.Title -or $_.Visible } | Sort-Object Visible -Descending | Format-Table -AutoSize
Add-Type -AssemblyName System.Windows.Forms
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
Write-Output "PrimaryScreen: $($screen.Width) x $($screen.Height)"
