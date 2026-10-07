param(
  [Parameter(Mandatory = $true)][int]$DesktopProcessId,
  [Parameter(Mandatory = $true)][string]$PickerTitle
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class TestDirectoryPicker {
  public delegate bool WindowCallback(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] public static extern bool EnumWindows(WindowCallback callback, IntPtr data);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder text, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr window, StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  public static bool Cancel(int expectedProcess, string expectedTitle) {
    bool found = false;
    EnumWindows((window, data) => {
      uint processId;
      GetWindowThreadProcessId(window, out processId);
      if (processId != expectedProcess) return true;
      var title = new StringBuilder(256);
      var kind = new StringBuilder(256);
      GetWindowText(window, title, title.Capacity);
      GetClassName(window, kind, kind.Capacity);
      if (title.ToString() != expectedTitle || kind.ToString() != "#32770") return true;
      found = PostMessage(window, 0x0010, IntPtr.Zero, IntPtr.Zero);
      return false;
    }, IntPtr.Zero);
    return found;
  }
}
'@
$pickerDeadline = [DateTime]::UtcNow.AddSeconds(10)
while ([DateTime]::UtcNow -lt $pickerDeadline) {
  if ([TestDirectoryPicker]::Cancel($DesktopProcessId, $PickerTitle)) {
    Write-Output 'CancelledTestDirectoryPicker'
    exit 0
  }
  Start-Sleep -Milliseconds 100
}
throw 'The directory picker belonging to the test desktop process did not appear.'
