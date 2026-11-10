$ErrorActionPreference = 'Stop'
try {
  Add-Type -Path (Join-Path $PSScriptRoot 'WorkBuddyFollower.cs') -ReferencedAssemblies @('System.Text.Json', 'System.Runtime', 'System.Runtime.InteropServices', 'System.Collections', 'System.Threading', 'System.Threading.Thread', 'System.Console', 'System.Diagnostics.Process', 'System.ComponentModel.Primitives', 'System.Text.Encoding.Extensions', 'System.Collections.Concurrent', 'Microsoft.Win32.Primitives', 'System.Memory')
  [DSH.WorkBuddyFollower]::Run()
} catch {
  [Console]::Error.WriteLine($_.Exception.ToString())
  exit 1
}
