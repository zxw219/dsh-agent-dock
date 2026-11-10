param([ValidateSet('sidebar')][string]$Operation = 'sidebar')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
    Add-Type -Path (Join-Path $PSScriptRoot 'WorkBuddyBridge.cs') -ReferencedAssemblies Accessibility,System.Collections,System.Runtime,System.Runtime.InteropServices,System.Text.Encoding.Extensions -IgnoreWarnings -WarningAction SilentlyContinue
    [WorkBuddyBridge]::Sidebar() | ConvertTo-Json -Depth 12 -Compress
} catch {
    @{ ok = $false; error = $_.Exception.GetBaseException().Message } | ConvertTo-Json -Compress
    exit 1
}
