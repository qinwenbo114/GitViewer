param(
  [int]$Port = 47110,
  [string]$IconPath = "",
  [string]$LogPath = ""
)

# GitViewer helper: Chromium app windows derive their taskbar icon from a small
# favicon, which looks blurry on high-DPI displays. This helper applies a
# high-resolution HICON to the app window and keeps it applied while the window
# is open.
$ErrorActionPreference = 'SilentlyContinue'

if (-not $IconPath -or -not (Test-Path $IconPath)) { exit 0 }
if (-not $LogPath) { $LogPath = Join-Path $env:TEMP 'gitviewer-icon-helper.log' }

function Write-HelperLog([string]$Message) {
  try {
    Add-Content -Path $LogPath -Value ("[{0}] {1}" -f (Get-Date -Format 's'), $Message)
  } catch { }
}

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class GitViewerWindowHelper {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);

  public static IntPtr[] FindGitViewerWindows() {
    var result = new List<IntPtr>();
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      if (!IsWindowVisible(hWnd)) return true;
      var sb = new StringBuilder(512);
      int len = GetWindowText(hWnd, sb, sb.Capacity);
      if (len <= 0) return true;
      string title = sb.ToString();
      if (title == "GitViewer" || title.EndsWith("\u2014 GitViewer") || title.EndsWith("- GitViewer")) {
        result.Add(hWnd);
      }
      return true;
    }, IntPtr.Zero);
    return result.ToArray();
  }
}
'@

Add-Type -AssemblyName System.Drawing
$big = New-Object -TypeName System.Drawing.Icon -ArgumentList $IconPath, 128, 128
$small = New-Object -TypeName System.Drawing.Icon -ArgumentList $IconPath, 32, 32
if (-not $big -or -not $small) { exit 0 }

$WM_GETICON = 0x7F
$WM_SETICON = 0x80
$ICON_SMALL = 0
$ICON_BIG = 1
$SMTO_ABORTIFHUNG = 2

Write-HelperLog "helper started port=$Port icon=$IconPath"
$lastSeen = Get-Date
$lastAppliedCount = 0
while ($true) {
  $handles = @([GitViewerWindowHelper]::FindGitViewerWindows())
  if ($handles.Count -eq 0) {
    if (((Get-Date) - $lastSeen).TotalSeconds -gt 60) {
      Write-HelperLog 'no app window for 60s, exiting'
      break
    }
  } else {
    $lastSeen = Get-Date
    $applied = 0
    foreach ($hwnd in $handles) {
      $current = [IntPtr]::Zero
      [GitViewerWindowHelper]::SendMessageTimeout($hwnd, $WM_GETICON, [IntPtr]$ICON_BIG, [IntPtr]::Zero, $SMTO_ABORTIFHUNG, 500, [ref]$current) | Out-Null
      $currentWidth = 0
      if ($current -ne [IntPtr]::Zero) {
        try {
          $currentIcon = [System.Drawing.Icon]::FromHandle($current)
          $currentWidth = $currentIcon.Width
        } catch { $currentWidth = 0 }
      }
      if ($currentWidth -lt 96) {
        [GitViewerWindowHelper]::SendMessageTimeout($hwnd, $WM_SETICON, [IntPtr]$ICON_BIG, $big.Handle, $SMTO_ABORTIFHUNG, 500, [ref]$current) | Out-Null
        [GitViewerWindowHelper]::SendMessageTimeout($hwnd, $WM_SETICON, [IntPtr]$ICON_SMALL, $small.Handle, $SMTO_ABORTIFHUNG, 500, [ref]$current) | Out-Null
        $applied++
      }
    }
    if ($applied -ne $lastAppliedCount) {
      $lastAppliedCount = $applied
      Write-HelperLog "icons applied=$applied windows=$($handles.Count)"
    }
  }
  Start-Sleep -Seconds 2
}

$big.Dispose()
$small.Dispose()
